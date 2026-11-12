// live.mjs — the autotrader's Robinhood connection. Same interface as
// fake.mjs. It reuses the executor's login and MCP client, and binds ONLY the
// tools listed in CAPS: every other tool on the server (options, crypto,
// transfers, anything new) is unreachable. Names are never guessed: a missing
// tool refuses the whole session.
//
// Response shapes for orders and accounts were captured live on 2026-11-12
// (get_equity_orders, get_portfolio, get_advanced_orders). The place and
// review responses were NOT captured yet; their ids are read defensively and,
// when not found, the engine looks the order up instead of assuming.
import { McpClient } from '../../executor/lib/mcp.mjs';
import { getAccessToken } from '../../executor/lib/oauth.mjs';
import {
  unwrapToolResult, findNumberByKey, collectAccounts, normalizeState, orderIdOf, refIdOf, assertParsed,
} from '../../executor/lib/broker.mjs';

/**
 * How far before `since` an order may be stamped and still count as ours:
 * room for the PC clock and Robinhood's clock to disagree. Dead ids, state
 * and ticker are still checked, so a wider window cannot adopt a stranger.
 */
export const SKEW_MS = 60_000;
const MAX_POSITION_PAGES = 10;

export const ENDPOINT = process.env.BENCH_EXECUTOR_ENDPOINT ?? 'https://agent.robinhood.com/mcp/trading';

export const CAPS = {
  accounts: 'get_accounts',
  portfolio: 'get_portfolio',
  quotes: 'get_equity_quotes',
  positions: 'get_equity_positions',
  orders: 'get_equity_orders',
  approvals: 'get_trade_approval_setting',
  advOrders: 'get_advanced_orders',
  review: 'review_equity_order',
  place: 'place_equity_order',
  cancel: 'cancel_equity_order',
  advReview: 'review_advanced_order',
  advPlace: 'place_advanced_order',
  advCancel: 'cancel_advanced_order',
};
export const READ_CAPS = ['accounts', 'portfolio', 'quotes', 'positions', 'orders', 'approvals', 'advOrders'];

const STATE = { PENDING: 'PENDING', CANCEL_REQUESTED: 'PENDING', PARTIALLY_FILLED: 'PARTIALLY_FILLED', FILLED: 'FILLED', CANCELED: 'CANCELED', REJECTED: 'REJECTED' };
const num = (v) => (v == null || v === '' ? null : Number(v));

/** Robinhood stores a stop as type "market" with trigger "stop". */
export function orderKind(o) {
  const type = String(o?.type ?? '').toLowerCase();
  const trigger = String(o?.trigger ?? 'immediate').toLowerCase();
  if (trigger === 'stop') return type === 'limit' ? 'stop_limit' : 'stop_market';
  return type; // 'limit' | 'market'
}

export function normOrder(o) {
  if (!o) return { state: 'UNKNOWN' };
  return {
    id: orderIdOf(o),
    state: STATE[normalizeState(o)] ?? 'UNKNOWN',
    filledQty: num(o.cumulative_quantity) ?? 0,
    avgPrice: num(o.average_price),
    symbol: String(o.symbol ?? '').toUpperCase(),
    side: String(o.side ?? '').toLowerCase(),
    kind: orderKind(o),
    qty: num(o.quantity),
    stopPrice: num(o.stop_price),
    limitPrice: num(o.price ?? o.limit_price),
    refId: refIdOf(o),
    createdAt: o.created_at ?? null,
  };
}

const OPEN = ['PENDING', 'PARTIALLY_FILLED'];

// A list we cannot read is an error, never an empty list.
function listOf(payload, keys, label) {
  assertParsed(payload, label);
  for (const k of keys) {
    const v = payload?.data?.[k] ?? payload?.[k];
    if (Array.isArray(v)) return v;
  }
  throw new Error(`${label}: answer not recognized (no ${keys.join('/')} list), treated as unreadable`);
}
const ordersOf = (payload) => listOf(payload, ['orders', 'results'], 'orders');
const groupsOf = (payload) => listOf(payload, ['advanced_orders', 'results'], 'advanced orders');

