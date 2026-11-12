// engine.mjs — the autotrader's trading logic. No network, no disk: everything
// comes in through ctx, so every path is testable against a fake broker.
// Rules that outrank the rest:
//   1. Shares the trader bought are never left without a stop while it runs.
//      If it cannot set one it alarms and keeps trying; it never sells to
//      "fix" that, except when the price is already through the plan's stop.
//   2. A buy is sent ONCE per attempt. A buy whose answer was lost is never
//      sent again: the trader looks for it (by key, by its details, in the open
//      orders, in the account's shares) and alarms until it finds it or the
//      day closes. It never relies on Robinhood refusing a repeated key.
//   3. One Robinhood answer is never taken alone as proof that a stop is gone,
//      that shares are gone, or that nothing was bought. "Shares gone" needs
//      two reads of 0 at least reconcileSec apart (sharesGone), and is said as
//      an alarm, never as a quiet SOLD.
//
// ctx = { broker, now: Date, clock?(): ms, cfg, calendar, notify(kind, text), journal(evt, data), save(), newRef() }
// broker: see fake.mjs for the interface (live.mjs implements the same one).
import { validatePlan, planRisk, planSha, planCode, ticket } from './plan.mjs';
import { sessionState, dayOver } from './session.mjs';

export { etParts, sessionState, dayOver } from './session.mjs';

export const DEFAULTS = {
  tickMs: 5000,
  maxPlans: 3,
  maxLossPct: 10, // Adam's band: dollars at risk per plan vs account value
  quoteMaxAgeSec: 120,
  entryFillSec: 30, // an unfilled buy is cancelled after this (the price ran past the ceiling)
  partialCancelSec: 20, // a partly filled buy has the rest cancelled after this
  maxEntryAttempts: 3,
  reconcileSec: 15, // wait this long before deciding an order or shares are not there
  protectCheckSec: 30,
  alarmEverySec: 60,
  unconfirmedAlarmSec: 600, // slower reminders: a buy that cannot be confirmed, extra shares
  entryCutoffMin: 5, // no new buys in the last 5 minutes of the session
};

export const TERMINAL = new Set(['EXPIRED', 'KILLED', 'MISSED', 'REJECTED', 'CLOSED']);
export const isLive = (p) => p && !TERMINAL.has(p.status);

const r2 = (n) => Math.round(n * 100) / 100;
const iso = (d) => d.toISOString();
const secsSince = (now, isoStr) => (isoStr ? (now.getTime() - Date.parse(isoStr)) / 1000 : Infinity);
const money = (n) => `${n < 0 ? '-' : '+'}$${Math.abs(n).toFixed(2)}`;
const held = (p) => p.held ?? p.fill?.qty ?? 0; // shares the trader believes it still holds
/** The time right now, after a slow call (ctx.now is when the tick started). */
const stamp = (ctx) => iso(new Date(ctx.clock ? ctx.clock() : ctx.now.getTime()));

/** A quote counts only with a price AND a time no older than the limit. */
function freshLast(q, now, cfg) {
  if (!q || !(q.last > 0) || !Number.isFinite(q.at)) return null;
  if (now.getTime() - q.at > cfg.quoteMaxAgeSec * 1000) return null;
  return q.last;
}

const triggerHit = (P, last) => (P.entry.when === 'above'
  ? last >= P.entry.trigger && last <= P.entry.limit
  : last <= P.entry.trigger && last > P.stop);

/** No new buy at or after the earlier of valid_until and exit_by. */
const entryDeadline = (P) => Math.min(Date.parse(P.valid_until), P.exit_by ? Date.parse(P.exit_by) : Infinity);

/** An open buy that is this plan's: same size, same ceiling. */
const isMine = (P) => (o) => o.side === 'buy' && o.qty === P.quantity && Math.abs((o.limitPrice ?? -1) - P.entry.limit) < 0.005;

// ---- state -----------------------------------------------------------------

export function newState() {
  return { plans: {}, done: [], lastMsgId: null, lastTickAt: null };
}

const livePlans = (st) => Object.values(st.plans).filter(isLive);

/**
 * A repeating alarm, throttled per situation (`key`), so one alarm never
 * silences a different one. One-off events use ctx.notify directly.
 */
function alarm(p, ctx, text, every = ctx.cfg.alarmEverySec, key = 'general') {
  p.alarmsAt ??= {};
  if (secsSince(ctx.now, p.alarmsAt[key]) < every) return;
  p.alarmsAt[key] = iso(ctx.now);
  ctx.notify('alarm', text);
  ctx.journal('alarm', { id: p.id, key, text });
}

function finish(p, ctx, status, text, kind = 'info') {
  p.status = status;
  p.endedAt = iso(ctx.now);
  if (text) ctx.notify(kind, text);
  ctx.journal(status.toLowerCase(), { id: p.id, text });
}

const sharesNow = async (ctx, symbol) => (await ctx.broker.positions())[symbol] ?? 0; // a failed read throws

/**
 * Is the agent account already in this ticker? Shares held or any open order
 * means yes. Throws when either read fails: callers refuse to buy.
 */
async function symbolBusy(ctx, symbol) {
  const pos = await sharesNow(ctx, symbol);
  if (pos > 0) return `the agent account already holds ${pos} ${symbol}`;
  const open = await ctx.broker.openOrders(symbol);
  if (open.length) return `there is already an open ${open[0].side} order in ${symbol} (${open[0].id})`;
  return null;
}

/** This plan's shares. Any read of shares clears a pending "maybe gone" (rule 3). */
async function readShares(p, ctx) {
  const pos = await sharesNow(ctx, p.plan.symbol);
  if (pos > 0) p.zeroAt = null;
  return pos;
}

/**
 * Rule 3: the shares count as gone only after reads of 0 in a row, the first
 * and last at least reconcileSec apart. A read of shares, a change of state
 * (startExit, reprotect, protected) or a first 0 read older than four times
 * that window starts over. A failed read throws.
 */
async function sharesGone(p, ctx) {
  const pos = await readShares(p, ctx);
  if (pos > 0) return false;
  if (!p.zeroAt || secsSince(ctx.now, p.zeroAt) > ctx.cfg.reconcileSec * 4) {
    p.zeroAt = iso(ctx.now);
    ctx.journal('zero_read', { id: p.id });
    return false;
  }
  return secsSince(ctx.now, p.zeroAt) >= ctx.cfg.reconcileSec;
}

/** Order ids of this plan's earlier buy attempts: never mistaken for the current one. */
const priorIds = (p) => (p.history ?? []).map((h) => h.orderId).filter(Boolean);

// ---- phone commands --------------------------------------------------------

export async function loadPlan(st, plan, ctx) {
  const v = validatePlan(plan, { now: ctx.now, calendar: ctx.calendar });
  if (!v.ok) return refuse(ctx, plan?.id, `the plan fails its checks: ${v.errs.join('; ')}`);
  const live = livePlans(st);
  if (isLive(st.plans[plan.id])) return refuse(ctx, plan.id, 'it is already loaded');
  if (live.length >= ctx.cfg.maxPlans) return refuse(ctx, plan.id, `${live.length} plans are already live (the limit is ${ctx.cfg.maxPlans})`);
  if (live.some((p) => p.plan.symbol === plan.symbol)) return refuse(ctx, plan.id, `another plan on ${plan.symbol} is live`);
  let acct;
  let busy;
  try {
    acct = await ctx.broker.account();
    busy = await symbolBusy(ctx, plan.symbol);
  } catch (e) {
    return refuse(ctx, plan.id, `could not read the account (${e.message})`);
  }
  if (busy) return refuse(ctx, plan.id, `${busy}; the trader only runs a ticker it is not already in`);
  const cap = r2((acct.equity * ctx.cfg.maxLossPct) / 100);
  if (v.risk > cap) return refuse(ctx, plan.id, `max loss $${v.risk} is over ${ctx.cfg.maxLossPct}% of the account ($${cap})`);
  const cost = r2(plan.quantity * plan.entry.limit);
  if (cost > acct.buyingPower) return refuse(ctx, plan.id, `it needs $${cost} and the agent account has $${acct.buyingPower} to spend`);

  if (st.plans[plan.id]) st.done.push(st.plans[plan.id]); // an old, finished run of the same row
  st.plans[plan.id] = {
    id: plan.id, plan: structuredClone(plan), sha: planSha(plan), ticket: planCode(plan), status: 'WATCHING',
    loadedAt: iso(ctx.now), attempts: 0, entry: null, fill: null, prot: null, exit: null,
  };
  ctx.journal('loaded', { id: plan.id, sha: st.plans[plan.id].sha });
  ctx.notify('info', `LOADED: ${ticket(plan)}`);
  softSave(st.plans[plan.id], ctx); // loaded either way; a buy still needs its own save to succeed (rule 4)
  return { ok: true };
}

