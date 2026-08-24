# Benny's ears — implementation, ready to apply

**Status:** written 2026-08-14, **not applied.** Both files below belong in `apps/x-poster` (a separate repo). Claude's permission classifier blocks writes into that repo — it is the live unattended publisher for a public account — so the code lives here for Adam to review and drop in.

**Companion to:** `prompts/benny-v2.md` section 6 (the mentions lane — **SPEC ONLY** until this code is in x-poster).

---

## The architecture, and why it splits this way

Benny cannot answer a question from inside a Python script. Answering means pulling live quotes through the Robinhood MCP, applying v25, checking the board, and writing in his voice — that is a Claude routine, not a poller. So the work splits along the seam the rest of x-poster already uses:

```
listen_mentions.py   poll → filter to the operator → dedupe → write inbox/<id>.txt
        ↓
Claude routine       read inbox/ → run v25 on live data → draft to approved/
                     with "REPLY-TO: <id>" as the first line → move to inbox/answered/
        ↓
post_next.py         publish the draft as a reply chain under the question
```

Nothing new about the trust model: the listener never composes, the routine never publishes, `post_next.py` still only reads `approved/`, and `HALT` still stops everything.

**The security property is one comparison.** A mention is acted on only if its `author_id` equals `X_OPERATOR_USER_ID` — a **numeric** id, never a handle. Handles can be changed, released, and re-registered by someone else; a numeric user id is permanent. If that variable is missing or non-numeric the script **refuses to run** rather than defaulting to answering everyone. There is no "if unset, allow all" branch anywhere in this design, on purpose.

Everyone else is ignored **silently**. A reply saying "I only answer my operator" is still a reply, and it is one any stranger can farm by mentioning the account.

---

## What Adam has to do first

1. **X developer portal** — the app is currently Free tier and write-only. Reading mentions needs read access; check the current pay-per-use rates before committing, since reads bill per post returned.
2. **Regenerate the access token after any permission change.** Tokens minted before a permission change do not inherit it — this is the single most common way this setup fails silently.
3. **Add two lines to `apps/x-poster/.env`:**
   ```
   X_OPERATOR_USER_ID=<Adam's numeric X user id>
   X_GATES=1
   ```
   The second one re-arms the content gates. They are currently reporting-only by Adam's August decision, which is right for fixed-format dailies and wrong for freeform answers — see the note at the end.

Adam's numeric id is visible from the API once read access exists, or from any "find my Twitter ID" lookup against the handle.

---

## File 1 — `apps/x-poster/listen_mentions.py` (new)

