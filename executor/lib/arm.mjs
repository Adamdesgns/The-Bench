// arm.mjs — reads and halts the default-OFF arm switch. Same topic and same
// semantics as scripts/executor-arm.mjs (the writer); this is the reader the
// executor program uses. Fail closed: any doubt reads as OFF.

export const ARM_TOPIC = 'https://ntfy.sh/bench-exec-arm-v7q2m9k4x1';

// Pure — exported for tests. `msg` is the latest ntfy message object or null.
export function stateOf(msg, nowMs = Date.now()) {
  if (!msg) return { state: 'OFF', row: null, why: 'no messages on the arm topic' };
  const ageMin = (nowMs / 1000 - msg.time) / 60;
  const arm = String(msg.message ?? '').match(/^ARM (B-\d+)/);
  if (!arm) return { state: 'OFF', row: null, why: `latest message is "${msg.message}" (${ageMin.toFixed(0)} min ago)` };
  const win = parseFloat((String(msg.message).match(/window (\d+(?:\.\d+)?)h/) || [])[1] ?? '4');
  if (ageMin > win * 60) return { state: 'OFF', row: null, why: `ARM ${arm[1]} expired ${(ageMin - win * 60).toFixed(0)} min ago` };
  return { state: 'ARMED', row: arm[1], why: `${(win * 60 - ageMin).toFixed(0)} min left in the ${win}h window` };
}

export async function readSwitch(fetchImpl = fetch) {
  const res = await fetchImpl(`${ARM_TOPIC}/json?poll=1&since=12h`);
  if (!res.ok) throw new Error(`arm topic read failed: HTTP ${res.status} — fail closed, treat as NOT armed`);
  const text = await res.text();
  const msgs = text.trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l)).filter((m) => m.event === 'message');
  return stateOf(msgs.length ? msgs[msgs.length - 1] : null);
}

// One arm = one placement attempt. The program halts its own switch after
// acting (success OR failure), matching the executor-arm design.
export async function halt(reason, fetchImpl = fetch) {
  const res = await fetchImpl(ARM_TOPIC, {
    method: 'POST',
    headers: { Title: 'BENCH EXECUTOR - DISARMED', Priority: 'high' },
    body: reason ? `HALT ${reason}` : 'HALT',
  });
  if (!res.ok) throw new Error(`HALT publish failed: HTTP ${res.status}`);
}