function refuse(ctx, id, why) {
  const text = `NOT LOADED ${id ?? '(no id)'}: ${why}.`;
  ctx.notify('info', text);
  ctx.journal('refused', { id, why });
  return { ok: false, why };
}

export function killPlan(st, id, ctx) {
  const targets = livePlans(st).filter((p) => id === 'ALL' || p.id === id);
  if (!targets.length) {
    ctx.notify('info', `KILL ${id}: nothing live to stop.`);
    return;
  }
  for (const p of targets) {
    const sym = p.plan.symbol;
    if (p.status === 'WATCHING' && (p.history?.length || p.pendingEnd)) {
      // An earlier buy attempt may still deliver shares: look before saying "nothing bought".
      p.pendingEnd = { status: 'KILLED', text: `KILLED ${p.id} ${sym}: stopped watching, nothing bought.`, at: iso(ctx.now) };
      ctx.notify('info', `KILL ${p.id}: stopped watching. It checks the account for shares from the earlier buy attempt before it ends; any it finds get their stop.`);
    } else if (p.status === 'WATCHING') {
      finish(p, ctx, 'KILLED', `KILLED ${p.id} ${sym}: stopped watching, nothing bought.`);
    } else if (p.status === 'ENTERING') {
      p.entry.cancelReason = 'killed';
      ctx.notify('info', p.entry.orderId
        ? `KILL ${p.id}: cancelling the buy order. Any shares that filled first get their stop.`
        : `KILL ${p.id}: the buy order was never confirmed, so the trader cannot cancel it by its id. It keeps looking and cancels it if it finds it; cancel any open ${sym} buy in the app. Shares that show up get their stop.`);
    } else if (p.status === 'UNPROTECTED') {
      ctx.notify('info', `KILL ${p.id}: no new buys. You hold ${held(p)} ${sym} and the trader is setting the stop at ${p.plan.stop} now. To sell instead send SELL ${p.id} with a code.`);
    } else if (p.status === 'EXITING') {
      ctx.notify('info', `KILL ${p.id}: the ${sym} sell is already under way.`);
    } else {
      ctx.notify('info', `KILL ${p.id}: no new buys. Your ${held(p)} ${sym} stay protected by the stop at ${p.plan.stop}. To sell now send SELL ${p.id} with a code.`);
    }
  }
  softSave({ id }, ctx); // done in memory either way; the next tick saves again
}

export function sellPlan(st, id, ctx) {
  const p = st.plans[id];
  if (!isLive(p)) return ctx.notify('info', `SELL ${id}: nothing live under that id.`);
  if (p.status === 'WATCHING') {
    // Shares an earlier attempt left behind are sold, not just protected.
    if (p.history?.length || p.pendingEnd) p.exitWanted = 'you sent SELL';
    return killPlan(st, id, ctx);
  }
  p.exitGaveUp = false; // a fresh SELL is a fresh try, even after one that failed
  if (p.status === 'ENTERING') {
    p.entry.cancelReason = 'killed';
    p.exitWanted = 'you sent SELL';
    ctx.notify('info', `SELL ${id}: cancelling the buy; anything that filled will be sold.`);
  } else if (p.status === 'EXITING') {
    ctx.notify('info', `SELL ${id}: already selling.`);
  } else {
    p.exitWanted = 'you sent SELL';
    ctx.notify('info', `SELL ${id}: selling ${held(p)} ${p.plan.symbol} at market${sessionState(ctx.now, ctx.calendar, ctx.cfg).open ? ' now' : ' at the next open'}.`);
  }
  softSave(p, ctx);
}

export function statusLines(st) {
  const live = livePlans(st);
  if (!live.length) return ['Nothing live.'];
  return live.map((p) => {
    const P = p.plan;
    const tag = p.ticket ? ` [ticket ${p.ticket}]` : '';
    if (p.status === 'WATCHING' && p.pendingEnd) return `${p.id} ${P.symbol}: ending (${p.pendingEnd.status}), checking the account for shares first.${tag}`;
    if (p.status === 'WATCHING') return `${p.id} ${P.symbol}: watching for ${P.entry.when === 'above' ? '>=' : '<='} ${P.entry.trigger} (ceiling ${P.entry.limit}), try ${p.attempts + 1} of 3.${tag}`;
    if (p.status === 'ENTERING') return `${p.id} ${P.symbol}: buy order ${p.entry?.unconfirmed ? 'NOT CONFIRMED - check the app' : `working at ${P.entry.limit}`}.${tag}`;
    if (p.status === 'UNPROTECTED') return `${p.id} ${P.symbol}: HOLDING ${held(p)} WITH NO STOP - setting it.${tag}`;
    if (p.status === 'PROTECTED') return `${p.id} ${P.symbol}: holding ${held(p)} at ${p.fill.avg}, ${p.prot.kind === 'oco' ? `stop ${P.stop} + target ${P.target}` : `stop ${P.stop}`} set.${tag}`;
    if (p.status === 'EXITING') return `${p.id} ${P.symbol}: selling (${p.exit?.reason}).${tag}`;
    return `${p.id} ${P.symbol}: ${p.status}`;
  });
}

/** When the trader stops (the daily stop, or killed at the PC): say out loud anything left mid-way. */
export function endOfDay(st, ctx, why = 'stopped for the day') {
  for (const p of livePlans(st)) {
    const sym = p.plan.symbol;
    if (p.status === 'ENTERING') ctx.notify('alarm', `${p.id} ${sym}: the trader ${why} with the buy order ${p.entry?.unconfirmed ? 'NOT CONFIRMED' : 'still open'}. A day order dies at the close, but check the app.`);
    if (p.status === 'UNPROTECTED') ctx.notify('alarm', `${p.id} ${sym}: the trader ${why} and the ${held(p)} shares have NO STOP. Set SELL ${held(p)} ${sym} STOP ${p.plan.stop} in the app.`);
    if (p.status === 'EXITING') {
      ctx.notify('alarm', p.exit?.step === 'sell'
        ? `${p.id} ${sym}: the trader ${why} in the middle of selling, after it cancelled the stop. If the app still shows ${sym}, they have NO STOP: set SELL ${held(p)} ${sym} STOP ${p.plan.stop} or sell them.`
        : `${p.id} ${sym}: the trader ${why} in the middle of selling; the stop was not cancelled yet. Check the app.`);
    }
    if (p.status === 'PROTECTED' && p.exitWanted) ctx.notify('alarm', `${p.id} ${sym}: the trader ${why} before it could sell (${p.exitWanted}). The stop is still set. Sell in the app if you want out now.`);
  }
}

// ---- the tick ----------------------------------------------------------------

