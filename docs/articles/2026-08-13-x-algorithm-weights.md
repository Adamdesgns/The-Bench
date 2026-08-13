# THE PRICE OF A LIKE

*Marquee v3.1 · drafted 2026-08-13 · source: `github.com/xai-org/x-algorithm`, Apache 2.0, read directly*

---

## THREE HEADLINES

**Straight:** X Published Its Ranking Weights. A Like Is Worth 0.5.

**Provocative:** Everything You Were Told About Bookmarks Is Wrong. The Source Code Says So.

**Clever:** The Algorithm Files Its Own Prospectus

---

## DEK

X open-sourced the numbers behind the For You feed today, and buried in a Rust config file is a scoring table that quietly invalidates most of what gets sold as growth advice — including a rule we published ourselves.

---

## HERO IMAGE CONCEPT

*5:2 X Article cover.* Near-black background. A single column of right-aligned numbers descending in one sharp accent color — **20.0 · 5.0 · 1.0 · 0.5 · 0.0** — with one number set apart below the rest, in muted red: **−234.0**. No faces, no logos, no chart. The weight table *is* the image. Minimal type: the title in restrained sans-serif, lower left. Institutional, closer to a bond prospectus than a tech blog.

---

## THE ARTICLE

A like is worth 0.5.

A report is worth negative two hundred and thirty-four.

Those two numbers came out of a Rust file called `param.rs` this afternoon, and between them sits nearly everything anyone has ever told you about growing an account on X. One report cancels four hundred and sixty-eight likes. Not approximately. Exactly, if the defaults hold.

X open-sourced the For You ranking engine today at `github.com/xai-org/x-algorithm`, under Apache 2.0. Keith Coleman, the company's VP of Product, framed it as an answer to three questions people ask constantly and can never verify: *Am I shadowbanned? Is X fair? Why am I seeing this post?* His announcement has 1.4 million views. The repository has 27,353 stars and 4,643 forks, and it was still being pushed to at 17:23 UTC.

The coverage has almost entirely followed Coleman's framing — that this is a transparency story about shadowbanning, paired with a new tool at `x.com/i/under_the_hood` that shows you the visibility labels sitting on your own account. That is a real story and it is not the important one.

The important one is that this release, per the repository's own changelog, "adds key configuration parameters (**including weights used to blend predicted action values into a score for a post**)." X published the price list. And the price list says the entire retail understanding of the platform is aimed at the wrong actions.

### What a post is actually worth

Every candidate post is scored by predicting how likely you are to take each of about twenty actions, then multiplying each probability by a weight and summing. The weights live in `home-mixer/params/param.rs`. They are not inferred, not leaked, not reverse-engineered from a growth course. They are declared constants.

Ranked, with a like as the unit:

| Action | Weight | In likes |
|---|---|---|
| Share via copy link | **20.0** | 40× |
| Reply, from a mutual follow | 15.0 | 30× |
| Reply | **5.0** | 10× |
| Share via DM | 5.0 | 10× |
| Quote post | **5.0** | 10× |
| Follow the author | 4.0 | 8× |
| Share | 2.0 | 4× |
| Repost | 1.0 | 2× |
| **Like** | **0.5** | 1× |
| Click | 0.4 | — |
| Open a link | 0.2 | — |
| Expand a photo, open a video | 0.05 | — |
| Dwell | **0.0** | — |
| Profile click | **0.0** | — |

Read the top and the bottom of that table together. The single most valuable thing a reader can do is **copy your link and send it to somebody** — worth forty likes. The single most chased metric on the platform, the like, sits ninth, above only clicks, link-opens and the rounding errors.

Dwell time is zero. Profile clicks are zero. Every thread built to hold attention, every "read to the end," every hook engineered to keep a thumb still — the simple dwell term does not score it at all.

And the metric an entire cottage industry sells as the secret? **Bookmarks do not appear in the scoring struct.** Not underweighted. Absent. The field `bookmark_count` is hydrated as a feature and handed to the model in `engagement_counts_hydrator.rs`, so the network can learn from it — but there is no bookmark term in the weighted sum. Every course that told you bookmarks are the heaviest signal was describing something that is not in the file.