/**
 * Our own check on a candidate order, never trusting the server's filters:
 * same ticker, side, kind and size, made no earlier than SKEW_MS before
 * `since`, not a known-dead id, and still open when asked.
 */
export function orderMatches(n, { symbol, side, type, qty, sinceIso, openOnly = false, excludeIds = [] }) {
  if (!n?.id || excludeIds.includes(n.id)) return false;
  if (openOnly && !OPEN.includes(n.state)) return false;
  if (n.symbol !== symbol || n.side !== side || n.kind !== type) return false;
  if (qty != null && n.qty !== qty) return false;
  const made = Date.parse(n.createdAt);
  return Number.isFinite(made) && made >= Date.parse(sinceIso) - SKEW_MS;
}

/**
 * One position row -> { symbol, qty }. A row without a readable ticker and
 * share count throws: a row we cannot read is never "0 shares" (rule 3).
 */
export function positionRow(row) {
  const sym = row?.symbol ?? row?.ticker ?? row?.instrument_symbol ?? row?.instrument?.symbol;
  const qty = num(row?.quantity ?? row?.shares);
  if (typeof sym !== 'string' || !sym.trim() || !Number.isFinite(qty)) {
    throw new Error('positions: a row has no readable ticker and share count, treated as unreadable');
  }
  return { symbol: sym.trim().toUpperCase(), qty };
}

/** The next-page cursor in a list answer, or null. */
const nextCursor = (p) => {
  const n = p?.data?.next ?? p?.next ?? p?.data?.cursor ?? null;
  return typeof n === 'string' && n ? n : null;
};

/** Pull every alert-ish message out of a review response. Unreadable = an alert. */
export function alertsOf(payload) {
  if (!payload || typeof payload !== 'object' || '_unparsed' in payload) return ['the review answer could not be read'];
  const out = [];
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    for (const [k, x] of Object.entries(v)) {
      const key = k.toLowerCase();
      if (['order_checks', 'alerts', 'alert', 'warnings', 'warning', 'errors', 'error'].includes(key) && x) {
        const list = Array.isArray(x) ? x : [x];
        for (const a of list) if (a) out.push(typeof a === 'string' ? a : (a.message ?? a.title ?? a.description ?? JSON.stringify(a)).toString().slice(0, 200));
      } else if (typeof x === 'object') walk(x, depth + 1);
    }
  };
  walk(payload, 0);
  return out;
}

/** OCO group -> { state, filledQty, avgPrice } from its legs. */
export function ocoStatus(group, legs) {
  if (!group) return { state: 'UNKNOWN' };
  const L = legs.filter(Boolean).map(normOrder);
  if (L.length) {
    const filled = L.find((l) => l.state === 'FILLED');
    if (filled) {
      return { state: filled.kind.startsWith('stop') || filled.stopPrice != null ? 'STOP_FILLED' : 'TARGET_FILLED', filledQty: filled.filledQty, avgPrice: filled.avgPrice };
    }
    if (L.some((l) => l.state === 'PENDING' || l.state === 'PARTIALLY_FILLED')) return { state: 'LIVE' };
    if (L.every((l) => l.state === 'CANCELED' || l.state === 'REJECTED')) return { state: 'CANCELED' };
    return { state: 'UNKNOWN' };
  }
  const gs = String(group.state ?? '').toLowerCase();
  if (gs === 'cancelled' || gs === 'canceled') return { state: 'CANCELED' };
  return { state: 'UNKNOWN' };
}

export class LiveBroker {
  constructor({ accountNumber, readOnly = false, mcp = null } = {}) {
    this.accountNumber = accountNumber;
    this.readOnly = readOnly;
    this.mcp = mcp ?? new McpClient(ENDPOINT, { getToken: getAccessToken });
    this.binding = null;
  }

  async connect() {
    await this.mcp.initialize({ name: 'bench-autotrader', version: '1.0.0' });
    const tools = await this.mcp.listTools();
    const names = new Set(tools.map((t) => t.name));
    const wanted = Object.entries(CAPS).filter(([cap]) => !this.readOnly || READ_CAPS.includes(cap));
    const missing = wanted.filter(([, n]) => !names.has(n)).map(([c, n]) => `${c} -> ${n}`);
    if (missing.length) throw new Error(`tool binding refused, missing: ${missing.join(', ')}. Tool names are never guessed.`);
    this.binding = Object.fromEntries(wanted);
    return this.binding;
  }