const ORDER = { UNPROTECTED: 0, EXITING: 1, ENTERING: 2, PROTECTED: 3, WATCHING: 4 };

export async function tick(st, ctx) {
  st.lastTickAt = iso(ctx.now);
  const live = livePlans(st).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  if (!live.length) return;
  const session = sessionState(ctx.now, ctx.calendar, ctx.cfg);
  let quotes = {};
  if (session.open) {
    try {
      quotes = await ctx.broker.quotes([...new Set(live.map((p) => p.plan.symbol))]);
    } catch (e) {
      ctx.journal('quote_error', { message: e.message });
    }
  }
  // A save that fails never stops the other plans from being managed; it is reported after them.
  let saveErr = null;
  for (const p of live) {
    try {
      await step(p, ctx, quotes[p.plan.symbol], session);
      p.errors = 0;
    } catch (e) {
      p.errors = (p.errors ?? 0) + 1;
      ctx.journal('step_error', { id: p.id, status: p.status, message: e.message });
      if (p.errors >= 3) alarm(p, ctx, `${p.id} ${p.plan.symbol} (${p.status}): ${p.errors} errors in a row (${e.message}). Check the app and the PC.`, undefined, 'errors');
    }
    try {
      ctx.save();
    } catch (e) {
      saveErr = e;
      ctx.journal('save_error', { id: p.id, message: e.message });
    }
  }
  // Rule: no buy goes out unless its record is on disk first, but stops and sells never wait for the disk.
  if (saveErr && secsSince(ctx.now, st.saveAlarmAt) >= ctx.cfg.unconfirmedAlarmSec) {
    st.saveAlarmAt = iso(ctx.now);
    ctx.notify('alarm', `The autotrader cannot save its state file (${saveErr.message}). No new buy goes out until it can; stops and sells still go out. Check the PC (disk space, antivirus).`);
  }
}

/** Before a stop or a sell: a save that fails is written down, and the protective order still goes out. */
function softSave(p, ctx) {
  try {
    ctx.save();
  } catch (e) {
    ctx.journal('save_error', { id: p.id, message: e.message, soft: true });
  }
}

/**
 * May an owed sale start now? A phone SELL that failed waits for a new SELL;
 * a sale owed at the sell-by time tries again every minute until it goes through.
 */
function exitDue(p, ctx, session) {
  if (!p.exitWanted) return false;
  if (!p.exitGaveUp) return true;
  const xb = p.plan.exit_by;
  // A retry never starts in the last minutes of the session: cancelling the stop then can leave
  // the close in the middle of the sale. The stop stays on and it tries again at the next open.
  return Boolean(xb && ctx.now.getTime() >= Date.parse(xb)) && Boolean(session?.entries)
    && secsSince(ctx.now, p.exitGaveUpAt) >= ctx.cfg.alarmEverySec;
}

const HANDLERS = { WATCHING: watch, ENTERING: entering, UNPROTECTED: protect, PROTECTED: guard, EXITING: exiting };

// A buy that fills is protected in the same tick, and a sell that starts is
// sent in the same tick: no 5-second gap with bare shares.
async function step(p, ctx, q, session) {
  const seen = new Set();
  while (HANDLERS[p.status] && !seen.has(p.status)) {
    const before = p.status;
    seen.add(before);
    await HANDLERS[before](p, ctx, q, session);
    if (p.status === before) break;
    if (!['ENTERING', 'UNPROTECTED', 'EXITING'].includes(p.status)) break;
  }
}

// ---- buying ------------------------------------------------------------------

// WATCHING: wait for the trigger, then send the buy.
async function watch(p, ctx, q, session) {
  const P = p.plan;
  const t = ctx.now.getTime();
  if (p.pendingEnd) {
    // Ending: never a new buy. Two reads of 0 shares, reconcileSec apart, then the end.
    const pos = await readShares(p, ctx); // a failed read throws: it reads again next tick
    if (pos > 0) {
      p.pendingEnd = null;
      return adopt(p, ctx, pos, 'they showed up after the buy order was recorded as nothing filled', true);
    }
    const z = p.pendingEnd.zeroAt;
    if (!z || secsSince(ctx.now, z) > ctx.cfg.reconcileSec * 4) { p.pendingEnd.zeroAt = iso(ctx.now); return undefined; }
    if (secsSince(ctx.now, z) < ctx.cfg.reconcileSec) return undefined;
    const end = p.pendingEnd;
    p.pendingEnd = null;
    return finish(p, ctx, end.status, end.text);
  }
  // After an attempt, a buy recorded as "nothing filled" may still deliver shares late. Look every
  // 30 s, and always before ending: a failed read throws, so the plan never ends on a guess.
  if (p.history?.length && (t >= entryDeadline(P) || secsSince(ctx.now, p.sharesCheckedAt) >= ctx.cfg.protectCheckSec)) {
    const pos = await readShares(p, ctx);
    p.sharesCheckedAt = iso(ctx.now);
    if (pos > 0) return adopt(p, ctx, pos, 'they showed up after an earlier buy attempt of this plan', true);
  }
  // A plan that had a buy order (any attempt, however it ended) ends on two reads of 0, never one.
  const end = (text) => (p.history?.length ? endAfterCheck(p, ctx, 'EXPIRED', text) : finish(p, ctx, 'EXPIRED', text));
  if (t >= Date.parse(P.valid_until)) return end(`EXPIRED ${p.id} ${P.symbol}: the window closed, nothing bought.`);
  if (P.exit_by && t >= Date.parse(P.exit_by)) return end(`EXPIRED ${p.id} ${P.symbol}: the sell-by time came before it bought, nothing bought.`);
  if (!session.entries) return;
  if (P.not_before && t < Date.parse(P.not_before)) return;
  const last = freshLast(q, ctx.now, ctx.cfg);
  if (last == null || !triggerHit(P, last)) return;

  const acct = await ctx.broker.account();
  const risk = planRisk(P);
  const cap = r2((acct.equity * ctx.cfg.maxLossPct) / 100);
  if (risk > cap) return finish(p, ctx, 'REJECTED', `NOT BOUGHT ${p.id} ${P.symbol}: max loss $${risk} is now over ${ctx.cfg.maxLossPct}% of the account ($${cap}).`);
  const cost = r2(P.quantity * P.entry.limit);
  if (cost > acct.buyingPower) return finish(p, ctx, 'REJECTED', `NOT BOUGHT ${p.id} ${P.symbol}: needs $${cost}, the agent account has $${acct.buyingPower}.`);
  const busy = await symbolBusy(ctx, P.symbol); // a read that fails throws: no buy
  if (busy) {
    if (!p.history?.length) return finish(p, ctx, 'REJECTED', `NOT BOUGHT ${p.id} ${P.symbol}: ${busy}. Check the app.`, 'alarm');
    // An earlier attempt of this plan may have left these. Never buy on top of
    // them, and never leave shares it may have bought without a stop.
    const pos = await readShares(p, ctx);
    if (pos > 0) return adopt(p, ctx, pos, 'they showed up after an earlier buy attempt of this plan', true);
    return alarm(p, ctx, `${p.id} ${P.symbol}: ${busy}, probably left by an earlier buy attempt of this plan. No new buy while it is there; if it fills, the shares get the stop. Check the app.`, ctx.cfg.unconfirmedAlarmSec, 'busy');
  }
  const order = { symbol: P.symbol, side: 'buy', type: 'limit', qty: P.quantity, limit: P.entry.limit, tif: 'gfd' };
  const rv = await ctx.broker.review(order);
  if (rv.alerts.length) return finish(p, ctx, 'REJECTED', `NOT BOUGHT ${p.id} ${P.symbol}: Robinhood flagged the order (${rv.alerts.join('; ')}).`);
  // The trader is stopping (a signal came in during the calls above): no new buy now.
  if (ctx.halted?.()) return undefined;

  p.entry = { refId: ctx.newRef(), at: iso(ctx.now), orderId: null, trigger_price: last };
  p.status = 'ENTERING';
  try {
    ctx.save();
  } catch (e) {
    p.entry = null; // not on disk: no buy, and the plan keeps watching
    p.status = 'WATCHING';
    throw e;
  }
  await sendEntry(p, ctx);
}

