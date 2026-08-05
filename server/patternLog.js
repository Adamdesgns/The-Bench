// patternLog.js — observed market patterns, with instances and a hit rate. Pure.
//
// WHY THIS EXISTS: v23's Self-Audit Loop says to improve the framework from
// "structural gaps or repeated patterns, never single outcomes." But nothing
// records repetition, so the loop has no data and cannot fire. Every pattern
// this system has noticed lives in prose — daily notes, post text, chat — where
// it can be read but never counted.
//
// Adam, 2026-08-04: "every time you see a pattern of why the market moved this
// way it needs to be logged. we need every single piece of data we can get to
// figure out what works."
//
// THE BOOK records calls: one ticker, one verdict, scoreable at 30 days.
// THIS records claims about how the tape behaves, tested across many names.
//
// The hard rule: a pattern with no falsification test is refused. "Beats get
// sold" is a vibe. "Post-earnings 2-day return is negative for names up 8%+ in
// the 5 sessions before the print" is a claim that can be wrong, which is the
// only kind worth keeping.
//
// Spec: docs/book-integrity-spec.md

// Below this many instances, a pattern is a coincidence with a nice story.
const PROMOTION_THRESHOLD = 3;

const round1 = (n) => Math.round(n * 10) / 10;

export function nextPatternId(patterns = []) {
  const highest = patterns.reduce((max, p) => {
    const m = /^P-(\d+)$/.exec(p?.id ?? "");
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `P-${String(highest + 1).padStart(3, "0")}`;
}

// Returns the reasons this pattern must NOT be logged. Empty = loggable.
export function validatePattern(input) {
  const problems = [];
  if (!input || typeof input !== "object") return ["pattern is not an object"];

  if (!input.claim) problems.push("claim is missing — what does the tape do?");
  if (!input.test) {
    problems.push(
      "test is missing — describe what would prove this WRONG. " +
        "A pattern that cannot fail is not a pattern, it is a story."
    );
  }
  if (!input.first_seen) problems.push("first_seen date is missing");

  return problems;
}

// Returns the reasons this instance must NOT be attached.
export function validateInstance(input) {
  const problems = [];
  if (!input || typeof input !== "object") return ["instance is not an object"];

  if (!input.ticker) problems.push("ticker is missing");
  if (!input.date) problems.push("date is missing");
  if (typeof input.holds !== "boolean") {
    problems.push(
      "holds must be true or false — an instance that does not say whether the " +
        "pattern held is decoration, and it will quietly inflate the hit rate"
    );
  }

  return problems;
}

export function buildPattern(input, patterns = []) {
  const problems = validatePattern(input);
  if (problems.length) {
    throw new Error(`refusing to log pattern: ${problems.join("; ")}`);
  }

  return {
    id: nextPatternId(patterns),
    claim: input.claim,
    test: input.test,
    first_seen: input.first_seen,
    // proposed -> supported | refuted, decided by the instances, never by hand
    status: "proposed",
    why: input.why ?? null,
    logged_by: input.source ?? "claude",
    instances: [],
  };
}

// Status is derived, never asserted. Once there are enough instances to matter,
// the majority decides — including deciding against us.
function statusFor(instances) {
  if (instances.length < PROMOTION_THRESHOLD) return "proposed";
  const held = instances.filter((i) => i.holds).length;
  return held > instances.length / 2 ? "supported" : "refuted";
}

// Returns a NEW pattern with the instance appended. Throws on a bad instance.
export function addInstance(pattern, instance) {
  const problems = validateInstance(instance);
  if (problems.length) {
    throw new Error(`refusing to attach instance: ${problems.join("; ")}`);
  }

  const instances = [
    ...pattern.instances,
    {
      date: instance.date,
      ticker: instance.ticker.toUpperCase(),
      detail: instance.detail ?? null,
      holds: instance.holds,
    },
  ];

  return { ...pattern, instances, status: statusFor(instances) };
}

// The number that stops a weak pattern hiding behind a good story.
export function summarise(pattern) {
  const total = pattern.instances.length;
  const held = pattern.instances.filter((i) => i.holds).length;
  return {
    id: pattern.id,
    total,
    held,
    failed: total - held,
    rate: total ? round1((held / total) * 100) : null,
    status: pattern.status,
  };
}