```python
"""Watch @TheBenchTrades for mentions FROM THE OPERATOR ONLY, and file them.

Usage:
    python listen_mentions.py --dry-run   # show what would be filed, write nothing
    python listen_mentions.py             # poll once and file new operator mentions

This is the "ears" half of Benny (see the-bench prompts/benny-v2.md section 6).
It does NOT answer anything. It polls, filters, de-duplicates, and writes each
qualifying question to inbox/. A separate Claude routine reads inbox/, runs the
v25 framework against live data, drafts the answer to approved/ with a
REPLY-TO header, and post_next.py publishes it. Same shape as every other
routine here: this script never composes and never publishes.

THE SECURITY PROPERTY, and the reason this file exists at all:
    Only Adam can trigger Benny. That is enforced by comparing the mention's
    author_id against X_OPERATOR_USER_ID -- a NUMERIC id, never a handle.
    Handles can be changed, released and re-registered; a numeric user id is
    permanent and cannot be impersonated. If that variable is missing this
    script REFUSES TO RUN rather than falling back to answering everyone,
    because the failure mode of getting this wrong is a public trading account
    answering strangers unattended.

Everyone else's mentions are ignored SILENTLY -- not declined, not replied to.
A reply saying "I only talk to my operator" is still a reply, and it is one
anybody can farm by mentioning us.
"""

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# Windows Task Scheduler hands Python a cp1252 stdout, not UTF-8 -- same
# reconfigure post_next.py does, and for the same reason.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

HERE = Path(__file__).parent
INBOX = HERE / "inbox"
ANSWERED = INBOX / "answered"
STATE = HERE / "mention_state.json"
LOG = HERE / "log.txt"
HALT = HERE / "HALT"

# How many mentions to pull per poll. Deliberately small: reads are billed per
# post returned, and if Adam has asked more than this many questions between
# two polls, the answer is to poll more often rather than pay for a bigger page.
MAX_RESULTS = 25

# Not a moderation layer -- just enough to avoid waking the routine for a bare
# mention with no question in it.
MIN_QUESTION_CHARS = 8
MENTION_STRIP_RE = re.compile(r"^(?:\s*@\w{1,15})+\s*")


def log(message: str) -> None:
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"[{stamp}] listen: {message}\n")
    print(message)


def load_state() -> dict:
    """Last-seen mention id, so a poll never re-reads what it already filed."""
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def already_filed(tweet_id: str) -> bool:
    """True if this question is in inbox/ or has already been answered.

    Belt and braces against the state file: since_id alone is enough until the
    day mention_state.json is deleted, restored from a backup, or lost with the
    machine -- and then every unanswered question gets asked again. Checking the
    directories makes the state file an optimisation instead of a single point
    of truth.
    """
    name = f"{tweet_id}.txt"
    return (INBOX / name).exists() or (ANSWERED / name).exists()


def clean_question(text: str) -> str:
    """The question with its leading @mentions removed.

    A reply on X carries the handles it is answering at the front. Those are
    routing, not content, and leaving them in means the routine reads "@Benny"
    as part of the question.
    """
    return MENTION_STRIP_RE.sub("", text).strip()


def main() -> int:
    dry_run = "--dry-run" in sys.argv

    if HALT.exists() and not dry_run:
        log("HALTED: the HALT file exists - not polling. Delete it to resume.")
        return 0

    load_dotenv(HERE / ".env")

    keys = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"]
    missing = [k for k in keys if not os.getenv(k)]
    if missing:
        log(f"ERROR: missing {', '.join(missing)} in .env - see README for setup.")
        return 1

    # -- The allowlist. No default, no fallback, no 'if unset, allow all'. --
    operator_id = (os.getenv("X_OPERATOR_USER_ID") or "").strip()
    if not operator_id.isdigit():
        log(
            "ERROR: X_OPERATOR_USER_ID is missing or not numeric. Refusing to poll.\n"
            "  This is the ONLY thing standing between Benny and answering the\n"
            "  whole internet unattended, so there is deliberately no default.\n"
            "  Set it to Adam's NUMERIC X user id (not the handle) in .env."
        )
        return 1

    import tweepy

    client = tweepy.Client(
        consumer_key=os.getenv("X_API_KEY"),
        consumer_secret=os.getenv("X_API_SECRET"),
        access_token=os.getenv("X_ACCESS_TOKEN"),
        access_token_secret=os.getenv("X_ACCESS_TOKEN_SECRET"),
    )

    try:
        me = client.get_me()
        my_id = me.data.id
        who = me.data.username
    except Exception as e:
        log(f"ERROR: could not resolve the authenticated account ({e}).")
        return 1

    if str(my_id) == operator_id:
        log(
            f"ERROR: X_OPERATOR_USER_ID is the same account we are authenticated as "
            f"(@{who}). That would make Benny answer himself in a loop. Refusing to poll."
        )
        return 1

    state = load_state()
    since_id = state.get("since_id")

    try:
        response = client.get_users_mentions(
            id=my_id,
            since_id=since_id,
            max_results=MAX_RESULTS,
            tweet_fields=["author_id", "created_at", "conversation_id"],
        )
    except Exception as e:
        # The most likely error here by far is an access-tier problem: this
        # endpoint is a READ, and the app shipped write-only on the free tier.
        log(
            f"ERROR polling mentions ({e}).\n"
            "  If this is a 401/403, the app most likely lacks read access -- check\n"
            "  the tier and the app permissions in the X developer portal, then\n"
            "  regenerate the access token (permission changes do not apply to\n"
            "  tokens minted before the change)."
        )
        return 1

    mentions = list(response.data or [])
    if not mentions:
        log(f"No new mentions since {since_id or 'the beginning'}.")
        return 0

    # Newest id seen this poll, INCLUDING mentions we ignore -- otherwise every
    # future poll re-reads and re-pays for the same strangers' mentions forever.
    newest = max(int(m.id) for m in mentions)

    filed = 0
    ignored = 0
    for mention in sorted(mentions, key=lambda m: int(m.id)):
        if str(mention.author_id) != operator_id:
            ignored += 1
            continue

        tweet_id = str(mention.id)
        if already_filed(tweet_id):
            continue

        question = clean_question(mention.text or "")
        if len(question) < MIN_QUESTION_CHARS:
            log(f"  skipped {tweet_id}: no question in it ({len(question)} chars after handles).")
            continue

        body = (
            f"# Question from the operator\n"
            f"# tweet_id: {tweet_id}\n"
            f"# conversation_id: {getattr(mention, 'conversation_id', '') or ''}\n"
            f"# asked_at: {getattr(mention, 'created_at', '') or ''}\n"
            f"# url: https://x.com/i/status/{tweet_id}\n"
            f"# Answer with a draft in approved/ whose FIRST line is:\n"
            f"#   REPLY-TO: {tweet_id}\n"
            f"\n"
            f"{question}\n"
        )

        if dry_run:
            print(f"--- DRY RUN: would file inbox/{tweet_id}.txt ---")
            print(body)
        else:
            INBOX.mkdir(exist_ok=True)
            ANSWERED.mkdir(parents=True, exist_ok=True)
            (INBOX / f"{tweet_id}.txt").write_text(body, encoding="utf-8")
        filed += 1

    if dry_run:
        log(f"DRY RUN: {filed} question(s) from the operator, {ignored} ignored. State untouched.")
        return 0

    state["since_id"] = newest
    state["last_poll"] = datetime.now().isoformat(timespec="seconds")
    save_state(state)

    log(f"Filed {filed} question(s) from the operator; ignored {ignored} other mention(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

---

## File 2 — `apps/x-poster/post_next.py` (three small edits)

Today the chain can only ever reply to itself: `reply_to` starts at `None` and is only ever assigned from our own just-created tweet. These edits let a draft name an outside target.

**Edit 1 — add after `split_thread()` (around line 72):**

```python
# -- Replying to a post we did not write ------------------------------------
# A draft whose FIRST line is "REPLY-TO: <tweet id>" posts as a reply to that
# tweet instead of as a new top-level post. The header never reaches X.
#
# This exists for Benny's mentions lane (the-bench prompts/benny-v2.md sec 6):
# the listener writes a question to inbox/, a routine drafts the answer, and the
# answer has to land UNDER the question instead of floating free in the timeline.
#
# Threading still works unchanged on top of it: part 1 replies to the target,
# every part after replies to the one before.
#
# First line only, digits only. A malformed header REFUSES the whole draft
# rather than falling back to a top-level post -- an answer with no question
# above it is not a cosmetic bug, it reads as a non sequitur on a public
# account, and it cannot be unsent.
REPLY_TO_RE = re.compile(r"^REPLY-TO:\s*(\d{1,25})$")
REPLY_TO_HINT_RE = re.compile(r"^\s*REPLY[-_ ]?TO\s*:", re.IGNORECASE)


