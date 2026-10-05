import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { canonicalJson, cloneJson, sha256 } from "./canonical.js";

const GENESIS = "GENESIS";
const SECRET_KEY_RE = /(?:secret|token|password|credential|private[_-]?key)/i;
const ID_RE = /^XEC-[A-F0-9]{16}$/;

function iso(now = new Date()) { return now.toISOString(); }
function json(path) { return JSON.parse(readFileSync(path, "utf8")); }

function atomicJson(path, value) {
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(tmp, path);
}

function atomicJsonExclusive(path, value) {
  if (existsSync(path)) throw Object.assign(new Error(`durable record already exists: ${basename(path)}`), { code: "DURABLE_DUPLICATE" });
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(tmp, path);
}

function clean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 1600 ? `${value.slice(0, 1600)}…` : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 80).map(clean);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SECRET_KEY_RE.test(key) ? "[redacted]" : clean(child);
  }
  return out;
}

export class XecutorStore {
  constructor(root, { clock = () => new Date(), processLock = false } = {}) {
    this.root = resolve(root);
    this.clock = clock;
    this.proposalsDir = join(this.root, "proposals");
    this.receiptsDir = join(this.root, "receipts");
    this.auditDir = join(this.root, "audit");
    this.statePath = join(this.root, "state.json");
    this.tipPath = join(this.auditDir, "tip.json");
    this.approvalKeyPath = join(this.root, "approval.key");
    this.lockPath = join(this.root, "runtime.lock");
    this.lockToken = null;
    this.exitHandler = null;
    mkdirSync(this.root, { recursive: true });
    if (processLock) this.acquireProcessLock();
    try {
      this.ensure();
    } catch (error) {
      this.releaseProcessLock({ silent: true });
      throw error;
    }
  }

