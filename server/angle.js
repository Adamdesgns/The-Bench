// angle.js — deterministic ANGLE selection + the No-Story Rule.
//
// Per daily-open-chain-spec.md: take the highest-strength narrative_vs_evidence
// gap; tie-break (a) a gap on an OPEN BOARD position, (b) a gap tied to a dated
// calendar event within 10 days, (c) first entry. If the array is empty or the
// top strength <= 2, there is NO story — return null and caption accordingly.

const NO_STORY_CAPTION = "No story today — the board is unchanged.";

export function selectAngle(benchJSON, { openTickers = [], calendar = [] } = {}) {
  const gaps = Array.isArray(benchJSON?.narrative_vs_evidence_gaps)
    ? benchJSON.narrative_vs_evidence_gaps
    : [];
  if (!gaps.length) return { angle: null, reason: "no gaps", caption: NO_STORY_CAPTION };

  const maxStrength = Math.max(...gaps.map((g) => Number(g.strength) || 0));
  if (maxStrength <= 2) {
    return { angle: null, reason: `top strength ${maxStrength} <= 2`, caption: NO_STORY_CAPTION };
  }

  const top = gaps.filter((g) => (Number(g.strength) || 0) === maxStrength);

  const openSet = new Set(openTickers.map((t) => String(t).toUpperCase()));
  const mentionsOpen = (g) =>
    [...openSet].some((t) => `${g.gap} ${g.consensus_says} ${g.tape_says}`.toUpperCase().includes(t));

  const withinTen = new Set();
  const now = Date.now();
  for (const c of calendar) {
    const d = Date.parse(c?.date);
    if (!Number.isNaN(d) && d >= now && d - now <= 10 * 864e5) {
      withinTen.add(String(c.event || "").toUpperCase());
    }
  }
  const mentionsDated = (g) =>
    [...withinTen].some((ev) => ev && `${g.gap} ${g.tape_says}`.toUpperCase().includes(ev.slice(0, 12)));

  let chosen =
    top.find(mentionsOpen) || top.find(mentionsDated) || top[0];

  const thesis = `Consensus believes ${chosen.consensus_says}; the tape is doing ${chosen.tape_says}; that gap is the story.`;
  return { angle: thesis, gap: chosen, reason: `strength ${maxStrength}`, caption: null };
}

export { NO_STORY_CAPTION };
