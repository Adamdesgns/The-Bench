// codes.mjs — one-time load codes. Made at setup in a real terminal, shown
// once, never saved in plain text. The PC keeps only scrypt hashes, so a
// program reading this PC's files cannot produce a valid code, and a code
// seen on the phone topic is burned the first time it is used.
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

// No 0/o, 1/l/i: easy to read off a photo and type on a phone.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const SCRYPT = { N: 16384, r: 8, p: 1 };
export const CODE_LEN = 10; // about 49 bits each

export function normalizeCode(code) {
  return String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function makeCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

function digest(code, saltHex) {
  return scryptSync(normalizeCode(code), Buffer.from(saltHex, 'hex'), 32, SCRYPT).toString('hex');
}

/** A fresh set: `codes` are shown once and dropped; `store` is what is saved. */
export function makeCodeSet(n = 40) {
  const salt = randomBytes(16).toString('hex');
  const codes = Array.from({ length: n }, makeCode);
  const store = { salt, hashes: codes.map((c) => ({ h: digest(c, salt), used: null })) };
  return { codes, store };
}

/**
 * Check a code against the stored set. Returns 'ok' (and marks it used),
 * 'used' (a burned code: a replay, not a guess) or 'wrong'.
 */
export function useCode(store, code, nowIso = new Date().toISOString()) {
  const norm = normalizeCode(code);
  if (norm.length !== CODE_LEN || !store?.salt || !Array.isArray(store.hashes)) return 'wrong';
  const h = Buffer.from(digest(norm, store.salt), 'hex');
  let hit = null;
  for (const rec of store.hashes) {
    const other = Buffer.from(rec.h, 'hex');
    if (other.length === h.length && timingSafeEqual(other, h)) hit = rec; // no early exit
  }
  if (!hit) return 'wrong';
  if (hit.used) return 'used';
  hit.used = nowIso;
  return 'ok';
}

/**
 * Burn a code seen on the topic in a message the trader will not act on (too
 * old, sent while locked, or not a valid command). A code that has been on
 * the topic is never valid again. Returns true if an unused code was burned.
 * Never counts as a wrong code.
 */
export function burnCode(store, code, nowIso = new Date().toISOString()) {
  const norm = normalizeCode(code);
  if (norm.length !== CODE_LEN || !store?.salt || !Array.isArray(store.hashes)) return false;
  const h = Buffer.from(digest(norm, store.salt), 'hex');
  let burned = false;
  for (const rec of store.hashes) {
    const other = Buffer.from(rec.h, 'hex');
    if (other.length === h.length && timingSafeEqual(other, h) && !rec.used) { rec.used = nowIso; burned = true; }
  }
  return burned;
}

export function codesLeft(store) {
  return (store?.hashes ?? []).filter((r) => !r.used).length;
}