  async call(cap, args, opts) {
    const name = this.binding?.[cap];
    if (!name) throw new Error(`capability "${cap}" is not bound (read-only session or not connected)`);
    return unwrapToolResult(await this.mcp.callTool(name, args, opts), name);
  }

  // ---- reads -----------------------------------------------------------------

  async agentAccounts() {
    return collectAccounts(await this.call('accounts', {})).filter((a) => a.agentic_allowed === true);
  }

  async approvalsOn() {
    const p = await this.call('approvals', { account_number: this.accountNumber });
    const v = p?.data?.setting?.human_must_approve_trades;
    if (typeof v !== 'boolean') throw new Error('could not read the trade-approval setting');
    return v;
  }

  async quotes(symbols) {
    const p = await this.call('quotes', { symbols });
    const out = {};
    for (const r of p?.data?.results ?? []) {
      const q = r?.quote;
      const last = num(q?.last_trade_price);
      if (q?.symbol && last > 0) out[q.symbol.toUpperCase()] = { last, at: Date.parse(q.venue_last_trade_time) || null };
    }
    return out;
  }

  async account() {
    const p = await this.call('portfolio', { account_number: this.accountNumber });
    const equity = findNumberByKey(p, ['total_value'])?.value;
    const bp = num(p?.data?.buying_power?.buying_power) ?? findNumberByKey(p, ['buying_power'])?.value;
    if (!(equity >= 0) || !(bp >= 0)) throw new Error('could not read the account value and buying power');
    return { equity, buyingPower: bp };
  }

  /**
   * Shares held in THIS account. Never falls back to a call without the
   * account (that would count other accounts' shares). An answer that is not
   * readable or not recognized throws, a row it cannot read throws, and every
   * page is read: "0 shares" is only ever concluded from a whole positions
   * list that was actually read.
   */
  async positions() {
    const out = {};
    let cursor = null;
    for (let page = 0; page < MAX_POSITION_PAGES; page += 1) {
      const args = { account_number: this.accountNumber };
      if (cursor) args.cursor = cursor;
      const p = await this.call('positions', args);
      for (const row of listOf(p, ['positions', 'results', 'equity_positions'], 'positions')) {
        const { symbol, qty } = positionRow(row);
        out[symbol] = (out[symbol] ?? 0) + qty;
      }
      cursor = nextCursor(p);
      if (!cursor) return out;
    }
    throw new Error(`positions: more than ${MAX_POSITION_PAGES} pages, treated as unreadable`);
  }

  /** Open orders in a ticker (the most recent page Robinhood returns). */
  async openOrders(symbol) {
    const p = await this.call('orders', { account_number: this.accountNumber, symbol });
    return ordersOf(p).map(normOrder).filter((o) => o.symbol === symbol && OPEN.includes(o.state));
  }

  async getOrder(id) {
    const p = await this.call('orders', { account_number: this.accountNumber, order_id: id });
    const o = ordersOf(p).find((x) => String(orderIdOf(x)) === String(id));
    return normOrder(o);
  }

  async findOrder(q) {
    const since = new Date(Date.parse(q.sinceIso) - SKEW_MS).toISOString();
    const p = await this.call('orders', { account_number: this.accountNumber, symbol: q.symbol, created_at_gte: since });
    const all = ordersOf(p).map(normOrder);
    const refs = q.refIds ?? (q.refId ? [q.refId] : []);
    if (refs.length) {
      const byRef = all.find((o) => refs.includes(o.refId) && o.symbol === q.symbol && !(q.excludeIds ?? []).includes(o.id)
        && (!q.openOnly || OPEN.includes(o.state)));
      if (byRef) return { orderId: byRef.id, byRef: true };
    }
    if (q.refOnly) return null; // only an order carrying one of these keys counts
    const hit = all.filter((o) => orderMatches(o, q));
    hit.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return hit[0] ? { orderId: hit[0].id, byRef: false } : null;
  }