/** The one send of this attempt's buy. Never called twice for one entry. */
async function sendEntry(p, ctx) {
  const P = p.plan;
  const E = p.entry;
  E.sendingAt = stamp(ctx); // from here on, a buy MAY exist at Robinhood
  try {
    ctx.save(); // and the state on disk says so before the request leaves
  } catch (e) {
    p.entry = null; // nothing left the PC: no attempt is spent, and the plan keeps watching
    p.status = 'WATCHING';
    throw e;
  }
  try {
    const r = await ctx.broker.placeOrder({
      symbol: P.symbol, side: 'buy', type: 'limit', qty: P.quantity, limit: P.entry.limit, tif: 'gfd', refId: E.refId,
    });
    E.orderId = r.orderId ?? null;
  } catch (e) {
    E.lastErr = e.message;
  }
  E.sentAt = stamp(ctx); // after the answer (or the timeout): the wait to look it up starts here
  ctx.journal('entry_sent', { id: p.id, orderId: E.orderId, refId: E.refId, err: E.lastErr ?? null });
}

// ENTERING: the buy is out (or may be). Fill -> protect. Stale -> cancel.
async function entering(p, ctx, q, session) {
  const P = p.plan;
  const E = p.entry;
  if (!E.cancelReason && ctx.now.getTime() >= entryDeadline(P)) E.cancelReason = 'expired';
  if (!E.orderId) {
    let found = await ctx.broker.findOrder({ symbol: P.symbol, side: 'buy', type: 'limit', qty: P.quantity, sinceIso: E.at, refId: E.refId, excludeIds: priorIds(p) });
    if (found && !found.byRef) {
      // Matched by its details, not its key: one that ended with nothing filled proves nothing about this buy.
      const o = await ctx.broker.getOrder(found.orderId);
      if ((o.state === 'CANCELED' || o.state === 'REJECTED') && !(o.filledQty > 0)) found = null;
    }
    if (found) {
      E.orderId = found.orderId;
      E.unconfirmed = false;
    } else if (!(await unconfirmed(p, ctx, q, session))) {
      return undefined;
    }
  }
  const o = await ctx.broker.getOrder(E.orderId);
  if (o.state === 'FILLED') return filled(p, ctx, o.filledQty, o.avgPrice);
  if (o.state === 'REJECTED' || o.state === 'CANCELED') {
    if (o.filledQty > 0) return filled(p, ctx, o.filledQty, o.avgPrice);
    // The order says nothing filled. The account's shares must agree before
    // "nothing bought" (rule 3); a read that fails throws and it asks again.
    const pos = await readShares(p, ctx);
    if (pos > 0) return adopt(p, ctx, pos, `the buy order reads ${o.state} with nothing filled, but the account holds ${pos} ${P.symbol}`, true);
    if (o.state === 'REJECTED') return finish(p, ctx, 'REJECTED', `NOT BOUGHT ${p.id} ${P.symbol}: Robinhood rejected the buy order.`);
    return entryCancelled(p, ctx);
  }
  const age = secsSince(ctx.now, E.at);
  if (o.state === 'UNKNOWN') {
    E.unknown = (E.unknown ?? 0) + 1;
    if (E.unknown >= 12) alarm(p, ctx, `${p.id} ${P.symbol}: cannot read the buy order's status for a minute. Check the app.`, undefined, 'buy-unknown');
    // A buy it cannot read is still cancelled on time: a day order never rests unwatched.
    if (!E.cancelReason && age >= ctx.cfg.entryFillSec) E.cancelReason = 'stale';
  } else {
    E.unknown = 0;
    // PENDING or PARTIALLY_FILLED: decide whether to cancel what is left.
    if (!E.cancelReason) {
      if (o.state === 'PARTIALLY_FILLED' && age >= ctx.cfg.partialCancelSec) E.cancelReason = 'partial';
      else if (o.state === 'PENDING' && age >= ctx.cfg.entryFillSec) E.cancelReason = 'stale';
    }
  }
  if (E.cancelReason && secsSince(ctx.now, E.cancelAt) >= 20) {
    if (E.cancelAt) alarm(p, ctx, `${p.id} ${P.symbol}: the buy order will not cancel (${E.cancelReason}). Check the app.`, undefined, 'buy-cancel');
    E.cancelAt = iso(ctx.now);
    try {
      await ctx.broker.cancelOrder(E.orderId);
    } catch (e) {
      ctx.journal('cancel_error', { id: p.id, message: e.message }); // it may have filled: the next poll says
    }
  }
  return undefined;
}

/**
 * The buy is not listed under its key or its details. It may never have gone
 * out, or Robinhood may be slow to list it. It is NEVER sent again (rule 2).
 * Returns true when an open buy of this plan was found to read.
 */
async function unconfirmed(p, ctx, q, session) {
  const P = p.plan;
  const E = p.entry;
  if (!E.sendingAt) {
    // The program stopped before the request left: nothing can exist.
    return dropAttempt(p, ctx, 'never sent');
  }
  // The open buy first: if it is there, the normal path reads its fills and cancels the rest.
  const prior = priorIds(p);
  const open = (await ctx.broker.openOrders(P.symbol)).filter((o) => o.side === 'buy' && !prior.includes(o.id));
  const mine = open.find(isMine(P));
  if (mine) {
    E.orderId = mine.id;
    E.unconfirmed = false;
    ctx.journal('entry_found_open', { id: p.id, orderId: mine.id });
    return true;
  }
  // Shares in the account can only be this buy: the trader refuses a ticker it is already in.
  const pos = await readShares(p, ctx);
  if (pos > 0) return adopt(p, ctx, pos, 'the buy order itself was not found');
  if (secsSince(ctx.now, E.sentAt ?? E.sendingAt) < ctx.cfg.reconcileSec) return false; // give Robinhood time to list it
  if (!open.length && dayOver(E.sendingAt, ctx.now, ctx.calendar)) {
    // A day order is dead after its close. With no open buy, "nothing bought"
    // still needs two reads of 0 shares, reconcileSec apart (rule 3).
    if (!E.zeroAt || secsSince(ctx.now, E.zeroAt) > ctx.cfg.reconcileSec * 4) { E.zeroAt = iso(ctx.now); return false; }
    if (secsSince(ctx.now, E.zeroAt) >= ctx.cfg.reconcileSec) {
      return dropAttempt(p, ctx, 'unconfirmed, and after the close two reads showed no shares and no open buy');
    }
    return false;
  }
  E.unconfirmed = true;
  const why = E.lastErr ?? (open.length ? `an open buy ${open[0].id} does not match the plan` : 'not listed');
  alarm(p, ctx, `${p.id} ${P.symbol}: the buy order could not be confirmed at Robinhood (${why}). The trader will NOT send another buy for this plan. Check the app; it keeps looking until the close.`, ctx.cfg.unconfirmedAlarmSec, 'unconfirmed');
  return false;
}

/**
 * Shares found without a readable buy order: take them as this plan's fill
 * and protect them. The price is the ceiling it paid at most.
 */
