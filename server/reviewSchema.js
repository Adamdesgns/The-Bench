// reviewSchema.js — structured-output JSON schema for THE BENCH v17.
//
// This is the contract the analysis engine must return. It is Marquee's raw
// material. Fields mirror daily-open-chain-spec.md "Required output from Step 1".
//
// KNOWN ISSUE #1 / #2 (highest leverage): `not_observable` is a REQUIRED field.
// Without it the model silently produces fake-complete verdicts — the exact
// failure v17 Data Integrity exists to kill. Any input that can't be verified
// (13F trends, block prints, whale flows, exact ARR multiples, unconfirmed
// dates) is LABELED here, never dropped, never guessed.

export const benchResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "review_stamp",
    "regime",
    "market_risk",
    "global_peer_read",
    "us_read",
    "crypto_read",
    "board",
    "assumption_ledger",
    "calendar",
    "narrative_vs_evidence_gaps",
    "not_observable"
  ],
  properties: {
    review_stamp: {
      type: "string",
      description: "ISO-8601 timestamp with ET offset, e.g. 2026-07-22T09:15:00-04:00"
    },
    regime: {
      type: "string",
      enum: ["Risk-On", "Neutral", "Risk-Off"]
    },
    market_risk: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      description: "Market Risk 1-5 per v17 Mood lens"
    },
    global_peer_read: {
      type: "string",
      description: "One paragraph — what Asia's close forecasts for the US open"
    },
    us_read: {
      type: "string",
      description: "One paragraph — futures, sector leadership, what's actually bid"
    },
    crypto_read: {
      type: "string",
      description: "One paragraph — or 'not verified this hour'"
    },
    board: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "ticker", "state", "action", "note"],
        properties: {
          id: { type: "string" },
          ticker: { type: "string" },
          state: { type: "string" },
          action: { type: "string" },
          note: { type: "string" }
        }
      }
    },
    assumption_ledger: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["assumption", "status", "why"],
        properties: {
          assumption: { type: "string" },
          status: { type: "string", enum: ["intact", "strained", "broken"] },
          why: { type: "string" }
        }
      }
    },
    calendar: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "event", "why_it_matters"],
        properties: {
          date: { type: "string" },
          event: { type: "string" },
          why_it_matters: { type: "string" }
        }
      }
    },
    narrative_vs_evidence_gaps: {
      type: "array",
      description: "The bridge to Marquee. Each entry names what the crowd believes and what the tape is doing, scored 1-5 on gap width. Empty or top strength <=2 triggers the No-Story Rule.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["gap", "consensus_says", "tape_says", "strength"],
        properties: {
          gap: { type: "string" },
          consensus_says: { type: "string" },
          tape_says: { type: "string" },
          strength: { type: "integer", minimum: 1, maximum: 5 }
        }
      }
    },
    not_observable: {
      type: "array",
      description: "REQUIRED. Every input that could not be verified this run, labeled — never dropped. Empty array is allowed only when everything was verified.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "reason"],
        properties: {
          field: { type: "string", description: "What could not be verified, e.g. 'LMT earnings date'" },
          reason: { type: "string", description: "Why, e.g. 'no primary source located'" }
        }
      }
    }
  }
};

export default benchResponseSchema;
