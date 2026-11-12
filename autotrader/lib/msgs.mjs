// msgs.mjs — the phone commands. Anything that is not exactly one of these is
// ignored, so a stray message on the topic can never be read as an order.
//
//   LOAD B-1460 ABC234 abcde-fghjk   load a plan: its 6-letter ticket + a one-time code
//   SELL B-1460 abcde-fghjk          sell a held position now (one-time code)
//   KILL B-1460 | KILL ALL           stop a plan; never sells
//   STATUS
import { normalizeCode, CODE_LEN } from './codes.mjs';

const CODE = '([A-Za-z0-9]{5}-?[A-Za-z0-9]{5})';

export function parseCommand(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  let m;
  if ((m = t.match(new RegExp(`^LOAD (B-\\d+) ([A-Za-z0-9]{6}) ${CODE}$`, 'i')))) {
    return { cmd: 'LOAD', id: m[1].toUpperCase(), ticket: m[2].toUpperCase(), code: m[3] };
  }
  if ((m = t.match(new RegExp(`^SELL (B-\\d+) ${CODE}$`, 'i')))) return { cmd: 'SELL', id: m[1].toUpperCase(), code: m[2] };
  if ((m = t.match(/^KILL (B-\d+|ALL)$/i))) return { cmd: 'KILL', id: m[1].toUpperCase() };
  if (/^STATUS$/i.test(t)) return { cmd: 'STATUS' };
  return null;
}

/**
 * Every way a code could be sitting in a message: each word, and each pair of
 * neighbouring words (a code typed with a space in the middle). Used to burn
 * codes from messages the trader does not act on.
 */
export function codeCandidates(text) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const out = new Set();
  words.forEach((w, i) => {
    for (const c of [w, words[i + 1] ? w + words[i + 1] : null]) {
      if (c && normalizeCode(c).length === CODE_LEN) out.add(normalizeCode(c));
    }
  });
  return [...out].slice(0, 12);
}

/** The text safe to log or journal: the command word and row only, never what follows. */
export function redact(text) {
  const words = String(text ?? '').trim().split(/\s+/);
  const cmd = /^(LOAD|SELL|KILL|STATUS)$/i.test(words[0] ?? '') ? words[0].toUpperCase() : '(not a command)';
  const id = /^(B-\d+|ALL)$/i.test(words[1] ?? '') ? ` ${words[1].toUpperCase()}` : '';
  const rest = words.length > (id ? 2 : 1) && cmd !== '(not a command)' ? ' <redacted>' : '';
  return `${cmd}${id}${rest}`;
}
