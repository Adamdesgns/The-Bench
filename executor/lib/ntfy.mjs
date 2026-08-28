// ntfy.mjs — every report line also reaches the phone (topic bench-adam-7x3,
// the Bench's standing channel). An alert failure is logged and swallowed:
// alarms must never block the kill sequence.

export const ALERT_TOPIC = 'https://ntfy.sh/bench-adam-7x3';

export async function alert(line, { title = 'BENCH EXECUTOR', priority = 'high', fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(ALERT_TOPIC, {
      method: 'POST',
      headers: { Title: title, Priority: priority },
      body: line,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error(`[ntfy] alert failed (${err.message}) — continuing; alarms never block the kill sequence`);
    return false;
  }
}
