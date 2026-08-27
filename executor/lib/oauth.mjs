// oauth.mjs — OAuth 2.1 for the Robinhood agentic MCP endpoint (zero-dep).
// Discovery (RFC 9728 → AS metadata) → dynamic client registration → PKCE
// authorization-code flow through the system browser with a localhost
// loopback → token store with refresh. Interactive by design: `login` runs
// on a TTY, in front of Adam, and consent happens in HIS browser session.
// This program never sees or stores his Robinhood password — only the
// OAuth tokens Robinhood chooses to issue.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';

const STORE_DIR = join(homedir(), '.bench-executor');
const STORE_PATH = join(STORE_DIR, 'oauth.json');
const REDIRECT_PORT = 8917;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function loadStore() {
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function saveStore(store) {
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function discover(resourceUrl) {
  const u = new URL(resourceUrl);
  const prmCandidates = [
    `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`,
    `${u.origin}/.well-known/oauth-protected-resource`,
  ];
  let prm = null;
  for (const c of prmCandidates) {
    try { prm = await fetchJson(c); break; } catch { /* try next */ }
  }
  const asBase = prm?.authorization_servers?.[0] ?? u.origin;
  const asu = new URL(asBase);
  const suffix = asu.pathname === '/' ? '' : asu.pathname;
  const asCandidates = [
    `${asu.origin}/.well-known/oauth-authorization-server${suffix}`,
    `${asu.origin}/.well-known/oauth-authorization-server`,
    `${asu.origin}/.well-known/openid-configuration`,
  ];
  for (const c of asCandidates) {
    try {
      const as = await fetchJson(c);
      if (as.authorization_endpoint && as.token_endpoint) return { prm, as };
    } catch { /* try next */ }
  }
  throw new Error(
    'OAuth discovery failed — no authorization-server metadata found. Do not guess endpoints; ' +
    'capture the responses above and record the blocker in docs/executor-test-protocol.md.'
  );
}

async function register(as) {
  if (!as.registration_endpoint) {
    throw new Error(
      'The authorization server does not advertise dynamic client registration. ' +
      'If Robinhood issues client ids out of band, set BENCH_EXECUTOR_CLIENT_ID and rerun login.'
    );
  }
  return fetchJson(as.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'bench-executor-v1 (local program)',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
}

function waitForCode(expectedState) {
  return new Promise((resolveCode, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${REDIRECT_PORT}`);
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const got = Object.fromEntries(url.searchParams);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<b>bench-executor:</b> login received — you can close this tab and return to the terminal.');
      server.close();
      if (got.state !== expectedState) reject(new Error('OAuth state mismatch — aborting login.'));
      else if (got.error) reject(new Error(`OAuth error: ${got.error} ${got.error_description ?? ''}`));
      else resolveCode(got.code);
    });
    server.on('error', reject);
    server.listen(REDIRECT_PORT, '127.0.0.1');
    setTimeout(() => { server.close(); reject(new Error('OAuth login timed out after 5 minutes.')); }, LOGIN_TIMEOUT_MS).unref();
  });
}

function openBrowser(url) {
  // win32: NOT `cmd /c start` — cmd splits an unquoted URL at every `&`,
  // truncating the query string. rundll32's URL handler takes it verbatim.
  if (process.platform === 'win32') execFile('rundll32', ['url.dll,FileProtocolHandler', url]);
  else if (process.platform === 'darwin') execFile('open', [url]);
  else execFile('xdg-open', [url]);
}

export async function login(resourceUrl) {
  const { prm, as } = await discover(resourceUrl);
  let clientId = process.env.BENCH_EXECUTOR_CLIENT_ID;
  let reg = null;
  if (!clientId) {
    reg = await register(as);
    clientId = reg.client_id;
  }
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));
  const auth = new URL(as.authorization_endpoint);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', REDIRECT_URI);
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
  auth.searchParams.set('state', state);
  auth.searchParams.set('resource', resourceUrl);
  if (prm?.scopes_supported?.length) auth.searchParams.set('scope', prm.scopes_supported.join(' '));

  console.log('\nOpening the browser for Robinhood consent…');
  console.log('If nothing opens, paste this URL into the browser yourself:\n\n  ' + auth.href + '\n');
  openBrowser(auth.href);

  const code = await waitForCode(state);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
    resource: resourceUrl,
  });
  const tokens = await fetchJson(as.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const store = {
    resource: resourceUrl,
    as,
    client_id: clientId,
    client_secret: reg?.client_secret,
    tokens: { ...tokens, obtained_at: Date.now() },
  };
  saveStore(store);
  return store;
}

export async function getAccessToken() {
  if (process.env.BENCH_EXECUTOR_TOKEN) return process.env.BENCH_EXECUTOR_TOKEN;
  const store = loadStore();
  if (!store?.tokens?.access_token) {
    throw new Error('No token on file — run: node executor/executor.mjs login');
  }
  const { tokens } = store;
  const ageSec = (Date.now() - (tokens.obtained_at ?? 0)) / 1000;
  if (!tokens.expires_in || ageSec < tokens.expires_in - 60) return tokens.access_token;
  if (!tokens.refresh_token) return tokens.access_token; // let the server 401 if truly dead
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: store.client_id,
  });
  if (store.client_secret) body.set('client_secret', store.client_secret);
  const fresh = await fetchJson(store.as.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  store.tokens = { ...store.tokens, ...fresh, obtained_at: Date.now() };
  saveStore(store);
  return store.tokens.access_token;
}
