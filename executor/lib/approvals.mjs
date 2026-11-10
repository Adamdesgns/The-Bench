// approvals.mjs — Adam's one-time codes and the approvals they unlock, held in
// one durable file outside the repo. The PC keeps only salted hashes of the
// codes, so reading this file does not reveal an unused code. A code never
// goes into a receipt, a log or a phone message.
//
// What this does NOT stop: anything that can rewrite this file or the program
// on this PC. It stops a stray or tricked AI session from posting an ARM. A
// process running as Adam can append an 'active' approval here, or call
// newCodes(), and the watcher will act on it: nothing on the PC alone can prove
// an approval came from the phone. See the open risk in
// docs/executor-test-protocol.md.
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALPHABET, STATE_DIR } from './ticket.mjs';

export const CODE_COUNT = 20;
export const CODE_LENGTH = 8;
export const WRONG_CODES_BEFORE_LOCK = 3;
const SEEN_MESSAGES_KEPT = 1000;
const REAPPROVABLE = new Set(['void', 'halted']);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const hashCode = (secret, salt) => scryptSync(secret, salt, 32, SCRYPT);

const emptyState = () => ({ version: 1, rev: 0, codes: [], wrong_codes: 0, locked: false, seen: [], approvals: [] });

// Another process wrote the file after this one read it. The caller stops:
// acting on an old copy could undo a HALT or bring back a spent code.
export class StateChangedError extends Error {}

export class ApprovalStore {
  constructor(dir = STATE_DIR) {
    this.dir = dir;
    this.path = join(dir, 'real-order-state.json');
    mkdirSync(dir, { recursive: true });
    // An unreadable state file throws, and the tick that loaded it refuses everything.
    this.state = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : emptyState();
  }

  // Saves only if the file on disk is still the one this store read. Every
  // save bumps `rev`, so a tick that hung and woke up after another tick ran
  // cannot write its stale copy over the newer state.
  save() {
    const loadedRev = this.state.rev ?? 0;
    if (existsSync(this.path)) {
      const onDisk = JSON.parse(readFileSync(this.path, 'utf8'));
      if ((onDisk.rev ?? 0) !== loadedRev) {
        throw new StateChangedError(`real-order state changed under this process (read rev ${loadedRev}, file has rev ${onDisk.rev ?? 0}); stopping`);
      }
    } else if (loadedRev > 0) {
      throw new StateChangedError('real-order state file disappeared under this process; stopping');
    }
    this.state.rev = loadedRev + 1;
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.path); // a crash leaves the old file or the new one, never half of one
  }

  // Returns the plain codes exactly once. Only their hashes are stored.
  newCodes(count = CODE_COUNT) {
    const plain = [];
    this.state.codes = [];
    for (let i = 1; i <= count; i++) {
      let secret = '';
      for (let c = 0; c < CODE_LENGTH; c++) secret += ALPHABET[randomInt(ALPHABET.length)];
      const salt = randomBytes(16);
      this.state.codes.push({ index: i, salt: salt.toString('hex'), hash: hashCode(secret, salt).toString('hex'), used: false });
      plain.push(`${String(i).padStart(2, '0')}-${secret}`);
    }
    this.state.wrong_codes = 0;
    this.state.locked = false;
    this.state.codes_made_at = new Date().toISOString();
    this.save();
    return plain;
  }

  codesLeft() { return this.state.codes.filter((c) => !c.used).length; }

  // Burns the code on success, written to disk before the caller acts on it.
  // Anything but 'ok' counts toward the lock unless `count` is false.
  useCode(code, { count = true } = {}) {
    const m = String(code).match(/^(\d{2})-(.+)$/);
    const entry = m ? this.state.codes.find((c) => c.index === Number(m[1])) : null;
    let result = 'wrong';
    if (entry && entry.used) {
      result = 'used';
    } else if (entry && timingSafeEqual(hashCode(m[2], Buffer.from(entry.salt, 'hex')), Buffer.from(entry.hash, 'hex'))) {
      entry.used = true;
      this.state.wrong_codes = 0;
      this.save();
      return 'ok';
    }
    if (!count) return result;
    this.state.wrong_codes += 1;
    if (this.state.wrong_codes >= WRONG_CODES_BEFORE_LOCK) this.state.locked = true;
    this.save();
    return result;
  }

  get locked() { return this.state.locked; }

  flag(key, value) {
    this.state[key] = value;
    this.save();
  }

  unlock() {
    this.state.locked = false;
    this.state.wrong_codes = 0;
    this.save();
  }

  hasSeen(id) { return this.state.seen.includes(id); }

  markSeen(id) {
    this.state.seen.push(id);
    if (this.state.seen.length > SEEN_MESSAGES_KEPT) this.state.seen = this.state.seen.slice(-SEEN_MESSAGES_KEPT);
    this.save();
  }

  approvalFor(planId) { return this.state.approvals.find((a) => a.plan_id === planId) ?? null; }
  byStatus(status) { return this.state.approvals.filter((a) => a.status === status); }

  // ticket_digest is the full SHA-256 of the approved ticket; the six-letter
  // ticket_code is only a typing aid. ingested_at is when this PC accepted it.
  // An approval that was cancelled before any attempt (void: a phone gap, a
  // missing or changed ticket; halted: HALT) may be replaced by a fresh ARM
  // with a fresh code. One that reached an attempt never can, so nothing is
  // ever sent twice. The replaced record is kept for the audit trail.
  canReapprove(planId) {
    const prior = this.approvalFor(planId);
    return !prior || REAPPROVABLE.has(prior.status);
  }

  addApproval({ plan_id, row_id, ticket_code, ticket_digest, message_id, approved_at, ingested_at }) {
    if (!this.canReapprove(plan_id)) throw new Error(`${plan_id} was already approved and attempted`);
    const i = this.state.approvals.findIndex((a) => a.plan_id === plan_id);
    if (i >= 0) {
      this.state.replaced = [...(this.state.replaced ?? []), this.state.approvals[i]].slice(-200);
      this.state.approvals.splice(i, 1);
    }
    const approval = { plan_id, row_id, ticket_code, ticket_digest, message_id, approved_at, ingested_at, status: 'active', detail: null };
    this.state.approvals.push(approval);
    this.save();
    return approval;
  }

  setStatus(planId, status, detail = null) {
    const a = this.approvalFor(planId);
    if (!a) throw new Error(`no approval for ${planId}`);
    a.status = status;
    a.detail = detail;
    this.save();
  }

  note(planId, key, value) {
    const a = this.approvalFor(planId);
    if (!a) throw new Error(`no approval for ${planId}`);
    a[key] = value;
    this.save();
  }

  // HALT stops every approval made before it. Returns the ones it stopped.
  haltBefore(timeSec) {
    const stopped = this.state.approvals.filter((a) => a.status === 'active' && a.approved_at <= timeSec);
    for (const a of stopped) { a.status = 'halted'; a.detail = 'HALT from the phone'; }
    this.save();
    return stopped;
  }
}
