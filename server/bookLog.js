// bookLog.js — the rules that make a call loggable. Pure: no network, no fs.
//
// WHY THIS EXISTS: 17 of 26 checkpoints in the book are unscorable, and the
// reasons are not subtle. Conditionals were logged with no trigger level, so
// the gate cannot be judged. Hedges were logged with no position size, so
// there is nothing to score against. Four energy names ran 13-18% and the book
// cannot claim a dollar of it.
//
// Those were never "remember harder" problems. They were rows that should have
// been impossible to write. Every requirement below maps to a hole that has
// already cost the book a receipt.
//
// Spec: docs/book-integrity-spec.md

const CALL_TYPES = {
  // A decline. Always loggable -- declining costs nothing and needs nothing.
  pass: [],
  // Taken long. Without an invalidation there is no way to say it went wrong.
  long: ["invalidation"],
  // Gated. Without the level, the gate cannot be judged -- ETH, BNB and SOL
  // all sit unscorable in the book for exactly this.
  // decide_by added 2026-08-20. A trigger says WHERE; without a deadline nothing
  // says WHEN, so a conditional never dies -- it just rots on the board. The
  // tripwire's first run proved the cost: 42 levels watched, a third of them
  // fossils nobody had killed. Adam's words: "me asking about it every day if we
  // just need to watch it for a week will get repetitive." A plan that cannot
  // expire on its own is a plan that has to be asked about.
  conditional: ["trigger", "decide_by"],
  // Protection. Without a size there is no position to score -- XOM, CVX, COP
  // and OXY all ran and none of them can be claimed.
  hedge: ["size"],
  // A deliberate high-risk swing. The max loss is the whole discipline.
  bet: ["max_loss"],
};

const ALWAYS = ["ticker", "price", "call", "date"];

// v29 — how the ticker reached the desk. This is the field that lets the book
// answer, later, whether hunter-sourced calls beat attention-sourced ones.
// Every name run in the week of 2026-08-31 arrived by attention (a tweet, a
// merger headline, someone else's preview); nothing sourced names internally.
export const ORIGINS = ["adam", "x-post", "routine", "hunter", "delta"];
export const UNIVERSES = ["market", "ai-infra"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isScore = (v) => Number.isInteger(v) && v >= 0 && v <= 100;

// What a given call type must carry beyond the universal fields.
export function requiredFields(type) {
  return CALL_TYPES[type] ? [...CALL_TYPES[type]] : [];
}

// Next id in the B-### sequence. Uses the highest number present, not the last
// row, so an out-of-order append cannot silently reuse an id.
export function nextId(rows = []) {
  const highest = rows.reduce((max, r) => {
    const m = /^B-(\d+)$/.exec(r?.id ?? "");
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `B-${String(highest + 1).padStart(3, "0")}`;
}

// Returns the reasons this call must NOT be written. Empty array = loggable.
export function validateCall(input) {
  const problems = [];
  if (!input || typeof input !== "object") return ["call is not an object"];

  const { type } = input;
  if (!type || !CALL_TYPES[type]) {
    problems.push(
      `type must be one of ${Object.keys(CALL_TYPES).join(", ")} (got ${JSON.stringify(type)})`
    );
  }

  for (const f of ALWAYS) {
    const v = input[f];
    if (f === "price") {
      if (!isNum(v)) problems.push(`price is missing or not a number (got ${JSON.stringify(v)})`);
    } else if (!v) {
      problems.push(`${f} is missing`);
    }
  }

  // A deadline that is not a real date, or is already behind us, is worse than
  // none -- it looks like discipline and enforces nothing.
  if (input.decide_by !== undefined && input.decide_by !== null && input.decide_by !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.decide_by))) {
      problems.push(`decide_by must be YYYY-MM-DD (got ${JSON.stringify(input.decide_by)})`);
    } else if (input.date && String(input.decide_by) < String(input.date)) {
      problems.push(`decide_by ${input.decide_by} is BEFORE the call date ${input.date} — a deadline that has already passed enforces nothing`);
    }
  }

  for (const f of requiredFields(type)) {
    if (input[f] === undefined || input[f] === null || input[f] === "") {
      problems.push(
        `a '${type}' call must carry ${f} — without it this row can never be scored`
      );
    }
  }

  // v29 — a readiness that is not an integer 0-100 cannot be bucketed later.
  for (const f of ["readiness", "hunter_opportunity", "hunter_readiness"]) {
    const v = input[f];
    if (v !== undefined && v !== null && !isScore(v)) {
      problems.push(`${f} must be an integer 0-100 (got ${JSON.stringify(v)})`);
    }
  }
  if (input.origin !== undefined && input.origin !== null && !ORIGINS.includes(input.origin)) {
    problems.push(`origin must be one of ${ORIGINS.join(", ")} (got ${JSON.stringify(input.origin)})`);
  }
  if (input.universe !== undefined && input.universe !== null && !UNIVERSES.includes(input.universe)) {
    problems.push(`universe must be one of ${UNIVERSES.join(", ")} (got ${JSON.stringify(input.universe)})`);
  }

  return problems;
}

