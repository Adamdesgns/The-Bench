import { randomBytes } from "node:crypto";
import {
  computedNotional,
  validateHandoff,
} from "../../scripts/executor-validate.mjs";
import { cloneJson, deepFreeze, hashPayload, safeEqual, sha256, signPayload } from "./canonical.js";
import { APPROVAL_TTL_MS, XECUTOR_MODE, XECUTOR_VERSION } from "./runtime.js";

export class XecutorError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "XecutorError";
    this.code = code;
    this.status = status;
  }
}

function nowIso(clock) { return clock().toISOString(); }

export class XecutorService {
  constructor(store, { clock = () => new Date() } = {}) {
    this.store = store;
    this.clock = clock;
    this.writeQueue = Promise.resolve();
    this.store.recoverAuditOutboxes();
    this.store.writeStateWithAudit({ kill_switch: true }, [{
      proposal_id: null,
      actor: "xecutor-startup",
      event: "GATEWAY_STARTED_BLOCKED",
      detail: { mode: XECUTOR_MODE, live_execution: false },
    }]);
    this.recoverInterrupted();
  }

  persistProposal(proposal, events = []) {
    return this.store.saveProposalWithAudit(proposal, events);
  }

  persistState(next, events = []) {
    return this.store.writeStateWithAudit(next, events);
  }

  assertAuditReady() {
    if (this.store.hasPendingAuditOutbox()) {
      throw new XecutorError("AUDIT_RECOVERY_REQUIRED", "a durable audit write is incomplete; BLOCK ALL and restart The Xecutor", 503);
    }
  }