def parse_reply_target(text):
    """(target_id, remaining_text). target_id is None when there is no header.

    Raises ValueError when the first line looks like a REPLY-TO header but does
    not parse -- see the note above on why that is not a soft failure.
    Pure: no I/O.
    """
    first, _, rest = text.partition("\n")
    if not REPLY_TO_HINT_RE.match(first):
        return None, text
    match = REPLY_TO_RE.match(first.strip())
    if not match:
        raise ValueError(
            f"malformed REPLY-TO header {first.strip()!r} - expected "
            f"'REPLY-TO: <numeric tweet id>' alone on the first line"
        )
    return match.group(1), rest.strip()
```

**Edit 2 — in `main()`, immediately after the `if not text:` empty-file check and BEFORE the length check:**

```python
    # Strip the reply header before anything measures, hashes or splits the
    # text, so it never counts toward length, the duplicate digest, or part 1.
    try:
        reply_target, text = parse_reply_target(text)
    except ValueError as e:
        log(f"REFUSED {draft.name}: {e}")
        log("  -> nothing posted. A reply that posts standalone reads as a non sequitur.")
        return 1
    if reply_target:
        log(f"{draft.name} is a REPLY to https://x.com/i/status/{reply_target}")
```

**Edit 3 — replace the `reply_to = None` initialiser (around line 349):**

```python
    posted_ids = []
    reply_to = reply_target   # None for a normal post; a tweet id for a reply