// Build a schema-shaped archive row. Throws rather than writing a bad one.
//
// Grades and scores stay null unless supplied. A guessed grade is worse than
// no grade: it looks like the framework ran when it did not.
export function buildRow(input, rows = []) {
  const problems = validateCall(input);
  if (problems.length) {
    throw new Error(`refusing to log call: ${problems.join("; ")}`);
  }

  return {
    id: nextId(rows),
    date: input.date,
    ticker: input.ticker.toUpperCase(),
    review_price: input.price,
    review_time: input.review_time ?? null,
    opportunity_score: isNum(input.score) ? input.score : null,
    // v29 — "is it ready NOW?" 0-100, beside Opportunity ("is it worth attention?").
    // A row can be Opportunity 90 / Readiness 15: great business, wrong day.
    readiness: isScore(input.readiness) ? input.readiness : null,
    // v29 — how the name reached the desk. "unspecified" is a warning upstream,
    // never a refusal, so unattended routines keep logging.
    origin: input.origin ?? "unspecified",
    universe: input.universe ?? null,
    // v29 — the hunter's own numbers, read only AFTER this desk graded. The gap
    // between these and the desk's numbers is the hunter's calibration record.
    hunter_opportunity: isScore(input.hunter_opportunity) ? input.hunter_opportunity : null,
    hunter_readiness: isScore(input.hunter_readiness) ? input.hunter_readiness : null,
    confidence_pct: isNum(input.confidence) ? input.confidence : null,
    grades: {
      technical: input.grades?.technical ?? null,
      fundamental: input.grades?.fundamental ?? null,
      execution: input.grades?.execution ?? null,
      overall: input.grades?.overall ?? null,
    },
    fomo: input.fomo ?? null,
    market_risk: isNum(input.market_risk) ? input.market_risk : null,
    hodl: input.hodl ?? null,
    final_call: input.call,
    call_type: input.type,
    trigger: input.trigger ?? null,
    invalidation: input.invalidation ?? null,
    // The date this plan stops being live if nothing happens. Distinct from
    // invalidation, which is a PRICE. This one is the clock.
    decide_by: input.decide_by ?? null,
    size: input.size ?? null,
    max_loss: isNum(input.max_loss) ? input.max_loss : null,
    engine: "claude",
    // Which chat wrote this. The whole point of the cross-chat rule is that
    // it stops mattering who ran it -- but the record should still say.
    logged_by: input.source ?? "claude",
    outcome: null,
    outcome_price: null,
    pct_move: null,
    lesson: input.lesson ?? null,
    grade_verdict: null,
    not_observable: [],
    last: "unverified",
    last_source: "none",
    last_checked: input.now ?? null,
  };
}
