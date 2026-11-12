// fake.mjs — a simulated broker with the same interface as live.mjs. Used by
// the tests and by `run --dry` (live prices, pretend orders). Orders fill
// from the current price: a limit buy fills when the price is at or under the
// limit, a stop sells when the price is at or under the stop, a market sell
// fills at the price. Tests can turn matching off, fill by hand, and stage the
// failures a real broker has: lost replies, lists that lag, a duplicate key
// refused, reads that fail.

const OPEN = ['PENDING', 'PARTIALLY_FILLED'];

export class FakeBroker {
  constructor({ equity = 1000, buyingPower = equity, quoteSource = null, accountSource = null, clock = () => Date.now() } = {}) {
    this.equity = equity;
    this.buyingPower = buyingPower;
    this.quoteSource = quoteSource; // async (symbols) => { SYM: { last, at } }, for dry runs
    this.accountSource = accountSource;
    this.clock = clock;
    this.px = {};
    this.pos = {};
    this.orders = new Map();
    this.ocos = new Map();
    this.byRef = new Map();
    this.calls = [];
    this.autoFillBuys = true;
    // Staged failures: each counts down by one per use.
    //   place/oco/stop/sell: the send is refused before anything is made
    //   lostReply: the order IS made, then the reply is lost (throws)
    //   hideOrders: findOrder and openOrders miss every order (a lagging list)
    //   positions: positions() throws;  emptyPositions: positions() answers {} (a lagging list)
    //   readOco: getOco() throws
    this.fail = { place: 0, oco: 0, stop: 0, sell: 0, lostReply: 0, hideOrders: 0, positions: 0, emptyPositions: 0, readOco: 0 };
    this.dupRefThrows = false; // a repeat key gets an error instead of the same order back
    this.dedupeRefs = true; // false: a repeat key makes a second order (Robinhood's behavior is unverified)
    this.reviewAlerts = [];
    this.ocoAlerts = [];
    this.seq = 0;
  }

  setPrice(sym, last, at = this.clock()) { this.px[sym] = { last, at }; }

  async quotes(symbols) {
    this.calls.push(['quotes', symbols]);
    if (this.quoteSource) {
      const q = await this.quoteSource(symbols);
      for (const [s, v] of Object.entries(q)) this.px[s] = v;
      return q;
    }
    return Object.fromEntries(symbols.filter((s) => this.px[s]).map((s) => [s, this.px[s]]));
  }

  async account() {
    if (this.accountSource) return this.accountSource();
    return { equity: this.equity, buyingPower: this.buyingPower };
  }

  async positions() {
    if (this.fail.positions > 0) { this.fail.positions -= 1; throw new Error('fake: positions unreadable'); }
    if (this.fail.emptyPositions > 0) { this.fail.emptyPositions -= 1; return {}; }
    return Object.fromEntries(Object.entries(this.pos).filter(([, q]) => q > 0));
  }

  async openOrders(symbol) {
    if (this.fail.hideOrders > 0) return [];
    for (const o of this.orders.values()) this.match(o);
    return [...this.orders.values()].filter((o) => o.symbol === symbol && OPEN.includes(o.state))
      .map((o) => ({ id: o.id, side: o.side, kind: o.type, qty: o.qty, limitPrice: o.limit ?? null, state: o.state }));
  }

  async review(order) { this.calls.push(['review', order]); return { alerts: [...this.reviewAlerts] }; }

  async placeOrder(o) {
    this.calls.push(['placeOrder', o]);
    if (o.refId && this.dedupeRefs && this.byRef.has(o.refId)) {
      if (this.dupRefThrows) throw new Error('fake: duplicate ref_id');
      return { orderId: this.byRef.get(o.refId) }; // idempotent
    }
    const kind = o.side === 'buy' ? 'place' : o.type === 'stop_market' ? 'stop' : 'sell';
    if (this.fail[kind] > 0) { this.fail[kind] -= 1; throw new Error(`fake: ${kind} refused`); }
    const id = `ord-${++this.seq}`;
    const order = { id, ...o, state: 'PENDING', filledQty: 0, avgPrice: null, createdAt: new Date(this.clock()).toISOString() };
    this.orders.set(id, order);
    if (o.refId) this.byRef.set(o.refId, id);
    this.match(order);
    if (this.fail.lostReply > 0) { this.fail.lostReply -= 1; throw new Error('fake: connection dropped after send'); }
    return { orderId: id };
  }