function adopt(p, ctx, pos, why, always = false) {
  const P = p.plan;
  const qty = Math.min(pos, P.quantity);
  ctx.journal('adopted_from_positions', { id: p.id, pos, why });
  if (always || pos !== P.quantity) {
    ctx.notify('alarm', `${p.id} ${P.symbol}: found ${pos} shares (${why}); the plan was ${P.quantity}. The stop goes on ${qty}. If more of the buy fills later the trader alarms about shares with no stop; cancel any open ${P.symbol} buy in the app.`);
  }
  filled(p, ctx, qty, P.entry.limit);
  p.fill.avgApprox = true;
  return false;
}

/** End one buy attempt that provably bought nothing. */
function dropAttempt(p, ctx, why) {
  const P = p.plan;
  const reason = p.entry.cancelReason;
  p.history = [...(p.history ?? []), { ...p.entry, endedAt: iso(ctx.now), why }];
  p.entry = null;
  ctx.journal('entry_dropped', { id: p.id, why });
  if (reason === 'killed') return finish(p, ctx, 'KILLED', `KILLED ${p.id} ${P.symbol}: nothing bought.`);
  if (reason === 'expired' || ctx.now.getTime() >= entryDeadline(P)) return finish(p, ctx, 'EXPIRED', `EXPIRED ${p.id} ${P.symbol}: the window closed, nothing bought.`);
  p.attempts += 1;
  if (p.attempts >= ctx.cfg.maxEntryAttempts) return finish(p, ctx, 'MISSED', `MISSED ${p.id} ${P.symbol}: ${p.attempts} buy attempts, nothing bought. Done for this plan.`);
  p.status = 'WATCHING';
  return false;
}

/**
 * A plan whose buy order existed may only say "nothing bought" after the account
 * shows no shares on two reads reconcileSec apart (rule 3). Until then it waits
 * in WATCHING with no new buy (watch() does the reads) and ends, or adopts what it finds.
 */
function endAfterCheck(p, ctx, status, text) {
  p.pendingEnd = { status, text, at: iso(ctx.now) };
  p.status = 'WATCHING';
  ctx.journal('end_pending', { id: p.id, status });
  return undefined;
}

function entryCancelled(p, ctx) {
  const P = p.plan;
  const why = p.entry.cancelReason;
  p.history = [...(p.history ?? []), { ...p.entry, endedAt: iso(ctx.now) }];
  p.entry = null;
  if (why === 'killed') return endAfterCheck(p, ctx, 'KILLED', `KILLED ${p.id} ${P.symbol}: buy cancelled, nothing bought.`);
  if (why === 'expired') return endAfterCheck(p, ctx, 'EXPIRED', `EXPIRED ${p.id} ${P.symbol}: the window closed, nothing bought.`);
  p.attempts += 1;
  if (p.attempts >= ctx.cfg.maxEntryAttempts) {
    return endAfterCheck(p, ctx, 'MISSED', `MISSED ${p.id} ${P.symbol}: it ran past the ${P.entry.limit} ceiling ${p.attempts} times. Nothing bought, done for this plan.`);
  }
  p.status = 'WATCHING';
  ctx.journal('entry_missed', { id: p.id, attempts: p.attempts });
  return undefined;
}

function filled(p, ctx, qty, avg) {
  p.fill = { qty, avg, at: iso(ctx.now) };
  p.held = qty;
  p.status = 'UNPROTECTED';
  ctx.journal('filled', { id: p.id, qty, avg });
  softSave(p, ctx);
  return undefined; // protect() runs right after, in the same tick
}

// ---- protecting ----------------------------------------------------------------

/**
 * A stop+target or stop order on this ticker that is LIVE now, made since the
 * fill, and not one already known dead. Anything sent since the fill may have
 * landed even if its answer was lost.
 */
async function findLiveProt(p, ctx) {
  const P = p.plan;
  const dead = p.deadProt ?? [];
  const oco = await ctx.broker.findOco({ symbol: P.symbol, sinceIso: p.fill.at, excludeIds: dead });
  if (oco) return { kind: 'oco', id: oco.ocoId };
  // A plain stop counts only by an id or key the trader itself got back, never by its
  // details: a stop+target order's own stop leg looks exactly like a plain stop.
  for (const id of p.stopIds ?? []) {
    if (dead.includes(id)) continue;
    const o = await ctx.broker.getOrder(id);
    // An id kept before it was read back counts only once it reads as a sell of this ticker.
    if (o.symbol !== P.symbol || o.side !== 'sell') continue;
    if (o.state === 'PENDING' || o.state === 'PARTIALLY_FILLED') return { kind: 'stop', id };
  }
  if (!p.stopRefs?.length) return null;
  const stop = await ctx.broker.findOrder({
    symbol: P.symbol, side: 'sell', type: 'stop_market', qty: null, sinceIso: p.fill.at, openOnly: true, excludeIds: dead,
    refIds: p.stopRefs, refOnly: true,
  });
  if (stop) return { kind: 'stop', id: stop.orderId };
  return null;
}

