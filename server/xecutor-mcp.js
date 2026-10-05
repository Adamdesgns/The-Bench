// Local stdio bridge. One running The Xecutor HTTP process owns all writes.
// Configure each bot with its own bearer token and this command.
const endpoint = process.env.XECUTOR_ENDPOINT || "http://127.0.0.1:8140/mcp";
const token = process.env.XECUTOR_CLIENT_TOKEN;
if (!token) {
  process.stderr.write("[the-xecutor-mcp] XECUTOR_CLIENT_TOKEN is required; no unauthenticated fallback exists.\n");
  process.exit(1);
}

let buffer = "";
const pending = new Set();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const task = forward(line).catch((error) => process.stderr.write(`[the-xecutor-mcp] ${error.message}\n`));
    pending.add(task);
    task.finally(() => pending.delete(task));
  }
});
process.stdin.on("end", async () => { await Promise.allSettled([...pending]); });

async function forward(line) {
  let parsed;
  try { parsed = JSON.parse(line); }
  catch { throw new Error("invalid JSON from MCP client"); }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(parsed),
  });
  if (response.status === 202) return;
  const text = await response.text();
  if (!response.ok) throw new Error(`gateway returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  process.stdout.write(`${text}\n`);
}
