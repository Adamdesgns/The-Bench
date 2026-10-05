import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { XecutorService } from "../server/xecutor/service.js";
import { XecutorStore } from "../server/xecutor/store.js";
import { hashPayload } from "../server/xecutor/canonical.js";

const START_MS = Date.parse("2026-08-26T15:00:00.000Z");

function makeHarness(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "the-xecutor-service-"));
  let nowMs = START_MS;
  const clock = () => new Date(nowMs);
  const store = new XecutorStore(dataDir, { clock });
  const service = new XecutorService(store, { clock });
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return {
    dataDir,
    store,
    service,
    clock,
    advance(ms) { nowMs += ms; },
  };
}

function handoff(clock, overrides = {}) {
  const createdAt = new Date(clock().getTime() - 60_000);
  return {
    schema_version: "bench-execution-handoff-v1",
    plan_id: `B-138:${createdAt.toISOString()}`,
    row_id: "B-138",
    framework_version: "v26",
    executor_version: "bench-executor-v1",
    created_at: createdAt.toISOString(),
    expires_at: new Date(clock().getTime() + 30 * 60_000).toISOString(),
    account_alias: "AGENTIC-7724",
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
    ...overrides,
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test("Stage 1 starts simulation-only, live-disabled, and BLOCK ALL enabled", async (t) => {
  const { service, store, clock } = makeHarness(t);
  const state = service.gatewayStatus();

  assert.equal(state.mode, "SIMULATION_ONLY");
  assert.equal(state.live_execution, false);
  assert.equal(state.kill_switch, true);
  assert.equal(state.audit.ok, true);

  await expectCode(service.createProposal({
    sourceClient: "chatgpt",
    clientSubmissionId: "blocked-at-boot",
    handoff: handoff(clock),
  }), "GATEWAY_HALTED");
  assert.equal(store.listProposals().length, 0);
});

test("unlock admits a valid frozen proposal; replay is idempotent and changed replay conflicts", async (t) => {
  const { service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const order = handoff(clock);

  const first = await service.createProposal({
    sourceClient: "chatgpt",
    clientSubmissionId: "chat-order-001",
    handoff: order,
  });
  assert.equal(first.replayed, false);
  assert.equal(first.proposal.state, "AWAITING_APPROVAL");
  assert.equal(first.proposal.validation.ok, true);
  assert.equal(first.proposal.source_client, "chatgpt");

  const replay = await service.createProposal({
    sourceClient: "chatgpt",
    clientSubmissionId: "chat-order-001",
    handoff: structuredClone(order),
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.proposal.id, first.proposal.id);
  assert.equal(store.listProposals().length, 1);

  await expectCode(service.createProposal({
    sourceClient: "chatgpt",
    clientSubmissionId: "chat-order-001",
    handoff: { ...order, ticker: "MSFT" },
  }), "IDEMPOTENCY_CONFLICT");
  assert.equal(store.listProposals().length, 1);
});

test("unknown handoff fields and malformed tickers fail closed", async (t) => {
  const { service, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const result = await service.createProposal({
    sourceClient: "claude",
    clientSubmissionId: "strict-contract-001",
    handoff: handoff(clock, { ticker: "ms ft", broker_hint: "ignore-policy" }),
  });
  const codes = result.proposal.validation.refusals.map((row) => row.code);

  assert.equal(result.proposal.state, "PREFLIGHT_REFUSED");
  assert.ok(codes.includes("X01_UNKNOWN_FIELD"), codes.join(", "));
  assert.ok(codes.includes("X02_TICKER_INVALID"), codes.join(", "));
});

test("plan identifiers are structurally validated rather than merely present", async (t) => {
  const { service, clock } = makeHarness(t);
  await service.setKillSwitch(false);

  const badPlan = await service.createProposal({
    sourceClient: "grok",
    clientSubmissionId: "bad-plan-id",
    handoff: handoff(clock, { plan_id: "not-a-bench-plan" }),
  });
  assert.equal(badPlan.proposal.state, "PREFLIGHT_REFUSED", "plan_id must be structurally validated");
  assert.ok(
    badPlan.proposal.validation.refusals.some((row) => /plan_id/i.test(`${row.code} ${row.message}`)),
    "plan_id refusal should be explicit",
  );
});

test("declared risk reconciles with quantity, limit, and invalidation arithmetic", async (t) => {
  const { service, clock } = makeHarness(t);
  await service.setKillSwitch(false);

  const inconsistentRisk = await service.createProposal({
    sourceClient: "grok",
    clientSubmissionId: "bad-risk-arithmetic",
    handoff: handoff(clock, {
      plan_id: `B-139:${new Date(clock().getTime() - 60_000).toISOString()}`,
      row_id: "B-139",
      quantity_mode: "shares",
      quantity_value: 2,
      limit_price: 2,
      invalidation_price: 1.9,
      planned_dollar_risk: 3,
      exit_owner: "SEPARATE_STOP_ORDER",
    }),
  });
  assert.equal(inconsistentRisk.proposal.state, "PREFLIGHT_REFUSED", "declared risk must match quantity and invalidation arithmetic");
  assert.ok(
    inconsistentRisk.proposal.validation.refusals.some((row) => /risk|reconcil/i.test(`${row.code} ${row.message}`)),
    "risk-arithmetic refusal should be explicit",
  );
});

test("proposal visibility and withdrawal are scoped to the authenticated source and terminal", async (t) => {
  const { service, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const created = await service.createProposal({
    sourceClient: "chatgpt",
    clientSubmissionId: "source-scope-001",
    handoff: handoff(clock),
  });
  const id = created.proposal.id;

  assert.throws(
    () => service.getProposal(id, { sourceClient: "claude" }),
    (error) => error.code === "PROPOSAL_NOT_FOUND",
  );
  assert.equal(service.listProposals({ sourceClient: "claude" }).length, 0);
  assert.equal(service.listProposals({ sourceClient: "chatgpt" }).length, 1);
  await expectCode(service.withdraw(id, { sourceClient: "claude" }), "PROPOSAL_NOT_FOUND");

  const withdrawn = await service.withdraw(id, { sourceClient: "chatgpt", reason: "analysis changed" });
  assert.equal(withdrawn.state, "WITHDRAWN");
  await expectCode(service.withdraw(id, { sourceClient: "chatgpt" }), "PROPOSAL_TERMINAL");
  await expectCode(service.approve(id, { confirmation: "anything" }), "PROPOSAL_TERMINAL");
});

test("approval requires the exact frozen confirmation and concurrent attempts create one simulation receipt", async (t) => {
  const { service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const created = await service.createProposal({
    sourceClient: "claude",
    clientSubmissionId: "approval-race-001",
    handoff: handoff(clock),
  });
  const id = created.proposal.id;
  const ownerView = service.getProposal(id, { includeConfirmation: true });

  await expectCode(service.approve(id, { confirmation: `${ownerView.confirmation_text} ` }), "CONFIRMATION_MISMATCH");
  assert.equal(store.getReceipt(id), null);
  assert.equal(service.getProposal(id).state, "AWAITING_APPROVAL");

  const attempts = await Promise.allSettled([
    service.approve(id, { confirmation: ownerView.confirmation_text }),
    service.approve(id, { confirmation: ownerView.confirmation_text }),
  ]);
  const fulfilled = attempts.filter((result) => result.status === "fulfilled");
  const rejected = attempts.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "PROPOSAL_TERMINAL");
  assert.equal(fulfilled[0].value.state, "SIMULATION_COMPLETE");
  assert.equal(fulfilled[0].value.simulation.broker_order_created, false);
  assert.match(fulfilled[0].value.simulation.statement, /NO BROKER ORDER/i);
  assert.equal(readdirSync(store.receiptsDir).filter((name) => name.endsWith(".json")).length, 1);
  assert.equal(service.audit({ proposalId: id }).filter((row) => row.event === "SIMULATION_COMMITTED").length, 1);
});

test("proposal, receipt, and hash-chained audit survive a service restart", async (t) => {
  const { dataDir, service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const created = await service.createProposal({
    sourceClient: "grok",
    clientSubmissionId: "restart-001",
    handoff: handoff(clock),
  });
  const ownerView = service.getProposal(created.proposal.id, { includeConfirmation: true });
  await service.approve(created.proposal.id, { confirmation: ownerView.confirmation_text });
  const before = store.verifyAudit();

  const reopenedStore = new XecutorStore(dataDir, { clock });
  const reopenedService = new XecutorService(reopenedStore, { clock });
  const after = reopenedStore.verifyAudit();
  const proposal = reopenedService.getProposal(created.proposal.id, { includeConfirmation: true });

  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  assert.equal(after.count, before.count + 1, "each restart records GATEWAY_STARTED_BLOCKED");
  assert.equal(reopenedService.audit().filter((row) => row.event === "GATEWAY_STARTED_BLOCKED").length, 2);
  assert.equal(reopenedService.gatewayStatus().kill_switch, true);
  assert.equal(proposal.state, "SIMULATION_COMPLETE");
  assert.equal(proposal.simulation.broker_order_created, false);
  assert.equal(reopenedStore.getReceipt(created.proposal.id).state, "SIMULATION_COMPLETE");
});

test("an interrupted approval cannot strand APPROVED state beside a receipt-only commit", async (t) => {
  const { service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const created = await service.createProposal({
    sourceClient: "claude",
    clientSubmissionId: "approval-crash-001",
    handoff: handoff(clock),
  });
  const ownerView = service.getProposal(created.proposal.id, { includeConfirmation: true });
  const appendAudit = store.appendAudit.bind(store);
  store.appendAudit = (event) => {
    if (event.event === "SIMULATION_COMMITTED") throw new Error("injected crash after receipt write");
    return appendAudit(event);
  };

  await assert.rejects(
    service.approve(created.proposal.id, { confirmation: ownerView.confirmation_text }),
    /injected crash/,
  );
  const persisted = store.getProposal(created.proposal.id);
  const receipt = store.getReceipt(created.proposal.id);
  const consistent =
    (persisted.state === "AWAITING_APPROVAL" && receipt === null) ||
    (persisted.state === "SIMULATION_COMPLETE" && receipt?.state === "SIMULATION_COMPLETE");
  assert.equal(
    consistent,
    true,
    `approval commit is inconsistent after interruption: state=${persisted.state}, receipt=${receipt?.state || "none"}`,
  );
});

test("failure before the final proposal replacement re-reads durable state and never strands APPROVED", async (t) => {
  const { service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const created = await service.createProposal({
    sourceClient: "grok",
    clientSubmissionId: "final-proposal-save-crash",
    handoff: handoff(clock),
  });
  const ownerView = service.getProposal(created.proposal.id, { includeConfirmation: true });
  const saveProposalWithAudit = store.saveProposalWithAudit.bind(store);
  store.saveProposalWithAudit = (proposal, events) => {
    if (proposal.state === "SIMULATION_COMPLETE") throw new Error("injected failure before final proposal replacement");
    return saveProposalWithAudit(proposal, events);
  };

  await assert.rejects(
    service.approve(created.proposal.id, { confirmation: ownerView.confirmation_text }),
    (error) => error.code === "SIMULATION_COMMIT_INTERRUPTED",
  );
  const durable = store.getProposal(created.proposal.id);
  const receipt = store.getReceipt(created.proposal.id);
  assert.notEqual(durable.state, "APPROVED", "durable proposal must be reconciled after final-save failure");
  assert.ok(["SIMULATION_COMPLETE", "SIMULATION_INTERRUPTED"].includes(durable.state));
  assert.equal(receipt?.state, "SIMULATION_COMPLETE");
  assert.equal(service.gatewayStatus().kill_switch, true);
});

test("HUMAN_CONFIRMED audit flush failure fails closed without leaving durable APPROVED", async (t) => {
  const { service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const created = await service.createProposal({
    sourceClient: "claude",
    clientSubmissionId: "human-confirmed-audit-crash",
    handoff: handoff(clock),
  });
  const ownerView = service.getProposal(created.proposal.id, { includeConfirmation: true });
  const flushProposalAudit = store.flushProposalAudit.bind(store);
  let injected = false;
  store.flushProposalAudit = (id) => {
    const durable = store.getProposal(id);
    const containsHumanConfirmation = durable?._audit_outbox?.some((event) => event.event === "HUMAN_CONFIRMED");
    if (!injected && containsHumanConfirmation) {
      injected = true;
      throw new Error("injected HUMAN_CONFIRMED audit flush failure");
    }
    return flushProposalAudit(id);
  };

  await assert.rejects(
    service.approve(created.proposal.id, { confirmation: ownerView.confirmation_text }),
    (error) => error.code === "SIMULATION_COMMIT_INTERRUPTED",
  );
  const durable = store.getProposal(created.proposal.id);
  assert.equal(injected, true);
  assert.notEqual(durable.state, "APPROVED");
  assert.equal(durable.state, "SIMULATION_INTERRUPTED");
  assert.equal(store.getReceipt(created.proposal.id), null);
  assert.equal(service.gatewayStatus().kill_switch, true);
});

test("every service restart persistently re-enables BLOCK ALL", async (t) => {
  const { dataDir, service, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  assert.equal(service.gatewayStatus().kill_switch, false);

  const secondStore = new XecutorStore(dataDir, { clock });
  const secondService = new XecutorService(secondStore, { clock });
  assert.equal(secondService.gatewayStatus().kill_switch, true);
  await secondService.setKillSwitch(false);
  assert.equal(secondService.gatewayStatus().kill_switch, false);

  const thirdStore = new XecutorStore(dataDir, { clock });
  const thirdService = new XecutorService(thirdStore, { clock });
  assert.equal(thirdService.gatewayStatus().kill_switch, true);
  assert.equal(thirdService.audit().filter((row) => row.event === "GATEWAY_STARTED_BLOCKED").length, 3);
});

test("proposal audit outbox replays after post-audit crash without duplicate events", async (t) => {
  const { dataDir, service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const originalFlush = store.flushProposalAudit.bind(store);
  store.flushProposalAudit = (id) => {
    const durable = store.getProposal(id);
    store.flushEvents(durable._audit_outbox || []);
    throw new Error("injected crash after proposal audit append");
  };

  await assert.rejects(service.createProposal({
    sourceClient: "chatgpt",
    clientSubmissionId: "proposal-outbox-crash",
    handoff: handoff(clock),
  }), /injected crash/);
  store.flushProposalAudit = originalFlush;

  const stranded = store.listProposals()[0];
  assert.ok(Array.isArray(stranded._audit_outbox));
  assert.equal(store.readAudit({ proposalId: stranded.id }).filter((row) => row.event === "PROPOSAL_RECEIVED").length, 1);
  assert.equal(store.readAudit({ proposalId: stranded.id }).filter((row) => row.event === "CONTRACT_VALIDATED").length, 1);

  const reopenedStore = new XecutorStore(dataDir, { clock });
  const reopenedService = new XecutorService(reopenedStore, { clock });
  const recovered = reopenedStore.getProposal(stranded.id);
  assert.equal("_audit_outbox" in recovered, false);
  assert.equal(reopenedService.audit({ proposalId: stranded.id }).filter((row) => row.event === "PROPOSAL_RECEIVED").length, 1);
  assert.equal(reopenedService.audit({ proposalId: stranded.id }).filter((row) => row.event === "CONTRACT_VALIDATED").length, 1);
  assert.equal(reopenedStore.verifyAudit().ok, true);
});

test("state audit outbox replays after post-audit crash without duplicate events", async (t) => {
  const { dataDir, service, store, clock } = makeHarness(t);
  const originalFlush = store.flushStateAudit.bind(store);
  store.flushStateAudit = () => {
    const durable = store.readState();
    store.flushEvents(durable._audit_outbox || []);
    throw new Error("injected crash after state audit append");
  };

  await assert.rejects(service.setKillSwitch(false), /injected crash/);
  store.flushStateAudit = originalFlush;
  assert.equal(store.readState().kill_switch, true, "effective state must fail closed while an audit outbox is pending");
  assert.equal(JSON.parse(readFileSync(store.statePath, "utf8")).kill_switch, true, "raw durable state must also remain blocked");
  assert.ok(Array.isArray(store.readState()._audit_outbox));
  assert.equal(store.readAudit().filter((row) => row.event === "SIMULATOR_UNLOCKED").length, 1);
  await assert.rejects(
    service.createProposal({
      sourceClient: "chatgpt",
      clientSubmissionId: "must-not-enter-after-unlock-audit-failure",
      handoff: handoff(clock),
    }),
    (error) => ["GATEWAY_HALTED", "AUDIT_RECOVERY_REQUIRED"].includes(error.code),
  );
  assert.equal(store.listProposals().length, 0);

  const reopenedStore = new XecutorStore(dataDir, { clock });
  const reopenedService = new XecutorService(reopenedStore, { clock });
  assert.equal("_audit_outbox" in reopenedStore.readState(), false);
  assert.equal(reopenedService.gatewayStatus().kill_switch, true);
  assert.equal(reopenedService.audit().filter((row) => row.event === "SIMULATOR_UNLOCKED").length, 1);
  assert.equal(reopenedStore.verifyAudit().ok, true);
});

test("audit tip anchoring repairs an append-before-tip window but rejects history truncation", async (t) => {
  const { dataDir, service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);

  const eventFiles = readdirSync(store.auditDir)
    .filter((name) => /^event-\d{10}\.json$/.test(name))
    .sort();
  assert.ok(eventFiles.length >= 2);

  const anchoredTip = JSON.parse(readFileSync(store.tipPath, "utf8"));
  const previousEvent = JSON.parse(readFileSync(join(store.auditDir, eventFiles.at(-2)), "utf8"));

  // Simulate the crash window where the event reached disk before tip.json was advanced.
  writeFileSync(store.tipPath, `${JSON.stringify({ seq: previousEvent.seq, hash: previousEvent.hash }, null, 2)}\n`);
  const repairedStore = new XecutorStore(dataDir, { clock });
  assert.deepEqual(JSON.parse(readFileSync(repairedStore.tipPath, "utf8")), anchoredTip);
  assert.equal(repairedStore.verifyAudit().ok, true);

  // A durable tip is an anchor: losing its final event must never roll the tip backward.
  rmSync(join(store.auditDir, eventFiles.at(-1)));
  assert.throws(
    () => new XecutorStore(dataDir, { clock }),
    /audit history is shorter than or conflicts with its durable tip; fail closed/,
  );
  assert.deepEqual(JSON.parse(readFileSync(store.tipPath, "utf8")), anchoredTip);
});

test("tampered simulation receipt fails reconciliation and enables BLOCK ALL", async (t) => {
  const { dataDir, service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const created = await service.createProposal({
    sourceClient: "grok",
    clientSubmissionId: "tampered-receipt",
    handoff: handoff(clock),
  });
  const ownerView = service.getProposal(created.proposal.id, { includeConfirmation: true });
  await service.approve(created.proposal.id, { confirmation: ownerView.confirmation_text });
  const receipt = store.getReceipt(created.proposal.id);
  receipt.order_hash = "0".repeat(64);
  writeFileSync(join(store.receiptsDir, `${created.proposal.id}.json`), `${JSON.stringify(receipt, null, 2)}\n`);

  const reopenedStore = new XecutorStore(dataDir, { clock });
  const reopenedService = new XecutorService(reopenedStore, { clock });
  assert.equal(reopenedService.getProposal(created.proposal.id).state, "SIMULATION_INTERRUPTED");
  assert.equal(reopenedService.gatewayStatus().kill_switch, true);
  assert.equal(reopenedService.audit({ proposalId: created.proposal.id }).filter((row) => row.event === "SIMULATION_INTERRUPTED").length, 1);
});

test("tampered proposal simulation fails reconciliation even when its durable receipt remains valid", async (t) => {
  const { dataDir, service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const created = await service.createProposal({
    sourceClient: "claude",
    clientSubmissionId: "tampered-proposal-simulation",
    handoff: handoff(clock),
  });
  const ownerView = service.getProposal(created.proposal.id, { includeConfirmation: true });
  await service.approve(created.proposal.id, { confirmation: ownerView.confirmation_text });
  const proposal = store.getProposal(created.proposal.id);
  proposal.simulation.computed_notional = 999;
  store.saveProposal(proposal);

  const reopenedStore = new XecutorStore(dataDir, { clock });
  const reopenedService = new XecutorService(reopenedStore, { clock });
  assert.equal(reopenedService.getProposal(created.proposal.id).state, "SIMULATION_INTERRUPTED");
  assert.equal(reopenedService.gatewayStatus().kill_switch, true);
});

test("tampered proposal handoff fails reconciliation while order hash and receipt remain untouched", async (t) => {
  const { dataDir, service, store, clock } = makeHarness(t);
  await service.setKillSwitch(false);
  const created = await service.createProposal({
    sourceClient: "grok",
    clientSubmissionId: "tampered-proposal-handoff",
    handoff: handoff(clock),
  });
  const ownerView = service.getProposal(created.proposal.id, { includeConfirmation: true });
  await service.approve(created.proposal.id, { confirmation: ownerView.confirmation_text });
  const receiptBefore = store.getReceipt(created.proposal.id);
  const proposal = store.getProposal(created.proposal.id);
  const originalOrderHash = proposal.order_hash;
  proposal.handoff.ticker = "MSFT";
  store.saveProposal(proposal);

  const reopenedStore = new XecutorStore(dataDir, { clock });
  const reopenedService = new XecutorService(reopenedStore, { clock });
  const recovered = reopenedService.getProposal(created.proposal.id);
  const receiptAfter = reopenedStore.getReceipt(created.proposal.id);
  assert.equal(recovered.order_hash, originalOrderHash);
  assert.deepEqual(receiptAfter, receiptBefore);
  assert.equal(recovered.state, "SIMULATION_INTERRUPTED");
  assert.equal(reopenedService.gatewayStatus().kill_switch, true);
});

test("approval-time shared validation rejects non-canonical timestamps and plan/risk mismatches", async (t) => {
  const cases = [
    {
      name: "non-canonical timestamp",
      expectedCode: "R04_STALE_PLAN",
      mutate(proposal) {
        proposal.handoff.created_at = proposal.handoff.created_at.replace(".000Z", "Z");
        proposal.handoff.plan_id = `${proposal.handoff.row_id}:${proposal.handoff.created_at}`;
      },
    },
    {
      name: "plan id mismatch",
      expectedCode: "X05_PLAN_ID_INVALID",
      mutate(proposal) { proposal.handoff.plan_id = `B-999:${proposal.handoff.created_at}`; },
    },
    {
      name: "risk mismatch",
      expectedCode: "X06_RISK_ARITHMETIC_MISMATCH",
      mutate(proposal) { proposal.handoff.planned_dollar_risk = 1; },
    },
  ];

  for (const [index, spec] of cases.entries()) {
    await t.test(spec.name, async (subtest) => {
      const { service, store, clock } = makeHarness(subtest);
      await service.setKillSwitch(false);
      const created = await service.createProposal({
        sourceClient: "chatgpt",
        clientSubmissionId: `approval-revalidation-${index}`,
        handoff: handoff(clock),
      });
      const proposal = store.getProposal(created.proposal.id);
      spec.mutate(proposal);
      proposal.order_hash = hashPayload(proposal.handoff);
      store.saveProposal(proposal);
      const ownerView = service.getProposal(created.proposal.id, { includeConfirmation: true });

      await expectCode(
        service.approve(created.proposal.id, { confirmation: ownerView.confirmation_text }),
        "REVALIDATION_REFUSED",
      );
      const refused = service.getProposal(created.proposal.id);
      assert.equal(refused.state, "PREFLIGHT_REFUSED");
      assert.ok(
        refused.validation.refusals.some((row) => row.code === spec.expectedCode),
        refused.validation.refusals.map((row) => row.code).join(", "),
      );
    });
  }
});