// UNPROTECTED: shares are held with no stop. Set one: stop+target first, a plain stop second.
async function protect(p, ctx, q, session) {
  const P = p.plan;
  const qty = held(p);
  p.deadProt ??= [];
  if (p.protSent) {
    // A failed lookup must never stop the protecting below (fail closed for shares = keep trying).
    try {
      const found = await findLiveProt(p, ctx);
      if (found) { p.prot = { ...(p.prot ?? {}), ...found }; return protectedNow(p, ctx); }
    } catch (e) {
      ctx.journal('prot_lookup_error', { id: p.id, message: e.message });
    }
  }
  const last = freshLast(q, ctx.now, ctx.cfg);
  // After a sell that failed, the price exits wait a minute before trying again (no 5-second loop).
  // Never after the bell: tick() reads no quotes then, and a bell that rings during the tick
  // marks the session closed for the rest of it (the quotes read before it still sit here).
  const exitOk = Boolean(session?.open) && (!p.exitGaveUp || secsSince(ctx.now, p.exitGaveUpAt) >= ctx.cfg.alarmEverySec);
  if (exitOk && last != null && last <= P.stop) return startExit(p, ctx, 'the price was already at or under the stop before the stop order could be set');
  if (exitOk && last != null && last >= P.target) return startExit(p, ctx, 'the price was already at the target before the order could be set');
  if (P.exit_by && ctx.now.getTime() >= Date.parse(P.exit_by)) p.exitWanted ??= 'the sell-by time came';
  if (session?.open && exitDue(p, ctx, session)) return startExit(p, ctx, p.exitWanted);
  if (!p.prot || (p.prot.kind === 'stop' && p.prot.tries >= 2 && secsSince(ctx.now, p.prot.at) >= ctx.cfg.alarmEverySec)) {
    p.prot = { kind: 'oco', refId: ctx.newRef(), at: iso(ctx.now), tries: 0 }; // a fresh round
  }
  const leg = { symbol: P.symbol, qty, target: P.target, stop: P.stop };
  if (p.prot.kind === 'oco') {
    if (p.prot.tries < 2) {
      p.prot.tries += 1;
      try {
        const rv = await ctx.broker.reviewOco(leg);
        if (rv.alerts.length) throw new Error(`Robinhood flagged it: ${rv.alerts.join('; ')}`);
        p.protSent = true;
        softSave(p, ctx);
        const r = await ctx.broker.placeOco({ ...leg, refId: p.prot.refId });
        if (r.ocoId) {
          // Read it back: "SET" is only said about an order Robinhood shows as live.
          const g = await ctx.broker.getOco(r.ocoId);
          if (g.state === 'LIVE') { p.prot.id = r.ocoId; return protectedNow(p, ctx); }
          if (g.state === 'STOP_FILLED') { p.prot.id = r.ocoId; return closed(p, ctx, g.avgPrice, 'stop hit', g.filledQty); }
          if (g.state === 'TARGET_FILLED') { p.prot.id = r.ocoId; return closed(p, ctx, g.avgPrice, 'target hit', g.filledQty); }
          throw new Error(`the stop+target order was sent but reads ${g.state}`);
        }
      } catch (e) {
        p.prot.lastErr = e.message;
      }
      if (p.prot.tries < 2) return undefined; // try once more next tick, same key
    }
    p.prot = { kind: 'stop', refId: ctx.newRef(), at: iso(ctx.now), tries: 0, ocoErr: p.prot.lastErr };
    p.stopRefs = [...(p.stopRefs ?? []), p.prot.refId].slice(-50); // every plain stop key, so a lost one is found by its key
  }
  if (p.prot.tries < 2) {
    p.prot.tries += 1;
    p.protSent = true;
    softSave(p, ctx);
    try {
      const r = await ctx.broker.placeOrder({ symbol: P.symbol, side: 'sell', type: 'stop_market', qty, stop: P.stop, tif: 'gtc', refId: p.prot.refId });
      // Keep the id the moment Robinhood gives it, even one the broker could not read back yet:
      // the next lookup still finds this stop by its id (the order list may not show the key).
      const keep = r.orderId ?? r.unverifiedId;
      if (keep) {
        p.stopIds = [...(p.stopIds ?? []), keep].slice(-20);
        softSave(p, ctx);
      }
      if (r.orderId) {
        const o = await ctx.broker.getOrder(r.orderId);
        if (o.state === 'PENDING' || o.state === 'PARTIALLY_FILLED') { p.prot.id = r.orderId; return protectedNow(p, ctx); }
        if (o.state === 'FILLED') { p.prot.id = r.orderId; return closed(p, ctx, o.avgPrice, 'stop hit', o.filledQty); }
        throw new Error(`the stop order was sent but reads ${o.state}`);
      }
    } catch (e) {
      p.prot.lastErr = e.message;
    }
  }
  // Nothing set. The alarm goes out first; "the shares are gone" needs two reads of 0 (rule 3).
  let gone = false;
  try {
    gone = await sharesGone(p, ctx);
  } catch (e) {
    ctx.journal('positions_error', { id: p.id, message: e.message });
  }
  if (gone) {
    return finish(p, ctx, 'CLOSED', `${p.id} ${P.symbol}: the stop could not be set, and the account showed no ${P.symbol} on two reads ${ctx.cfg.reconcileSec}s apart, so the trader has stopped managing it. The trader did NOT sell them. If the app still shows ${P.symbol} shares, they have NO STOP: set SELL ${qty} ${P.symbol} STOP ${P.stop} now.`, 'alarm');
  }
  const err = p.prot.lastErr ?? p.prot.ocoErr ?? 'no answer';
  if (p.zeroAt) {
    // The last read showed no shares (sold in the app?). Say that, not "BOUGHT ... no stop".
    return alarm(p, ctx, `${p.id} ${P.symbol}: the stop could not be set (${err}) and the account shows no ${P.symbol} by one read, maybe sold in the app. Checking again in ${ctx.cfg.reconcileSec}s. If you still hold them, set SELL ${qty} ${P.symbol} STOP ${P.stop} now.`, undefined, 'stop-not-set');
  }
  return alarm(p, ctx, `BOUGHT ${qty} ${P.symbol} at ${p.fill.avg} and THE STOP IS NOT SET. Set it now in the app: SELL ${qty} ${P.symbol} STOP ${P.stop}, good till cancelled. The trader keeps trying. (${err}) [${p.id}]`, undefined, 'stop-not-set');
}

function protectedNow(p, ctx) {
  const P = p.plan;
  const F = p.fill;
  const qty = held(p);
  p.status = 'PROTECTED';
  p.zeroAt = null;
  p.prot.checkedAt = iso(ctx.now);
  p.prot.readFails = 0;
  const risk = r2(qty * (F.avg - P.stop));
  const set = p.prot.kind === 'oco'
    ? `Stop ${P.stop} and target ${P.target} are SET at Robinhood.`
    : `Stop ${P.stop} is SET at Robinhood. The target is NOT set (${p.prot.ocoErr ?? 'the stop+target order was refused'}).`;
  ctx.journal('protected', { id: p.id, kind: p.prot.kind, protId: p.prot.id });
  if (!p.announced) {
    p.announced = true;
    ctx.notify('fill', `BOUGHT ${qty} ${P.symbol} at ${F.avgApprox ? `about ${F.avg} (the ceiling)` : F.avg}. ${set} Max loss about $${risk}. [${p.id}]`);
  } else {
    ctx.notify('info', `${p.id} ${P.symbol}: protected again. ${set} [${p.id}]`);
  }
  return undefined;
}

// PROTECTED: watch the stop/target order and the shares; sell on the sell-by time or a SELL.
async function guard(p, ctx, q, session) {
  const P = p.plan;
  if (P.exit_by && ctx.now.getTime() >= Date.parse(P.exit_by)) p.exitWanted ??= 'the sell-by time came';
  if (exitDue(p, ctx, session)) {
    if (session.open) return startExit(p, ctx, p.exitWanted);
    alarm(p, ctx, `${p.id} ${P.symbol}: it should sell (${p.exitWanted}) but the market is closed. It sells at the next open; the stop stays set until then.`, 1800, 'exit-wait');
  }
  if (secsSince(ctx.now, p.prot.checkedAt) < ctx.cfg.protectCheckSec) return undefined;
  p.prot.checkedAt = iso(ctx.now);
  let g;
  try {
    g = await readProt(p, ctx);
  } catch (e) {
    g = { state: 'UNKNOWN', err: e.message };
  }
  if (g.state === 'UNKNOWN') {
    // Only a good read resets this count, so quiet ticks in between do not hide it.
    p.prot.readFails = (p.prot.readFails ?? 0) + 1;
    if (p.prot.readFails >= 3) alarm(p, ctx, `${p.id} ${P.symbol}: cannot read the stop order's status (${p.prot.readFails} checks in a row${g.err ? `, ${g.err}` : ''}). Check that it is still there in the app.`, undefined, 'prot-read');
    return undefined;
  }
  p.prot.readFails = 0;
  if (g.state === 'STOP_FILLED') return closed(p, ctx, g.avgPrice, 'stop hit', g.filledQty);
  if (g.state === 'TARGET_FILLED') return closed(p, ctx, g.avgPrice, 'target hit', g.filledQty);
  if (g.state === 'CANCELED') return protCancelled(p, ctx);
  if (g.state === 'LIVE') return checkShares(p, ctx);
  return undefined;
}

/** More shares than the stop covers (a late fill, a second buy): those have no stop. Say so. */
async function checkShares(p, ctx) {
  const P = p.plan;
  let pos;
  try {
    pos = await readShares(p, ctx);
  } catch (e) {
    ctx.journal('positions_error', { id: p.id, message: e.message });
    return undefined;
  }
  const extra = pos - held(p);
  p.extraSeen = Math.max(0, extra); // remembered, so the end of the plan still names them
  if (extra > 0) {
    alarm(p, ctx, `${p.id} ${P.symbol}: the account holds ${pos} ${P.symbol} but the trader's stop covers only ${held(p)}. The other ${extra} have NO STOP. Set SELL ${extra} ${P.symbol} STOP ${P.stop} in the app, and check for a buy that filled late.`, ctx.cfg.unconfirmedAlarmSec, 'extra-shares');
  }
  return undefined;
}

async function readProt(p, ctx) {
  if (p.prot.kind === 'oco') return ctx.broker.getOco(p.prot.id);
  const o = await ctx.broker.getOrder(p.prot.id);
  if (o.state === 'FILLED') return { state: 'STOP_FILLED', filledQty: o.filledQty, avgPrice: o.avgPrice };
  if (o.state === 'PENDING' || o.state === 'PARTIALLY_FILLED') return { state: 'LIVE' };
  if (o.state === 'CANCELED' || o.state === 'REJECTED') return { state: 'CANCELED', filledQty: o.filledQty };
  return { state: 'UNKNOWN' };
}