  async findOrder({ symbol, side, type, qty, sinceIso, refId, refIds, refOnly = false, openOnly = false, excludeIds = [] }) {
    if (this.fail.hideOrders > 0) { this.fail.hideOrders -= 1; return null; }
    const since = Date.parse(sinceIso);
    const ok = (o) => !excludeIds.includes(o.id) && (!openOnly || OPEN.includes(o.state));
    const refs = refIds ?? (refId ? [refId] : []);
    if (refs.length) {
      const byRef = [...this.orders.values()].find((o) => refs.includes(o.refId) && o.symbol === symbol && ok(o));
      if (byRef) return { orderId: byRef.id, byRef: true };
    }
    if (refOnly) return null;
    const hits = [...this.orders.values()].filter((o) => ok(o) && o.symbol === symbol && o.side === side && o.type === type
      && (qty == null || o.qty === qty) && Date.parse(o.createdAt) >= since - 60000);
    const o = hits[hits.length - 1];
    return o ? { orderId: o.id, byRef: false } : null;
  }

  async getOrder(id) {
    const o = this.orders.get(id);
    if (!o) return { state: 'UNKNOWN' };
    this.match(o);
    return { state: o.state, filledQty: o.filledQty, avgPrice: o.avgPrice };
  }

  async cancelOrder(id) {
    this.calls.push(['cancelOrder', id]);
    const o = this.orders.get(id);
    if (!o || !OPEN.includes(o.state)) throw new Error('fake: not cancellable');
    this.match(o);
    if (o.state === 'FILLED') throw new Error('fake: already filled');
    o.state = 'CANCELED';
  }

  async reviewOco(leg) { this.calls.push(['reviewOco', leg]); return { alerts: [...this.ocoAlerts] }; }

  async placeOco(leg) {
    this.calls.push(['placeOco', leg]);
    if (leg.refId && this.byRef.has(leg.refId)) return { ocoId: this.byRef.get(leg.refId) };
    if (this.fail.oco > 0) { this.fail.oco -= 1; throw new Error('fake: stop+target order refused'); }
    const id = `oco-${++this.seq}`;
    this.ocos.set(id, { id, ...leg, state: 'LIVE', filledQty: 0, avgPrice: null, createdAt: new Date(this.clock()).toISOString() });
    if (leg.refId) this.byRef.set(leg.refId, id);
    return { ocoId: id };
  }

  async findOco({ symbol, sinceIso, excludeIds = [] }) {
    const since = Date.parse(sinceIso);
    const hits = [...this.ocos.values()].filter((g) => g.symbol === symbol && g.state === 'LIVE' && !excludeIds.includes(g.id)
      && Date.parse(g.createdAt) >= since - 60000);
    const g = hits[hits.length - 1];
    return g ? { ocoId: g.id } : null;
  }

  async getOco(id) {
    if (this.fail.readOco > 0) { this.fail.readOco -= 1; throw new Error('fake: advanced orders unreadable'); }
    const g = this.ocos.get(id);
    if (!g) return { state: 'UNKNOWN' };
    if (g.state === 'LIVE') {
      const last = this.px[g.symbol]?.last;
      if (last != null && last <= g.stop) this.fillOco(g, 'STOP_FILLED', last);
      else if (last != null && last >= g.target) this.fillOco(g, 'TARGET_FILLED', g.target);
    }
    return { state: g.state, filledQty: g.filledQty, avgPrice: g.avgPrice };
  }

  async cancelOco(id) {
    this.calls.push(['cancelOco', id]);
    const g = this.ocos.get(id);
    if (!g || g.state !== 'LIVE') throw new Error('fake: not cancellable');
    g.state = 'CANCELED';
  }

  // ---- simulation ----------------------------------------------------------

  fillOco(g, state, price) {
    g.state = state;
    g.filledQty = g.qty;
    g.avgPrice = price;
    this.pos[g.symbol] = (this.pos[g.symbol] ?? 0) - g.qty;
  }

  /** Fill by hand (tests): qty more shares at px. */
  fill(id, qty, px) {
    const o = this.orders.get(id);
    const total = o.filledQty + qty;
    o.avgPrice = o.filledQty ? (o.avgPrice * o.filledQty + px * qty) / total : px;
    o.filledQty = total;
    o.state = total >= o.qty ? 'FILLED' : 'PARTIALLY_FILLED';
    this.pos[o.symbol] = (this.pos[o.symbol] ?? 0) + (o.side === 'buy' ? qty : -qty);
  }

  match(o) {
    if (!OPEN.includes(o.state)) return;
    const last = this.px[o.symbol]?.last;
    if (last == null) return;
    const left = o.qty - o.filledQty;
    if (o.side === 'buy' && o.type === 'limit') {
      if (this.autoFillBuys && last <= o.limit) this.fill(o.id, left, last);
    } else if (o.side === 'sell' && o.type === 'market') {
      if (!this.holdSells) this.fill(o.id, left, last);
    } else if (o.side === 'sell' && o.type === 'stop_market') {
      if (last <= o.stop) this.fill(o.id, left, last);
    }
  }
}