  async getOco(id) {
    const p = await this.call('advOrders', { account_number: this.accountNumber, order_id: id });
    const g = groupsOf(p).find((x) => String(x.id) === String(id));
    return ocoStatus(g, await this.legsOf(g));
  }

  async findOco({ symbol, sinceIso, excludeIds = [] }) {
    const sinceMs = Date.parse(sinceIso) - SKEW_MS;
    const p = await this.call('advOrders', { account_number: this.accountNumber, contingency_type: 'oco', created_at_gte: new Date(sinceMs).toISOString() });
    for (const g of groupsOf(p)) {
      if (excludeIds.includes(g.id)) continue;
      const made = Date.parse(g.created_at);
      if (!Number.isFinite(made) || made < sinceMs) continue;
      const legs = await this.legsOf(g);
      if (legs.length && legs.every((l) => String(l?.symbol ?? '').toUpperCase() === symbol) && ocoStatus(g, legs).state === 'LIVE') return { ocoId: g.id };
    }
    return null;
  }

  async legsOf(g) {
    if (!g) return [];
    const links = g.advanced_order_links ?? g.legs ?? [];
    const out = [];
    for (const l of links) {
      if (l?.order) out.push(l.order);
      else if (l?.order_id) {
        const p = await this.call('orders', { account_number: this.accountNumber, order_id: l.order_id });
        out.push(ordersOf(p).find((x) => String(orderIdOf(x)) === String(l.order_id)) ?? null);
      }
    }
    return out;
  }

  // ---- orders (never bound in a read-only session) --------------------------

  orderArgs(o) {
    const a = {
      account_number: this.accountNumber, symbol: o.symbol, side: o.side, type: o.type,
      quantity: String(o.qty), time_in_force: o.tif ?? 'gfd', market_hours: 'regular_hours',
    };
    if (o.limit != null) a.limit_price = o.limit.toFixed(2);
    if (o.stop != null) a.stop_price = o.stop.toFixed(2);
    return a;
  }

  async review(o) {
    return { alerts: alertsOf(await this.call('review', this.orderArgs(o))) };
  }

  /**
   * The id that comes back is only trusted after reading it back as our order
   * (same ticker and side). Otherwise null: the engine looks the order up.
   * An id that could not be read back yet (the list lags right after placing, or
   * the read failed) comes back as unverifiedId, so the engine can keep it and
   * check it later; one that read back as a different order is dropped.
   */
  async placeOrder(o) {
    const p = await this.call('place', { ...this.orderArgs(o), ref_id: o.refId });
    const order = p?.data?.order ?? p?.order ?? p?.data ?? p;
    const id = orderIdOf(order);
    if (!id) return { orderId: null };
    const back = await this.getOrder(id).catch(() => ({ state: 'UNKNOWN' }));
    if (back.state === 'UNKNOWN') return { orderId: null, unverifiedId: id };
    return { orderId: back.symbol === o.symbol && back.side === o.side ? id : null };
  }

  async cancelOrder(id) {
    await this.call('cancel', { account_number: this.accountNumber, order_id: id });
  }

  ocoArgs(leg) {
    return {
      account_number: this.accountNumber, symbol: leg.symbol, side: 'sell', quantity: String(leg.qty),
      take_profit_limit_price: leg.target.toFixed(2), stop_loss_stop_price: leg.stop.toFixed(2),
      time_in_force: 'gtc', market_hours: 'regular_hours',
    };
  }

  async reviewOco(leg) {
    return { alerts: alertsOf(await this.call('advReview', this.ocoArgs(leg))) };
  }

  async placeOco(leg) {
    const p = await this.call('advPlace', { ...this.ocoArgs(leg), ref_id: leg.refId });
    const g = p?.data?.advanced_order ?? p?.advanced_order ?? p?.data ?? p;
    const id = g?.id ?? null;
    if (!id) return { ocoId: null };
    const back = await this.getOco(id).catch(() => ({ state: 'UNKNOWN' }));
    return { ocoId: back.state === 'UNKNOWN' ? null : id };
  }

  async cancelOco(id) {
    await this.call('advCancel', { account_number: this.accountNumber, order_id: id });
  }
}