  serialize(fn) {
    const run = this.writeQueue.then(fn, fn);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  gatewayStatus() {
    const { _audit_outbox, ...state } = this.store.readState();
    if (this.store.hasPendingAuditOutbox()) state.kill_switch = true;
    return {
      ...state,
      service_version: XECUTOR_VERSION,
      audit: this.store.verifyAudit(),
      pending_count: this.store.listProposals().filter((p) => this.refreshExpiry(p).state === "AWAITING_APPROVAL").length,
    };
  }

  listProposals({ sourceClient = null, includeConfirmation = false } = {}) {
    return this.store.listProposals()
      .map((proposal) => this.refreshExpiry(proposal))
      .filter((proposal) => !sourceClient || proposal.source_client === sourceClient)
      .map((proposal) => this.present(proposal, includeConfirmation));
  }

  getProposal(id, { sourceClient = null, includeConfirmation = false } = {}) {
    const found = this.store.getProposal(id);
    if (!found || (sourceClient && found.source_client !== sourceClient)) {
      throw new XecutorError("PROPOSAL_NOT_FOUND", "proposal not found", 404);
    }
    return this.present(this.refreshExpiry(found), includeConfirmation);
  }

  createProposal({ sourceClient, clientSubmissionId, handoff, demo = false }) {
    return this.serialize(() => {
      this.assertAuditReady();
      if (this.store.readState().kill_switch) throw new XecutorError("GATEWAY_HALTED", "The Xecutor is blocking all new order actions", 423);
      if (!/^[a-z][a-z0-9_-]{1,31}$/.test(String(sourceClient || ""))) {
        throw new XecutorError("CLIENT_ID_INVALID", "authenticated client identity is invalid", 401);
      }
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(String(clientSubmissionId || ""))) {
        throw new XecutorError("CLIENT_SUBMISSION_ID_INVALID", "client_submission_id is required and must be 1-128 safe characters");
      }
      if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
        throw new XecutorError("HANDOFF_INVALID", "handoff must be an object");
      }

      const frozenHandoff = deepFreeze(cloneJson(handoff));
      const orderHash = hashPayload(frozenHandoff);
      const id = `XEC-${sha256(`${sourceClient}\u0000${clientSubmissionId}`).slice(0, 16).toUpperCase()}`;
      const existing = this.store.getProposal(id);
      if (existing) {
        if (!safeEqual(existing.order_hash, orderHash)) {
          throw new XecutorError("IDEMPOTENCY_CONFLICT", "this client_submission_id already names a different frozen order", 409);
        }
        return { proposal: this.present(this.refreshExpiry(existing), false), replayed: true };
      }

      const contract = validateHandoff(frozenHandoff, { now: this.clock(), receiptsDir: this.store.receiptsDir });
      const refusals = [...contract.refusals];
      const duplicatePlan = this.store.listProposals().find((proposal) => proposal.handoff?.plan_id === frozenHandoff.plan_id);
      if (duplicatePlan) refusals.push({ code: "R03_DUPLICATE_PLAN_ID", message: `plan_id already exists as ${duplicatePlan.id}` });

      const createdAt = nowIso(this.clock);
      const proposal = {
        schema_version: "xecutor-proposal-v1",
        id,
        source_client: sourceClient,
        client_submission_id: clientSubmissionId,
        mode: XECUTOR_MODE,
        state: refusals.length ? "PREFLIGHT_REFUSED" : "AWAITING_APPROVAL",
        created_at: createdAt,
        updated_at: createdAt,
        expires_at: frozenHandoff.expires_at ?? null,
        order_hash: orderHash,
        review_ref: `SIM-${orderHash.slice(0, 8).toUpperCase()}`,
        demo: Boolean(demo),
        handoff: cloneJson(frozenHandoff),
        validation: { ok: refusals.length === 0, refusals },
        approval: null,
        simulation: null,
      };
      const saved = this.persistProposal(proposal, [{
          proposal_id: id,
          actor: `bot:${sourceClient}`,
          event: "PROPOSAL_RECEIVED",
          detail: { client_submission_id: clientSubmissionId, order_hash: orderHash, demo: Boolean(demo) },
        }, {
          proposal_id: id,
          actor: "xecutor-policy",
          event: refusals.length ? "PREFLIGHT_REFUSED" : "CONTRACT_VALIDATED",
          detail: refusals.length ? { refusals } : { policy_version: this.store.readState().policy_version },
        }]);
      return { proposal: this.present(saved, false), replayed: false };
    });
  }

  createDemoProposal() {
    const created = this.clock();
    return this.createProposal({
      sourceClient: "demo-console",
      clientSubmissionId: `demo-${created.getTime()}`,
      demo: true,
      handoff: {
        schema_version: "bench-execution-handoff-v1",
        plan_id: `B-138:${created.toISOString()}`,
        row_id: "B-138",
        framework_version: "v26",
        executor_version: "bench-executor-v1",
        created_at: created.toISOString(),
        expires_at: new Date(created.getTime() + 30 * 60 * 1000).toISOString(),
        account_alias: "AGENTIC-0000",
        asset_class: "equity",
        ticker: "TEST",
        action: "BUY",
        lane: "base_swing",
        structure: "long_shares",
        quantity_mode: "notional",
        quantity_value: 4.5,
        order_type: "LIMIT",
        limit_price: 22.1,
        time_in_force: "DAY",
        session: "REGULAR_HOURS_ONLY",
        invalidation_price: 21.1,
        planned_dollar_risk: 4.5,
        executor_absolute_ceiling: 5,
        maximum_price_drift: "$0.25",
        exit_owner: "MANUAL",
        concentrated: false,
        leveraged_product: false,
        conviction_bet: false,
      },
    });
  }

  approve(id, { confirmation, actor = "adam-local" } = {}) {
    return this.serialize(() => {
      this.assertAuditReady();
      if (this.store.readState().kill_switch) throw new XecutorError("GATEWAY_HALTED", "BLOCK ALL is active", 423);
      let proposal = this.requirePending(id);
      if (!safeEqual(proposal.order_hash, hashPayload(proposal.handoff))) {
        throw new XecutorError("PAYLOAD_DIGEST_MISMATCH", "the frozen order no longer matches its approval fingerprint", 409);
      }
      const expected = this.confirmationText(proposal);
      if (!safeEqual(String(confirmation || ""), expected)) {
        throw new XecutorError("CONFIRMATION_MISMATCH", "confirmation must exactly match the frozen order review", 409);
      }
      const validation = validateHandoff(proposal.handoff, { now: this.clock(), receiptsDir: this.store.receiptsDir });
      if (!validation.ok) {
        proposal.state = "PREFLIGHT_REFUSED";
        proposal.validation = validation;
        proposal = this.persistProposal(proposal, [{ proposal_id: id, actor: "xecutor-policy", event: "PREFLIGHT_REFUSED", detail: validation }]);
        throw new XecutorError("REVALIDATION_REFUSED", "the proposal failed approval-time revalidation", 409);
      }

      const issuedAt = this.clock();
      const approvalPayload = {
        proposal_id: proposal.id,
        order_hash: proposal.order_hash,
        review_ref: proposal.review_ref,
        nonce: randomBytes(16).toString("hex"),
        issued_at: issuedAt.toISOString(),
        expires_at: new Date(issuedAt.getTime() + APPROVAL_TTL_MS).toISOString(),
        actor,
      };
      proposal.approval = { ...approvalPayload, signature: signPayload(this.store.approvalKey(), approvalPayload), consumed_at: null };
      proposal.state = "APPROVED";
      try {
        proposal = this.persistProposal(proposal, [{ proposal_id: id, actor, event: "HUMAN_CONFIRMED", detail: { order_hash: proposal.order_hash, review_ref: proposal.review_ref } }]);
        const simulatedAt = this.clock().toISOString();
        const receipt = {
          schema_version: "xecutor-simulation-receipt-v1",
          proposal_id: proposal.id,
          plan_id: proposal.handoff.plan_id,
          source_client: proposal.source_client,
          mode: XECUTOR_MODE,
          state: "SIMULATION_COMPLETE",
          broker_order_created: false,
          order_hash: proposal.order_hash,
          approval_signature: proposal.approval.signature,
          simulated_order_id: `SIM-${sha256(`${proposal.id}\u0000${proposal.order_hash}`).slice(0, 16).toUpperCase()}`,
          simulated_at: simulatedAt,
          account_alias: proposal.handoff.account_alias,
          ticker: proposal.handoff.ticker,
          action: proposal.handoff.action,
          computed_notional: computedNotional(proposal.handoff),
          statement: "SIMULATION COMPLETE — NO BROKER ORDER WAS CREATED.",
        };
        const receiptFile = this.store.writeReceipt(proposal.id, receipt);
        proposal.approval.consumed_at = simulatedAt;
        proposal.simulation = { ...receipt, receipt_file: receiptFile };
        proposal.state = "SIMULATION_COMPLETE";
        proposal = this.persistProposal(proposal, [{
          proposal_id: id,
          actor: "xecutor-simulator",
          event: "SIMULATION_COMMITTED",
          detail: { simulated_order_id: receipt.simulated_order_id, broker_order_created: false },
        }, {
          proposal_id: id,
          actor: "xecutor-store",
          event: "RECEIPT_WRITTEN",
          detail: { receipt_file: receiptFile },
        }]);
        return this.present(proposal, true);
      } catch (error) {
        try {
          this.persistState({ kill_switch: true }, [{ proposal_id: id, actor: "xecutor-fail-closed", event: "BLOCK_ALL_ENABLED", detail: { reason: "simulation commit interrupted" } }]);
        } catch { /* an outbox remains durable for startup recovery */ }
        try {
          this.recoverOne(this.store.getProposal(id) || proposal);
        } catch (recoveryError) {
          try {
            const durable = this.store.getProposal(id) || proposal;
            durable.state = "SIMULATION_INTERRUPTED";
            durable.interruption = {
              at: nowIso(this.clock),
              reason: `simulation receipt exists but durable proposal reconciliation failed: ${recoveryError.message}`.slice(0, 400),
            };
            this.persistProposal(durable, [{
              proposal_id: id,
              actor: "xecutor-recovery",
              event: "SIMULATION_INTERRUPTED",
              detail: durable.interruption,
            }]);
          } catch { /* BLOCK ALL remains durable; startup retries reconciliation */ }
        }
        throw new XecutorError("SIMULATION_COMMIT_INTERRUPTED", `simulation commit was interrupted and BLOCK ALL was enabled: ${error.message}`, 500);
      }
    });
  }

  reject(id, { reason = "Rejected by Adam", actor = "adam-local" } = {}) {
    return this.serialize(() => {
      this.assertAuditReady();
      const proposal = this.requirePending(id);
      proposal.state = "REJECTED";
      proposal.rejection = { actor, reason: String(reason || "Rejected by Adam").slice(0, 240), at: nowIso(this.clock) };
      const saved = this.persistProposal(proposal, [{ proposal_id: id, actor, event: "HUMAN_REJECTED", detail: { reason: proposal.rejection.reason } }]);
      return this.present(saved, true);
    });
  }

  withdraw(id, { sourceClient, reason = "Withdrawn by source bot" } = {}) {
    return this.serialize(() => {
      this.assertAuditReady();
      const proposal = this.store.getProposal(id);
      if (!proposal || proposal.source_client !== sourceClient) throw new XecutorError("PROPOSAL_NOT_FOUND", "proposal not found", 404);
      const refreshed = this.refreshExpiry(proposal);
      if (refreshed.state !== "AWAITING_APPROVAL") throw new XecutorError("PROPOSAL_TERMINAL", `proposal is already ${refreshed.state}`, 409);
      refreshed.state = "WITHDRAWN";
      refreshed.withdrawal = { actor: `bot:${sourceClient}`, reason: String(reason).slice(0, 240), at: nowIso(this.clock) };
      const saved = this.persistProposal(refreshed, [{ proposal_id: id, actor: `bot:${sourceClient}`, event: "SOURCE_WITHDREW", detail: { reason: refreshed.withdrawal.reason } }]);
      return this.present(saved, false);
    });
  }

  setKillSwitch(enabled, { actor = "adam-local" } = {}) {
    return this.serialize(() => {
      if (typeof enabled !== "boolean") throw new XecutorError("KILL_SWITCH_INVALID", "enabled must be true or false");
      if (!enabled) this.assertAuditReady();
      try {
        return this.persistState({ kill_switch: enabled }, [{ proposal_id: null, actor, event: enabled ? "BLOCK_ALL_ENABLED" : "SIMULATOR_UNLOCKED", detail: { mode: XECUTOR_MODE } }]);
      } catch (error) {
        if (!enabled) {
          try {
            this.persistState({ kill_switch: true }, [{ proposal_id: null, actor: "xecutor-fail-closed", event: "BLOCK_ALL_ENABLED", detail: { reason: "simulator unlock did not commit cleanly" } }]);
          } catch {
            this.store.writeState({ kill_switch: true });
          }
        }
        throw error;
      }
    });
  }

  requirePending(id) {
    const found = this.store.getProposal(id);
    if (!found) throw new XecutorError("PROPOSAL_NOT_FOUND", "proposal not found", 404);
    const proposal = this.refreshExpiry(found);
    if (proposal.state !== "AWAITING_APPROVAL") {
      throw new XecutorError("PROPOSAL_TERMINAL", `proposal is ${proposal.state}; it cannot be approved or changed`, 409);
    }
    return proposal;
  }

  refreshExpiry(proposal) {
    if (proposal.state !== "AWAITING_APPROVAL") return proposal;
    const expires = Date.parse(proposal.expires_at);
    if (!Number.isNaN(expires) && expires <= this.clock().getTime()) {
      proposal.state = "EXPIRED";
      const saved = this.persistProposal(proposal, [{ proposal_id: proposal.id, actor: "xecutor-clock", event: "PROPOSAL_EXPIRED", detail: { expires_at: proposal.expires_at } }]);
      return saved;
    }
    return proposal;
  }

  confirmationText(proposal) {
    const notional = computedNotional(proposal.handoff);
    return `CONFIRM ${proposal.handoff.plan_id} ${proposal.review_ref} $${Number(notional).toFixed(2)}`;
  }

  approvalProofMatches(proposal, receipt = null) {
    const approval = proposal.approval;
    if (!approval || typeof approval !== "object" || !approval.signature) return false;
    const { signature, consumed_at, ...payload } = approval;
    if (!safeEqual(signature, signPayload(this.store.approvalKey(), payload))) return false;
    const issued = Date.parse(payload.issued_at);
    const expires = Date.parse(payload.expires_at);
    if (Number.isNaN(issued) || Number.isNaN(expires) || expires <= issued || expires - issued !== APPROVAL_TTL_MS) return false;
    if (!safeEqual(payload.proposal_id || "", proposal.id) ||
        !safeEqual(payload.order_hash || "", proposal.order_hash) ||
        !safeEqual(payload.review_ref || "", proposal.review_ref)) return false;
    if (receipt) {
      const simulated = Date.parse(receipt.simulated_at);
      if (Number.isNaN(simulated) || simulated < issued || simulated > expires) return false;
      if (consumed_at && !safeEqual(consumed_at, receipt.simulated_at)) return false;
    }
    return true;
  }

  present(proposal, includeConfirmation) {
    const out = cloneJson(proposal);
    delete out._audit_outbox;
    if (includeConfirmation && out.state === "AWAITING_APPROVAL") out.confirmation_text = this.confirmationText(out);
    return out;
  }

  audit(options) { return this.store.readAudit(options); }

  recoverInterrupted() {
    for (const proposal of this.store.listProposals()) {
      if (proposal.state === "APPROVED") this.recoverOne(proposal);
      if (proposal.state === "SIMULATION_COMPLETE") this.recoverOne(proposal);
    }
  }

  recoverOne(proposal) {
    const receipt = this.store.getReceipt(proposal.id);
    const expectedSimulationId = `SIM-${sha256(`${proposal.id}\u0000${proposal.order_hash}`).slice(0, 16).toUpperCase()}`;
    const handoffMatches = proposal.handoff && typeof proposal.handoff === "object" &&
      safeEqual(hashPayload(proposal.handoff), proposal.order_hash || "");
    const receiptMatches = handoffMatches && receipt &&
      receipt.state === "SIMULATION_COMPLETE" &&
      receipt.broker_order_created === false &&
      receipt.proposal_id === proposal.id &&
      receipt.mode === XECUTOR_MODE &&
      safeEqual(receipt.order_hash || "", proposal.order_hash || "") &&
      safeEqual(receipt.approval_signature || "", proposal.approval?.signature || "") &&
      receipt.simulated_order_id === expectedSimulationId &&
      this.approvalProofMatches(proposal, receipt);
    const expectedStoredSimulation = receiptMatches ? { ...receipt, receipt_file: `${proposal.id}.json` } : null;
    if (receiptMatches && proposal.state === "SIMULATION_COMPLETE" &&
        proposal.simulation && typeof proposal.simulation === "object" &&
        safeEqual(hashPayload(proposal.simulation), hashPayload(expectedStoredSimulation)) &&
        safeEqual(proposal.approval?.consumed_at || "", receipt.simulated_at || "")) {
      return proposal;
    }
    if (receiptMatches && proposal.state === "APPROVED") {
      proposal.approval = proposal.approval || null;
      if (proposal.approval) proposal.approval.consumed_at = receipt.simulated_at;
      proposal.simulation = expectedStoredSimulation;
      proposal.state = "SIMULATION_COMPLETE";
      const saved = this.persistProposal(proposal, [{ proposal_id: proposal.id, actor: "xecutor-recovery", event: "SIMULATION_RECEIPT_RECOVERED", detail: { receipt_file: `${proposal.id}.json` } }]);
      return saved;
    }
    this.persistState({ kill_switch: true }, [{
      proposal_id: proposal.id,
      actor: "xecutor-recovery",
      event: "BLOCK_ALL_ENABLED",
      detail: { reason: "simulation receipt reconciliation failed" },
    }]);
    proposal.state = "SIMULATION_INTERRUPTED";
    proposal.interruption = { at: nowIso(this.clock), reason: "approval or terminal state exists without a complete, matching simulation receipt" };
    const saved = this.persistProposal(proposal, [{ proposal_id: proposal.id, actor: "xecutor-recovery", event: "SIMULATION_INTERRUPTED", detail: proposal.interruption }]);
    return saved;
  }
}