### The asymmetry nobody prices

Turn the table over and it gets more interesting.

| Action | Weight |
|---|---|
| Report | **−234.0** |
| Mute | −58.8 |
| Not interested | −43.2 |
| Block | −31.2 |

A single mute costs you the equivalent of a hundred and seventeen likes. A single block, sixty-two. A report, four hundred and sixty-eight.

This is the finding that should change behavior, and it is the one nobody will build a course around, because it does not sell. **The dominant term in your reach is not what your best readers do. It is what your worst reader does.** You can be liked four hundred times and reported once and end the day underwater.

It reframes clickbait entirely. An open loop a post fails to pay off is not a small tax on credibility — it is a mechanism for manufacturing the exact negative actions that carry twenty to four hundred times the weight of the engagement it bought. Under this scoring function, the safest growth strategy available is not annoying people.

Two of the loudest replies under Coleman's own post asked X to stop penalizing accounts for being blocked and muted, calling coordinated block lists a weaponized attack vector. The code says they are right about the mechanism. At −31.2 and −58.8, an organized group does not need to argue with an account. It needs about forty people.

### The part where we mark our own homework wrong

On July 31 we published a growth playbook for this account. Line 32 reads: *"Bookmarks are the heaviest positive signal in X's ranker — heavier than likes."*

That sentence is the stated reason every scheduled post we write is required to carry a "saveable element." It is load-bearing. And as of today it is not supported by the source code — bookmarks carry no weight in the scoring struct at all.

We were half right in a way that matters. Likes *are* nearly worthless, so "don't chase likes" survives. What died is the mechanism. The instinct to build something worth keeping was correct; it was pointed at the wrong verb. The goal was never to be **screenshotted**. It was to be **sent** — because the copy-link share is the twenty-point action, the heaviest single term in the entire positive table, and it is the one thing a genuinely useful post produces that a clever post does not.

A price level a trader forwards to his group chat scores forty times what a like scores. That is the whole strategy, and we had it written down backwards.

### What this does not settle

The honest limits, because a table this clean invites overreach.

These are **compile-time defaults for feature-switch parameters** — every one is named like `rust_home_mixer_favorite_weight`, which exists precisely so it can be overridden in production. Treat the table as the shape of the model and the relative ordering as the signal. Do not treat 0.5 as a guaranteed live number.

The simple `dwell` term is zero, but separate continuous-dwell parameters exist that we have not read. "Dwell does not matter" is a stronger claim than the file supports.

Whether the replies inside your own thread earn the 5.0 reply weight is not something the config answers. They are author-generated, and the plausible reading is that they do not.

And ranking is not filtering. The repository is explicit that they are separate systems — a post can score beautifully and still be dropped by `visibility-filtering/` before anyone ranks it. The weights tell you what wins the auction. They do not tell you whether you were allowed into the room.

### The kicker

For three years the standard defense of every growth theory was that nobody could check it. The algorithm was a black box, so any confident story about it was as good as any other, and the loudest story won.

The box is open. The file is 400 lines of Rust and anyone can read it in an afternoon.

The interesting question is no longer what the algorithm rewards. It is how many people, holding the actual numbers, will keep selling the old ones.

---

## THREE PULL QUOTES

> "One report cancels four hundred and sixty-eight likes. Not approximately. Exactly, if the defaults hold."

> "The dominant term in your reach is not what your best readers do. It is what your worst reader does."

> "The goal was never to be screenshotted. It was to be sent."

---

## COMPANION X POST

```
X open-sourced its ranking weights today.

A like is worth 0.5.
A report is worth -234.

One report cancels 468 likes.

We published a growth rule in July that the source code just proved wrong. Here is the correction, and the number nobody is talking about.
```

---

**Proof, not hype.**

**@TheBenchTrades**

*Not financial advice. Educational only.*