```

That is the whole change. The existing loop already branches on `reply_to is None`, so a reply chain works with no further edits.

---

## File 3 — `apps/x-poster/test_reply_target.py` (new)

Same shape as `test_thread.py`: plain script, no pytest, `python test_reply_target.py`.

```python
"""Tests for REPLY-TO header parsing. Run: python test_reply_target.py

The failure mode being guarded is public and unrecoverable: an answer that
posts as a top-level tweet instead of a reply is a non sequitur in the
timeline and cannot be unsent.
"""
import sys

from post_next import parse_reply_target, split_thread

FAILS = []


def check(name, cond):
    print(f"  {'ok  ' if cond else 'FAIL'}  {name}")
    if not cond:
        FAILS.append(name)


print("parse_reply_target - no header")
check("a plain draft has no target", parse_reply_target("just a post")[0] is None)
check("a plain draft is returned unchanged", parse_reply_target("just a post")[1] == "just a post")
check(
    "prose mentioning a reply is not a header",
    parse_reply_target("I will reply to him later")[0] is None,
)
check(
    "a header on the SECOND line is not a header",
    parse_reply_target("hook\nREPLY-TO: 123")[0] is None,
)

print("\nparse_reply_target - valid header")
target, body = parse_reply_target("REPLY-TO: 2087853338389786784\nThe answer.")
check("the id is extracted", target == "2087853338389786784")
check("the header is stripped from the body", body == "The answer.")
check(
    "surrounding blank lines are stripped",
    parse_reply_target("REPLY-TO: 123\n\n\nbody")[1] == "body",
)

print("\nparse_reply_target - malformed header REFUSES")


def raises(text):
    try:
        parse_reply_target(text)
        return False
    except ValueError:
        return True


check("a non-numeric id raises", raises("REPLY-TO: abc\nbody"))
check("an empty id raises", raises("REPLY-TO:\nbody"))
check("a URL instead of an id raises", raises("REPLY-TO: https://x.com/i/status/123\nbody"))
check("a lowercase variant is still caught, not ignored", raises("reply-to: oops\nbody"))
check("an underscore variant is still caught", raises("REPLY_TO: oops\nbody"))

print("\ninteraction with threading")
target, body = parse_reply_target("REPLY-TO: 999\npart one\n---\npart two")
check("the header does not become part of part 1", split_thread(body)[0] == "part one")
check("the thread still splits normally under a header", len(split_thread(body)) == 2)
check("the target survives the split", target == "999")

print()
if FAILS:
    print(f"{len(FAILS)} FAILED: " + ", ".join(FAILS))
    sys.exit(1)
print("all reply-target tests passed")
```

---

## One thing to decide before this goes live

**Arm the gates for Benny's replies.** `gate_failures()` currently reports and posts anyway — Adam's deliberate call on 2026-08-04, and correct for six fixed-format routines that verify every number against a live pull. A freeform answer to an unpredictable question is a different risk: the gates catch exactly the things an improvised reply is most likely to carry — an `unverified` label, a missing disclaimer, a `$X.XX` slot that never got filled.

Setting `X_GATES=1` in `.env` re-arms them for **everything**, including the six dailies. If that is unwanted, the alternative is a per-run flag: have the answering routine call `post_next.py --gates` while the dailies keep calling `--auto` alone. That needs no code change — `--gates` is already an argv check.

**Recommendation: run the answering routine with `--gates`, leave the dailies as they are.**
