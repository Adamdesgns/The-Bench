// Invite one beta member from a trusted terminal.
// Usage: node scripts/invite-beta-user.js person@example.com

const email = String(process.argv[2] || "").trim().toLowerCase();
const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const origin = String(process.env.APP_ORIGIN || "").replace(/\/$/, "");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Pass one valid email address");
if (!url || !key || !origin) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and APP_ORIGIN are required");

async function json(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label} failed (${response.status})`);
  return body;
}

const invited = await json(await fetch(`${url}/auth/v1/invite?redirect_to=${encodeURIComponent(origin)}`, {
  method: "POST",
  headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ email }),
  signal: AbortSignal.timeout(20_000),
}), "Auth invite");

await json(await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(invited.id)}`, {
  method: "PUT",
  headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ app_metadata: { bench_beta: "invited" } }),
  signal: AbortSignal.timeout(20_000),
}), "Beta authorization");
await json(await fetch(`${url}/rest/v1/bench_beta_invites?on_conflict=email`, {
  method: "POST",
  headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=representation" },
  body: JSON.stringify({ email, user_id: invited.id, status: "active" }),
  signal: AbortSignal.timeout(20_000),
}), "Beta membership");

console.log(`Invited ${email} to The Bench beta.`);