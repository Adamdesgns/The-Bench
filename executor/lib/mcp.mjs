// mcp.mjs — minimal Streamable HTTP MCP client (zero-dep, Node >=20).
// Speaks JSON-RPC 2.0 over POST to a single endpoint; parses both plain-JSON
// and SSE-wrapped responses. Call-only — no listening channel. This layer
// NEVER retries: a timeout or transport failure surfaces as a typed error and
// the caller decides, because for a placement call "try again" is how the
// same order gets placed twice.

const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 15_000;

export class McpClient {
  constructor(endpoint, { getToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.endpoint = endpoint;
    this.getToken = getToken; // async () => bearer token
    this.timeoutMs = timeoutMs;
    this.sessionId = null;
    this.nextId = 1;
  }

  async headers() {
    const h = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    const token = await this.getToken();
    if (token) h.authorization = `Bearer ${token}`;
    if (this.sessionId) h['mcp-session-id'] = this.sessionId;
    return h;
  }

  async rpc(method, params, { timeoutMs } = {}) {
    const id = this.nextId++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs ?? this.timeoutMs);
    let res;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: await this.headers(),
        signal: ctl.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
    } catch (err) {
      const e = new Error(`transport failure calling ${method}: ${err.message}`);
      e.transport = ctl.signal.aborted ? 'timeout' : 'error';
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status} from ${method}: ${text.slice(0, 400)}`);
      e.transport = 'http';
      e.status = res.status;
      throw e;
    }
    const msg = parseRpcBody(text, id);
    if (!msg) {
      const e = new Error(`no JSON-RPC response found for ${method} (id ${id})`);
      e.transport = 'protocol';
      throw e;
    }
    if (msg.error) {
      const e = new Error(`${method} → RPC error ${msg.error.code}: ${msg.error.message}`);
      e.rpc = msg.error;
      throw e;
    }
    return msg.result;
  }

  // Fire a notification (no id, no response expected). Failure is non-fatal.
  async notify(method, params) {
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      });
    } catch {
      /* notifications are best-effort */
    }
  }

  async initialize(clientInfo) {
    const result = await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    });
    await this.notify('notifications/initialized', {});
    return result;
  }

  async listTools() {
    const out = [];
    let cursor;
    do {
      const r = await this.rpc('tools/list', cursor ? { cursor } : {});
      out.push(...(r.tools ?? []));
      cursor = r.nextCursor;
    } while (cursor);
    return out;
  }

  callTool(name, args, opts) {
    return this.rpc('tools/call', { name, arguments: args }, opts);
  }
}

// Exported for tests. Finds the JSON-RPC response matching `id` in a plain
// JSON body or an SSE stream body; null when absent.
export function parseRpcBody(text, id) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  if (!/^(event|data|id|retry):/m.test(trimmed.split('\n', 1)[0])) {
    try {
      return matchId(JSON.parse(trimmed), id);
    } catch {
      return null;
    }
  }
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const m = matchId(JSON.parse(line.slice(5).trim()), id);
      if (m) return m;
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

function matchId(j, id) {
  if (Array.isArray(j)) return j.find((m) => m && m.id === id) ?? null;
  return j && j.id === id ? j : null;
}
