import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleMcpMessage, XECUTOR_TOOLS } from "../server/xecutor/mcp-tools.js";
import { XecutorService } from "../server/xecutor/service.js";
import { XecutorStore } from "../server/xecutor/store.js";

const NOW = new Date("2026-08-26T15:00:00.000Z");

function makeService(t) {
  const dataDir = mkdtempSync(join(tmpdir(), "the-xecutor-mcp-"));
  const clock = () => new Date(NOW);
  const service = new XecutorService(new XecutorStore(dataDir, { clock }), { clock });
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return { service, clock };
}

function handoff(clock) {
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
  };
}

function call(id, name, args = {}) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function content(reply) {
  return JSON.parse(reply.result.content[0].text);
}

test("MCP advertises exactly the three proposal-only tools", async (t) => {
  const { service } = makeService(t);
  const reply = await handleMcpMessage(service, "chatgpt", { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  const names = reply.result.tools.map((tool) => tool.name);

  assert.deepEqual(names, ["propose_order", "get_order_status", "withdraw_proposal"]);
  assert.deepEqual(XECUTOR_TOOLS.map((tool) => tool.name), names);
  assert.equal(names.some((name) => /approve|confirm|execute|place|broker/i.test(name)), false);
  for (const tool of reply.result.tools) assert.equal(tool.inputSchema.additionalProperties, false);
});

test("MCP proposal/status/withdraw flow stays source-scoped and never reveals owner confirmation", async (t) => {
  const { service, clock } = makeService(t);
  await service.setKillSwitch(false);

  const proposedReply = await handleMcpMessage(service, "chatgpt", call(1, "propose_order", {
    client_submission_id: "mcp-order-001",
    handoff: handoff(clock),
  }));
  assert.equal(proposedReply.result.isError, false);
  const proposed = content(proposedReply);
  assert.equal(proposed.proposal.state, "AWAITING_APPROVAL");
  assert.equal("confirmation_text" in proposed.proposal, false);

  const statusReply = await handleMcpMessage(service, "chatgpt", call(2, "get_order_status", {
    proposal_id: proposed.proposal.id,
  }));
  const status = content(statusReply);
  assert.equal(status.source_client, "chatgpt");
  assert.equal("confirmation_text" in status, false);

  const crossSourceReply = await handleMcpMessage(service, "claude", call(3, "get_order_status", {
    proposal_id: proposed.proposal.id,
  }));
  assert.equal(crossSourceReply.result.isError, true);
  assert.equal(content(crossSourceReply).code, "PROPOSAL_NOT_FOUND");

  const withdrawnReply = await handleMcpMessage(service, "chatgpt", call(4, "withdraw_proposal", {
    proposal_id: proposed.proposal.id,
    reason: "source analysis changed",
  }));
  assert.equal(withdrawnReply.result.isError, false);
  assert.equal(content(withdrawnReply).state, "WITHDRAWN");
});

test("approval and execution names are unavailable even when called directly", async (t) => {
  const { service } = makeService(t);
  for (const name of ["approve_order", "confirm_order", "execute", "place_order"]) {
    const reply = await handleMcpMessage(service, "grok", call(name, name, {}));
    assert.equal(reply.result.isError, true, `${name} must be unavailable`);
    assert.equal(content(reply).code, "TOOL_NOT_FOUND");
  }
});