async function protCancelled(p, ctx) {
  const P = p.plan;
  p.deadProt = [...(p.deadProt ?? []), p.prot.id];
  let pos = null;
  try {
    pos = await readShares(p, ctx);
  } catch (e) {
    ctx.journal('positions_error', { id: p.id, message: e.message }); // unread: assume the shares are still there
  }
  // Even a read of 0 is not proof on its own: protect() confirms with a second read before ending.
  p.held = pos ? Math.min(held(p), pos) : held(p);
  if (pos === 0) p.zeroAt ??= iso(ctx.now); // the first of the two reads rule 3 needs
  p.status = 'UNPROTECTED';
  p.prot = null;
  ctx.journal('prot_cancelled', { id: p.id, pos });
  const text = pos === 0
    ? `${p.id} ${P.symbol}: the stop order was cancelled outside the trader and one read shows no ${P.symbol} (sold in the app?). Checking again; until it is sure, it treats the ${p.held} as still held and sets the stop again.`
    : `${p.id} ${P.symbol}: the stop order was cancelled outside the trader and you still hold ${p.held}${pos == null ? ' (shares not readable, assumed)' : ''}. Setting the stop again.`;
  ctx.notify('alarm', text);
  return undefined;
}

// ---- selling -------------------------------------------------------------------

function addSold(p, qty, price) {
  if (!(qty > 0) || !(price > 0)) return;
  p.sold = { qty: (p.sold?.qty ?? 0) + qty, value: r2((p.sold?.value ?? 0) + qty * price) };
  p.held = Math.max(0, held(p) - qty);
}

function closed(p, ctx, price, how, qty) {
  const P = p.plan;
  const F = p.fill;
  if (price > 0) addSold(p, qty > 0 ? qty : held(p), price);
  const sq = p.sold?.qty ?? 0;
  const out = sq ? r2(p.sold.value / sq) : null;
  const pnl = sq ? r2(p.sold.value - F.avg * sq) : null;
  const r = sq && F.avg > P.stop ? r2((out - F.avg) / (F.avg - P.stop)) : null;
  p.result = { price: out, qty: sq, pnl, r, how, at: iso(ctx.now) };
  const resultText = pnl == null ? 'Result not readable, check the app' : `Result ${money(pnl)}${r == null ? '' : ` (${r}R)`}`;
  finish(p, ctx, 'CLOSED', `SOLD ${sq} ${P.symbol} at ${out}: ${how}. ${resultText}. [${p.id}]`, 'closed');
  // Shares from a late fill that the stop never covered are not sold by it: the plan's last word names them.
  if (p.extraSeen > 0) {
    ctx.notify('alarm', `${p.id} ${P.symbol}: the account also held ${p.extraSeen} more ${P.symbol} that the trader's stop never covered (a buy that filled late). If they are still there they have NO STOP: set SELL ${p.extraSeen} ${P.symbol} STOP ${P.stop} in the app, or sell them.`);
  }
  return undefined;
}

// EXITING: cancel the stop/target order, then sell at market.
function startExit(p, ctx, reason) {
  p.status = 'EXITING';
  p.zeroAt = null; // a new stage: an old "maybe gone" read does not carry over
  p.exit = { reason, step: p.prot?.id && !(p.deadProt ?? []).includes(p.prot.id) ? 'cancel' : 'sell', at: iso(ctx.now), refId: ctx.newRef(), retries: 0 };
  ctx.journal('exit_start', { id: p.id, reason });
  softSave(p, ctx);
  return undefined;
}

/**
 * What a sell order's state means for the plan: 'done' (closed, or the stop is going back on),
 * 'again' (part or none sold: the rest goes out under a new key), or 'working'.
 */
function sellOutcome(p, ctx, o) {
  const X = p.exit;
  if (!['FILLED', 'CANCELED', 'REJECTED'].includes(o.state)) return 'working';
  p.deadSells = [...(p.deadSells ?? []), X.orderId]; // kept for the plan's life, never matched again
  if (o.state === 'FILLED') {
    const q = o.filledQty || X.qty || held(p);
    if (q >= held(p)) { closed(p, ctx, o.avgPrice, X.reason, q); return 'done'; }
    addSold(p, q, o.avgPrice); // a smaller sell (one placed in the app, taken as this sale): the rest still sells
  } else {
    if (o.filledQty > 0) addSold(p, o.filledQty, o.avgPrice);
    if (held(p) <= 0) { closed(p, ctx, null, X.reason); return 'done'; }
    if (o.state === 'REJECTED' && !(o.filledQty > 0)) { reprotect(p, ctx, 'Robinhood rejected the sell'); return 'done'; }
  }
  ctx.journal('exit_partial', { id: p.id, filled: o.filledQty, left: held(p) });
  X.orderId = null;
  X.sentAt = null;
  X.sendingAt = null;
  X.refId = ctx.newRef();
  return 'again';
}

/**
 * The bell came in the middle of a sale. The stop stays (or goes back) on for the night, and a
 * sale that was asked for (SELL, the sell-by time) goes out at the next open: the same promise
 * a SELL sent after hours gets. Not a failure, so it needs no new SELL.
 */
function overnight(p, ctx, stopOn) {
  const P = p.plan;
  ctx.journal('exit_overnight', { id: p.id, reason: p.exit?.reason, stopOn });
  p.exit = null;
  p.zeroAt = null;
  if (stopOn) {
    p.status = 'PROTECTED';
    p.prot.checkedAt = iso(ctx.now);
  } else {
    p.status = 'UNPROTECTED';
    p.prot = null;
  }
  const after = p.exitWanted
    ? `The sale (${p.exitWanted}) goes out at the next open.`
    : `Send SELL ${p.id} with a code to sell at the next open, or sell in the app.`;
  alarm(p, ctx, `${p.id} ${P.symbol}: the market closed before the sale was done. You still hold ${held(p)} as far as the trader knows; ${stopOn ? 'the stop is still on' : 'it is setting the stop again for the night'}. ${after}`, undefined, 'overnight');
  p.alarmsAt['exit-wait'] = iso(ctx.now); // this message already says it: no "market is closed" repeat
  return undefined;
}

/** The market closed in the middle of a sale: never leave the shares without a stop overnight. */
async function exitAfterBell(p, ctx) {
  const X = p.exit;
  if (X.step === 'cancel') {
    if (!X.cancelAt) return overnight(p, ctx, true); // no cancel was sent: the stop is still on
    const g = await readProt(p, ctx);
    if (g.state === 'STOP_FILLED') return closed(p, ctx, g.avgPrice, 'stop hit', g.filledQty);
    if (g.state === 'TARGET_FILLED') return closed(p, ctx, g.avgPrice, 'target hit', g.filledQty);
    if (g.state === 'LIVE') return overnight(p, ctx, true); // the cancel has not taken (if it does later, the stop check sets a new one)
    if (g.state !== 'CANCELED') return undefined; // unreadable: read again
    p.deadProt = [...(p.deadProt ?? []), p.prot.id];
    return overnight(p, ctx, false);
  }
  if (!X.orderId && X.sendingAt) {
    // A sell whose answer was lost just before the bell: look for it before setting the stop again.
    const P = p.plan;
    const found = await ctx.broker.findOrder({ symbol: P.symbol, side: 'sell', type: 'market', qty: X.qty, sinceIso: X.sendingAt, refId: X.refId, excludeIds: p.deadSells ?? [] });
    if (found) X.orderId = found.orderId;
    else if (secsSince(ctx.now, X.sentAt ?? X.sendingAt) < ctx.cfg.reconcileSec) return undefined; // the list may lag: look again
  }
  if (X.orderId) {
    // A sell sent before the bell may still fill, or come back rejected: read it.
    const out = sellOutcome(p, ctx, await ctx.broker.getOrder(X.orderId));
    if (out !== 'again') return undefined; // filled, rejected (its own message), or still working: read again
  }
  return overnight(p, ctx, false);
}