  acquireProcessLock() {
    const claim = () => {
      const token = randomBytes(24).toString("hex");
      writeFileSync(this.lockPath, `${JSON.stringify({ pid: process.pid, token, started_at: iso(this.clock()) }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      this.lockToken = token;
      this.exitHandler = () => this.releaseProcessLock({ silent: true, fromExit: true });
      process.once("exit", this.exitHandler);
    };
    try {
      claim();
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    let prior;
    try { prior = json(this.lockPath); }
    catch { throw Object.assign(new Error("The Xecutor runtime lock is unreadable; remove it only after verifying no Xecutor process is running"), { code: "XECUTOR_LOCK_INVALID" }); }
    const priorPid = Number(prior?.pid);
    if (!Number.isInteger(priorPid) || priorPid <= 0 || typeof prior?.token !== "string") {
      throw Object.assign(new Error("The Xecutor runtime lock is invalid; refusing concurrent access"), { code: "XECUTOR_LOCK_INVALID" });
    }
    try {
      process.kill(priorPid, 0);
      throw Object.assign(new Error(`The Xecutor is already running as process ${priorPid}`), { code: "XECUTOR_ALREADY_RUNNING" });
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
    unlinkSync(this.lockPath);
    claim();
  }

  releaseProcessLock({ silent = false, fromExit = false } = {}) {
    if (!this.lockToken) return false;
    try {
      const current = json(this.lockPath);
      if (current?.token !== this.lockToken || Number(current?.pid) !== process.pid) {
        throw new Error("The Xecutor runtime lock ownership changed; refusing to remove it");
      }
      unlinkSync(this.lockPath);
      if (!fromExit && this.exitHandler) process.off("exit", this.exitHandler);
      this.lockToken = null;
      this.exitHandler = null;
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.lockToken = null;
        this.exitHandler = null;
        return false;
      }
      if (!silent) throw error;
      return false;
    }
  }

  ensure() {
    for (const dir of [this.root, this.proposalsDir, this.receiptsDir, this.auditDir]) {
      mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(this.statePath)) {
      atomicJson(this.statePath, {
        schema_version: "xecutor-runtime-v1",
        mode: "SIMULATION_ONLY",
        live_execution: false,
        kill_switch: true,
        policy_version: "xecutor-stage1-v1",
        updated_at: iso(this.clock()),
      });
    }
    if (!existsSync(this.tipPath)) atomicJson(this.tipPath, { seq: 0, hash: GENESIS });
    if (!existsSync(this.approvalKeyPath)) {
      writeFileSync(this.approvalKeyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    }
    const state = this.readState();
    if (state.mode !== "SIMULATION_ONLY" || state.live_execution !== false) {
      throw new Error("The Xecutor Stage 1 refuses to start unless mode is SIMULATION_ONLY and live_execution is false");
    }
    this.reconcileAuditTip();
    const integrity = this.verifyAudit();
    if (!integrity.ok) throw new Error(`Xecutor audit chain is broken at sequence ${integrity.broken_at ?? "unknown"}; fail closed`);
  }

  readState() {
    const state = json(this.statePath);
    if (!state || state.schema_version !== "xecutor-runtime-v1") throw new Error("invalid Xecutor state file");
    if (Array.isArray(state._audit_outbox) && state._audit_outbox.length) state.kill_switch = true;
    return cloneJson(state);
  }

  hasPendingAuditOutbox() {
    const state = json(this.statePath);
    if (Array.isArray(state._audit_outbox) && state._audit_outbox.length) return true;
    return this.listProposals().some((proposal) => Array.isArray(proposal._audit_outbox) && proposal._audit_outbox.length);
  }

  writeState(next) {
    const state = {
      ...this.readState(),
      ...cloneJson(next),
      mode: "SIMULATION_ONLY",
      live_execution: false,
      updated_at: iso(this.clock()),
    };
    atomicJson(this.statePath, state);
    return cloneJson(state);
  }

  mutationEvents(events = []) {
    return events.map((event) => ({
      mutation_id: event.mutation_id || `MUT-${randomBytes(16).toString("hex")}`,
      proposal_id: event.proposal_id ?? null,
      actor: event.actor ?? "system",
      event: event.event ?? "EVENT",
      detail: cloneJson(event.detail ?? null),
    }));
  }

  writeStateWithAudit(next, events = []) {
    const current = this.readState();
    const state = {
      ...current,
      ...cloneJson(next),
      mode: "SIMULATION_ONLY",
      live_execution: false,
      updated_at: iso(this.clock()),
      _audit_outbox: [
        ...(Array.isArray(current._audit_outbox) ? current._audit_outbox : []),
        ...this.mutationEvents(events),
      ],
    };
    atomicJson(this.statePath, state);
    return this.flushStateAudit();
  }

  approvalKey() { return readFileSync(this.approvalKeyPath); }

  proposalPath(id) {
    if (!ID_RE.test(String(id))) throw Object.assign(new Error("invalid proposal id"), { code: "INVALID_PROPOSAL_ID" });
    return join(this.proposalsDir, `${id}.json`);
  }

  getProposal(id) {
    const path = this.proposalPath(id);
    return existsSync(path) ? cloneJson(json(path)) : null;
  }

  listProposals() {
    return readdirSync(this.proposalsDir)
      .filter((name) => /^XEC-[A-F0-9]{16}\.json$/.test(name))
      .map((name) => cloneJson(json(join(this.proposalsDir, name))))
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  saveProposal(proposal) {
    const copy = cloneJson(proposal);
    copy.updated_at = iso(this.clock());
    atomicJson(this.proposalPath(copy.id), copy);
    return cloneJson(copy);
  }

  saveProposalWithAudit(proposal, events = []) {
    const copy = cloneJson(proposal);
    copy.updated_at = iso(this.clock());
    copy._audit_outbox = [
      ...(Array.isArray(copy._audit_outbox) ? copy._audit_outbox : []),
      ...this.mutationEvents(events),
    ];
    atomicJson(this.proposalPath(copy.id), copy);
    return this.flushProposalAudit(copy.id);
  }

  writeReceipt(proposalId, receipt) {
    this.proposalPath(proposalId);
    const path = join(this.receiptsDir, `${proposalId}.json`);
    atomicJsonExclusive(path, clean(receipt));
    return basename(path);
  }

  getReceipt(proposalId) {
    this.proposalPath(proposalId);
    const path = join(this.receiptsDir, `${proposalId}.json`);
    return existsSync(path) ? cloneJson(json(path)) : null;
  }

  appendAudit(event) {
    const tip = this.reconcileAuditTip();
    const ts = iso(this.clock());
    const record = {
      seq: Number(tip.seq) + 1,
      ts,
      mutation_id: event.mutation_id || `MUT-${randomBytes(16).toString("hex")}`,
      proposal_id: event.proposal_id ?? null,
      actor: event.actor ?? "system",
      event: event.event ?? "EVENT",
      detail: clean(event.detail ?? null),
      prev_hash: tip.hash,
    };
    record.hash = sha256(canonicalJson(record) + tip.hash);
    const eventPath = join(this.auditDir, `event-${String(record.seq).padStart(10, "0")}.json`);
    atomicJsonExclusive(eventPath, record);
    atomicJson(this.tipPath, { seq: record.seq, hash: record.hash });
    return cloneJson(record);
  }

  auditMutationIds() {
    return new Set(readdirSync(this.auditDir)
      .filter((name) => /^event-\d{10}\.json$/.test(name))
      .map((name) => json(join(this.auditDir, name)).mutation_id)
      .filter(Boolean));
  }

  flushEvents(events) {
    const committed = this.auditMutationIds();
    for (const event of events) {
      if (!committed.has(event.mutation_id)) {
        this.appendAudit(event);
        committed.add(event.mutation_id);
      }
    }
  }

  flushProposalAudit(id) {
    const path = this.proposalPath(id);
    const proposal = json(path);
    const outbox = Array.isArray(proposal._audit_outbox) ? proposal._audit_outbox : [];
    if (!outbox.length) return cloneJson(proposal);
    this.flushEvents(outbox);
    delete proposal._audit_outbox;
    atomicJson(path, proposal);
    return cloneJson(proposal);
  }

  flushStateAudit() {
    const state = json(this.statePath);
    const outbox = Array.isArray(state._audit_outbox) ? state._audit_outbox : [];
    if (!outbox.length) return cloneJson(state);
    this.flushEvents(outbox);
    delete state._audit_outbox;
    atomicJson(this.statePath, state);
    return cloneJson(state);
  }

  recoverAuditOutboxes() {
    this.flushStateAudit();
    for (const proposal of this.listProposals()) this.flushProposalAudit(proposal.id);
  }

  readAudit({ proposalId = null, limit = 200 } = {}) {
    const rows = readdirSync(this.auditDir)
      .filter((name) => /^event-\d{10}\.json$/.test(name))
      .sort()
      .map((name) => json(join(this.auditDir, name)))
      .filter((row) => !proposalId || row.proposal_id === proposalId);
    return rows.reverse().slice(0, Math.max(1, Math.min(Number(limit) || 200, 1000))).map(cloneJson);
  }

  deriveAudit() {
    let previous = GENESIS;
    let count = 0;
    const files = readdirSync(this.auditDir).filter((name) => /^event-\d{10}\.json$/.test(name)).sort();
    for (const file of files) {
      let record;
      try { record = json(join(this.auditDir, file)); }
      catch { return { ok: false, count, broken_at: count + 1 }; }
      const { hash, ...body } = record;
      const expected = sha256(canonicalJson(body) + previous);
      if (record.seq !== count + 1 || record.prev_hash !== previous || hash !== expected) {
        return { ok: false, count, broken_at: record.seq ?? null };
      }
      previous = hash;
      count += 1;
    }
    return { ok: true, count, tip: previous };
  }

  reconcileAuditTip() {
    const derived = this.deriveAudit();
    if (!derived.ok) throw new Error(`Xecutor audit chain is broken at sequence ${derived.broken_at ?? "unknown"}; fail closed`);
    const current = json(this.tipPath);
    const seq = Number(current.seq);
    if (!Number.isInteger(seq) || seq < 0 || typeof current.hash !== "string") {
      throw new Error("Xecutor audit tip is invalid; fail closed");
    }
    if (seq === derived.count && current.hash === derived.tip) return current;
    if (seq >= derived.count) {
      throw new Error("Xecutor audit history is shorter than or conflicts with its durable tip; fail closed");
    }
    const prefixHash = seq === 0
      ? GENESIS
      : json(join(this.auditDir, `event-${String(seq).padStart(10, "0")}.json`)).hash;
    if (prefixHash !== current.hash) {
      throw new Error("Xecutor audit extension does not match its durable tip; fail closed");
    }
    const repaired = { seq: derived.count, hash: derived.tip };
    atomicJson(this.tipPath, repaired);
    return repaired;
  }

  verifyAudit() {
    const derived = this.deriveAudit();
    if (!derived.ok) return derived;
    const tip = json(this.tipPath);
    if (Number(tip.seq) !== derived.count || tip.hash !== derived.tip) return { ok: false, count: derived.count, broken_at: Number(tip.seq) || null };
    return derived;
  }
}
