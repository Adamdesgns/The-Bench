// broker.mjs — the ONLY layer allowed to touch broker tools. Implements the
// positive allowlist of bench-executor-v1 §5: each required capability binds
// to exactly one OBSERVED tool name; everything else on the server — options,
// crypto, transfers, watchlists, scans, anything newly exposed — is denied by
// default because no capability maps to it. Names are never guessed: a
// missing tool refuses the session. Because the allowlist lives in code here
// (not in a prompt), go-live blocker #2 (`TOOL ALLOWLIST IS PROMPT-ONLY`)
// closes on this surface.
import { normalizeBrokerState } from '../../scripts/executor-validate.mjs';

export const REQUIRED_CAPABILITIES = {
  accounts: 'get_accounts',
  portfolio: 'get_portfolio',
  quotes: 'get_equity_quotes',
  positions: 'get_equity_positions',
  orders: 'get_equity_orders',
  review: 'review_equity_order',
  place: 'place_equity_order',
  cancel: 'cancel_equity_order',
};

// The get_equity_orders schema enumerates its own state values: new, queued,
// confirmed, unconfirmed, partially_filled, filled, cancelled, rejected,
// failed, voided. The committed normalizer (built from fixtures) covers most;
// the schema-documented remainder is overlaid here with that schema as the
// provenance. `voided` stays unmapped on purpose — fail closed until a real
// capture shows what it means.
const SCHEMA_OVERLAY = { new: 'PENDING', confirmed: 'PENDING', unconfirmed: 'PENDING' };

export function normalizeState(payload) {
  const base = normalizeBrokerState(payload);
  if (base !== 'UNKNOWN_REQUIRES_RECONCILIATION') return base;
  const raw = String(payload?.state ?? payload?.status ?? '').toLowerCase().trim();
  return SCHEMA_OVERLAY[raw] ?? 'UNKNOWN_REQUIRES_RECONCILIATION';
}

// The subset of capabilities that only ever read. A binding built with
// { readOnly: true } maps NOTHING else — review/place/cancel are not merely
// unused, they are unreachable through the binding.
export const READ_CAPABILITIES = ['accounts', 'portfolio', 'quotes', 'positions', 'orders'];

export class Broker {
  constructor(mcp) {
    this.mcp = mcp;
    this.binding = null;
  }

  bind(tools, { readOnly = false } = {}) {
    const names = new Set(tools.map((t) => t.name));
    const wanted = readOnly
      ? Object.fromEntries(Object.entries(REQUIRED_CAPABILITIES).filter(([cap]) => READ_CAPABILITIES.includes(cap)))
      : REQUIRED_CAPABILITIES;
    const binding = {};
    const missing = [];
    for (const [cap, name] of Object.entries(wanted)) {
      if (names.has(name)) binding[cap] = name;
      else missing.push(`${cap} → ${name}`);
    }
    if (missing.length) {
      throw new Error(`tool binding refused — missing capabilities: ${missing.join(', ')}. Tool names are never guessed.`);
    }
    this.binding = binding;
    return binding;
  }

  async call(cap, args, opts) {
    if (!this.binding) throw new Error('tool binding not established — call bind() first');
    const name = this.binding[cap];
    if (!name) throw new Error(`capability "${cap}" is not in the binding — denied by default`);
    const result = await this.mcp.callTool(name, args, opts);
    return unwrapToolResult(result, name);
  }
}

// MCP tools/call returns { content: [{type:'text', text}], structuredContent?,
// isError? }. Broker payloads ride as JSON text. isError or unparseable output
// is a typed failure the caller treats as refusal/UNKNOWN — never success.
export function unwrapToolResult(result, name) {
  if (!result || typeof result !== 'object') {
    const e = new Error(`${name}: empty tool result`);
    e.toolError = true;
    throw e;
  }
  if (result.isError) {
    const e = new Error(`${name}: tool error — ${extractText(result).slice(0, 500)}`);
    e.toolError = true;
    throw e;
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = extractText(result);
  try {
    return JSON.parse(text);
  } catch {
    return { _unparsed: text };
  }
}

const extractText = (r) => (r.content ?? []).filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');

// Deep search a payload for the first finite number under any of `keys`
// (case-insensitive exact key match). Returns { key, value, path } or null.
// Used where the exact response schema is uncaptured: find it or fail closed.
export function findNumberByKey(obj, keys, path = '', depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  const wanted = keys.map((k) => k.toLowerCase());
  for (const [k, v] of Object.entries(obj)) {
    if (wanted.includes(k.toLowerCase())) {
      const n = Number(v);
      if (Number.isFinite(n)) return { key: k, value: n, path: path ? `${path}.${k}` : k };
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    const hit = findNumberByKey(v, keys, path ? `${path}.${k}` : k, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// Deep-collect candidate account objects: anything carrying both an
// account-number-ish key and an agentic_allowed flag.
export function collectAccounts(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) collectAccounts(item, out, depth + 1);
    return out;
  }
  const keys = Object.keys(obj).map((k) => k.toLowerCase());
  if (keys.some((k) => k.includes('account_number')) && keys.includes('agentic_allowed')) {
    out.push(obj);
  }
  for (const v of Object.values(obj)) collectAccounts(v, out, depth + 1);
  return out;
}

// Deep-collect order objects: anything with a state/status key plus an id-ish
// key or a ref_id. Used to resolve our order in list responses.
export function collectOrders(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) collectOrders(item, out, depth + 1);
    return out;
  }
  const keys = Object.keys(obj).map((k) => k.toLowerCase());
  const hasState = keys.includes('state') || keys.includes('status');
  const hasId = keys.includes('id') || keys.includes('order_id') || keys.includes('ref_id');
  if (hasState && hasId) out.push(obj);
  for (const v of Object.values(obj)) collectOrders(v, out, depth + 1);
  return out;
}

// Deep-collect position objects: anything with a symbol-ish key and a
// recognizable quantity. Returns [{ symbol, quantity }] normalized uppercase.
export function collectPositions(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) collectPositions(item, out, depth + 1);
    return out;
  }
  const symbol = obj.symbol ?? obj.ticker;
  const qty = Number(obj.quantity ?? obj.shares ?? obj.position_quantity ?? obj.quantity_available ?? NaN);
  if (typeof symbol === 'string' && symbol && Number.isFinite(qty)) {
    out.push({ symbol: symbol.toUpperCase(), quantity: qty });
  }
  for (const v of Object.values(obj)) collectPositions(v, out, depth + 1);
  return out;
}

// A payload that came back as unparseable text must never sail through a
// conflict gate as "no conflicts found" — refuse it where it matters.
export function assertParsed(payload, label) {
  if (payload && typeof payload === 'object' && '_unparsed' in payload) {
    const e = new Error(`${label}: broker response was not parseable JSON — fail closed, refuse`);
    e.toolError = true;
    throw e;
  }
  return payload;
}

export const orderIdOf = (o) => o?.order_id ?? o?.id ?? null;
export const refIdOf = (o) => o?.ref_id ?? o?.client_ref_id ?? o?.idempotency_key ?? null;