async function exiting(p, ctx, q, session) {
  const P = p.plan;
  const X = p.exit;
  if (!session.open) return exitAfterBell(p, ctx); // market orders wait for the session
  if (X.step === 'cancel') {
    if (!X.cancelAt || secsSince(ctx.now, X.cancelAt) >= 20) {
      if (X.cancelAt) alarm(p, ctx, `${p.id} ${P.symbol}: the stop order will not cancel, so the sell is waiting. Check the app.`, undefined, 'stop-cancel');
      X.cancelAt = iso(ctx.now);
      try {
        if (p.prot.kind === 'oco') await ctx.broker.cancelOco(p.prot.id);
        else await ctx.broker.cancelOrder(p.prot.id);
      } catch (e) {
        ctx.journal('cancel_error', { id: p.id, message: e.message });
      }
    }
    const g = await readProt(p, ctx);
    if (g.state === 'STOP_FILLED') return closed(p, ctx, g.avgPrice, 'stop hit', g.filledQty);
    if (g.state === 'TARGET_FILLED') return closed(p, ctx, g.avgPrice, 'target hit', g.filledQty);
    if (g.state !== 'CANCELED') return undefined;
    p.deadProt = [...(p.deadProt ?? []), p.prot.id];
    X.step = 'sell';
  }
  if (!X.orderId) {
    // Every sell of this plan that ended dead, across every exit: never matched again.
    const dead = p.deadSells ?? [];
    if (X.sendingAt) {
      // A sell may have gone out (even if the program stopped mid-call): look before sending another.
      const found = await ctx.broker.findOrder({ symbol: P.symbol, side: 'sell', type: 'market', qty: X.qty, sinceIso: X.sendingAt, refId: X.refId, excludeIds: dead });
      if (found) X.orderId = found.orderId;
      else if (secsSince(ctx.now, X.sentAt ?? X.sendingAt) < ctx.cfg.reconcileSec) return undefined;
    }
    if (!X.orderId) {
      // A live market sell already at Robinhood (a lost answer, or one left by an earlier try) is
      // this exit's: never send a second one beside it. A failed read does not block the sell.
      try {
        const open = (await ctx.broker.openOrders(P.symbol)).find((o) => o.side === 'sell' && o.kind === 'market' && !dead.includes(o.id));
        if (open) {
          X.orderId = open.id;
          X.sentAt ??= iso(ctx.now); // the "not filled after a minute" clock starts when it was found
          ctx.journal('exit_found_open', { id: p.id, orderId: open.id, qty: open.qty });
        }
      } catch (e) {
        ctx.journal('open_orders_error', { id: p.id, message: e.message });
      }
    }
    if (!X.orderId) {
      if (X.retries >= 3) return reprotect(p, ctx, `the sell order could not be confirmed (${X.lastErr ?? 'none found'})`);
      // A stop sent earlier but never confirmed may be live, holding the shares: cancel it first.
      if (p.protSent) {
        let live = null;
        try {
          live = await findLiveProt(p, ctx);
        } catch (e) {
          ctx.journal('prot_lookup_error', { id: p.id, message: e.message }); // sell anyway: Robinhood refuses it if shares are held
        }
        if (live) {
          p.prot = { ...(p.prot ?? {}), ...live };
          X.step = 'cancel';
          X.cancelAt = null;
          ctx.journal('exit_found_prot', { id: p.id, ...live });
          return undefined;
        }
      }
      // Size the sell from what the account really holds. The stop is already cancelled, so a read
      // that keeps failing must not hold the sale forever: after 3, sell what the trader bought
      // (Robinhood refuses a sell of shares the account does not hold).
      let pos;
      try {
        pos = await readShares(p, ctx);
        X.posFails = 0;
      } catch (e) {
        X.posFails = (X.posFails ?? 0) + 1;
        alarm(p, ctx, `${p.id} ${P.symbol}: the stop is cancelled for the sale and the account's shares cannot be read (${e.message}). Your ${held(p)} ${P.symbol} have NO STOP until the sale goes through.`, undefined, 'exit-no-pos');
        if (X.posFails < 3) return undefined;
        pos = held(p);
      }
      if (held(p) <= 0) return closed(p, ctx, null, X.reason);
      if (pos <= 0) {
        // One read of 0 is not proof the shares are gone (rule 3): read again, then put the stop back.
        // A first read that is too old (the trader was off) starts over, as in sharesGone.
        if (!X.zeroAt || secsSince(ctx.now, X.zeroAt) > ctx.cfg.reconcileSec * 4) { X.zeroAt = iso(ctx.now); return undefined; }
        if (secsSince(ctx.now, X.zeroAt) < ctx.cfg.reconcileSec) return undefined;
        return reprotect(p, ctx, `the account showed no ${P.symbol} for ${ctx.cfg.reconcileSec}s, but the trader has not sold the ${held(p)} it bought`);
      }
      X.zeroAt = null;
      // The tick read "market open" at its start; the broker calls since then take real time.
      // Never send a market sell after the bell: Robinhood could hold it for the next open
      // with the stop already cancelled. Put the stop back for the night instead.
      if (ctx.clock && !sessionState(new Date(ctx.clock()), ctx.calendar, ctx.cfg).open) {
        // The rest of this tick is after hours too: no new sale starts for this plan or any other.
        session.open = false;
        session.entries = false;
        return exitAfterBell(p, ctx);
      }
      const qty = Math.min(pos, held(p));
      X.qty = qty;
      X.retries += 1;
      X.sendingAt = stamp(ctx);
      softSave(p, ctx);
      try {
        const r = await ctx.broker.placeOrder({ symbol: P.symbol, side: 'sell', type: 'market', qty, tif: 'gfd', refId: X.refId });
        X.orderId = r.orderId ?? null;
      } catch (e) {
        X.lastErr = e.message;
      }
      X.sentAt = stamp(ctx);
      if (!X.orderId) return undefined;
    }
  }
  const o = await ctx.broker.getOrder(X.orderId);
  if (sellOutcome(p, ctx, o) !== 'working') return undefined;
  if (secsSince(ctx.now, X.sentAt ?? X.sendingAt) >= ctx.cfg.alarmEverySec) alarm(p, ctx, `${p.id} ${P.symbol}: the market sell has not filled after a minute (${o.state}). Check the app.`, undefined, 'sell-slow');
  return undefined;
}

// A failed exit must never leave the shares bare: put the stop back.
function reprotect(p, ctx, why) {
  p.status = 'UNPROTECTED';
  p.prot = null;
  p.exit = null;
  p.zeroAt = null;
  p.exitGaveUp = true; // a phone SELL waits for a new SELL; a price exit or the sell-by sale tries again in a minute
  p.exitGaveUpAt = iso(ctx.now);
  ctx.journal('reprotect', { id: p.id, why });
  const P = p.plan;
  const sellByOwed = P.exit_by && ctx.now.getTime() >= Date.parse(P.exit_by);
  const next = sellByOwed
    ? `The sell-by time has passed, so it tries the sale again every minute while the market is open (not in the last 5 minutes). Or sell in the app.`
    : `Send SELL ${p.id} with a code to try the sell again, or sell in the app.`;
  alarm(p, ctx, `${p.id} ${P.symbol}: the sell did not go through (${why}). You still hold ${held(p)} as far as the trader knows; it is setting the stop again. ${next}`, undefined, 'reprotect');
  return undefined;
}
