# Honey — AI Assistant Handover

**Date:** 2026-07-15
**Branch:** `master`, on top of commit `2663db4` ("AI Assistant cost optimization: 3-tier fast-path router")
**Status:** 4 rounds of work done since that commit, all **UNCOMMITTED**, all real-API verified, **NOT browser-tested**.

This file is a snapshot for picking the work back up — either you, in a future session, or a
teammate. Read this before touching `src/lib/assistant/`.

---

## 1. What Honey's AI assistant is

One shared "assistant engine" (`src/lib/assistant/engine.ts`, Claude Sonnet 5 + ~20 tools) powers
both the full chat and the quick voice mic. It can log/edit/delete expenses, manage recurring
rules and income, answer questions about spending, and give gentle savings suggestions — every
write is a confirm-gated card, nothing saves without a tap.

In front of that full agent sits a **cost-optimization router**: cheap/fast tiers handle the
common cases, and only genuinely complex requests pay for the expensive Sonnet agent.

## 2. The 3-tier router — current architecture

```
User message
   │
   ▼
fastPathGate()  ─────────────────────────────► false → Sonnet (full agent)
   │ true
   ▼
looksLikeSimpleLog()?
   │ yes                              │ no
   ▼                                  ▼
gpt-5.4-mini (extract-only)      Haiku classifier (ROUTE_TOOL)
   │                                  │
   │ self-screens empty               ├─ log / amend_last / delete_last
   │ (not a log) ──────────────┐      ├─ edit_search / delete_search   (NEW)
   ▼                            │      ├─ total_query
confirm card                    │      ├─ search_query                 (NEW)
                                 │      ├─ other + clarify → text reply (NEW)
                                 └─────►└─ other, no clarify → Sonnet
```

**Tier 1 — `gpt-5.4-mini`** (`src/lib/assistant/fast-path.ts`, `MINI_MODEL`): extract-only,
handles a clean "I spent X on Y" in **any language**. Cheaper than Haiku ($0.75/$4.50 vs $1/$5
per MTok) and the only model of the three tested that scored 26/26 across 16 languages (MS, ID,
ES, DE, JA, KO, TH, VI, TA, HI, AR, RU, FR, PT, CN, EN). `gpt-4o-mini` (the old default) had real
bugs in Malay (misread weekday, contaminated tags); `gpt-5.4-nano` was rejected — pricier than
4o-mini *and* failed the English control case.

**Tier 2 — Haiku 4.5 classifier** (`FAST_PATH_MODEL`, `ROUTE_TOOL`): a single tool-forced call
that classifies the message into one of 8 intents and extracts just enough for deterministic code
to act. Not a keyword system — this is genuine model reasoning, validated across all 16 languages.

**Tier 3 — Sonnet full agent** (`engine.ts`): everything else — analysis, projections, recurring
rules, income, multi-intent messages, anything the classifier itself doubts.

### What's genuinely keyword-based vs what's real AI analysis

This came up directly with the user and is worth being precise about:

- **`SKIP_RE` / `fastPathGate` / `looksLikeSimpleLog`** are zero-cost regex pre-filters. They are
  a **pure cost optimization** — if a regex misses a phrasing, the worst outcome is one extra
  cheap API call before landing on the correct tier, never a wrong card. The regex layer is
  *defense in depth*, not the safety mechanism.
- **The actual safety net is model reasoning**, at two points: (a) mini's own prompt says "if
  this isn't a new expense log — in ANY language — return an empty array", validated on
  languages that aren't even in the regex lists (Turkish/Italian/Swahili, 8/8 correct); (b) the
  Haiku classifier's own "when in doubt, choose other" bias, which is genuine judgment, not
  pattern matching.

## 3. What changed this session (4 rounds, all uncommitted)

### Round 1 — Multilingual support + graceful-degradation ("三件套")
- Any-language expense logging (not just CN/EN) — verified across 16 languages.
- Swapped `MINI_MODEL` from `gpt-4o-mini` to `gpt-5.4-mini` (see model comparison above).
- **三件套** in `engine.ts`'s system prompt: unsupported feature request → honest decline +
  `jeremypoh0205@gmail.com`; investment advice → decline, no email; off-topic → one friendly line,
  steer back. Follows the user's own language automatically (no extra code — Sonnet already does
  this).

### Round 2 — `edit_search` / `delete_search` (the "Sonnet is slow" fix)
- Editing/deleting an **older** expense by description ("改7月14号的奶茶100", "delete the KFC
  lunch") used to always need the full Sonnet agent (`find_expenses` → `update_expense`, ~5s).
  Now it's a Haiku-tier intent: the classifier extracts search criteria only
  (`resolveSearchTargets` in `fast-path.ts`), deterministic Prisma resolves 0/1/N matches.
  Acts only on an unambiguous single non-recurring match; 0/N/recurring still escalates.
- Hardened `amend_last` so a message naming a specific item/date routes to `edit_search`, not
  "edit whatever was last logged" (this was a real bug: "modify the 下午茶" was incorrectly
  editing the last-logged, unrelated "套套" item).

### Round 3 — Loosen escalation (user: "让 haiku 多试试, sonnet 只处理真正难的")
- Removed `之前`/`上次`/`previous`/`last time` from `SKIP_RE` — editing something described as
  "the one I bought before" no longer forces Sonnet; `edit_search` handles it fine now.
- `edit_search`/`delete_search` date-relaxation: if keyword+date finds nothing, retry with just
  the keyword (user misremembered the date) — the confirm card shows the real date so the user
  can verify.
- Warmer, friendlier CN/EN reply templates throughout the fast path.

### Round 4 — Haiku capability expansion (search_query, candidates list, clarify)
- **`search_query` intent** — read-only "查一下 / find / biggest / cheapest" questions, answered
  by Haiku + a deterministic template, **zero Sonnet cost**. This was validated as viable months
  ago (Haiku ties Sonnet, 18-19/21) but never shipped — now it is. Needed a companion fix: a new
  `SEARCH_Q_RE` permit-list in `fastPathGate`, because a no-digit search question ("what's the
  cheapest thing I bought") was previously falling through the gate's default-deny straight to
  Sonnet without ever reaching the classifier.
- **2+-match disambiguation** — `edit_search`/`delete_search` used to escalate to Sonnet on ANY
  non-single match. Now: 2+ matches → Haiku lists the actual candidate rows and asks which one,
  using data already fetched (zero extra AI call). 0 matches still escalates (Sonnet's fuzzier
  search is worth keeping for that case).
- **`clarify` field** — `intent='other'` can now carry ONE short clarifying question that Haiku
  asks directly, instead of *always* meaning "silently hand off to Sonnet." Two safety rules,
  both found by testing real API responses (not guessed):
  1. **Multi-intent check first** — a message bundling a second distinct request must still
     escalate silently (clarify would only resolve half of it and silently drop the rest).
  2. **Referential-language check first** — "like we just discussed", "same as before" must also
     escalate silently, because the classifier only sees this one message, not the conversation
     history; asking a generic clarifying question here made the user repeat themselves (caught
     via a raw-API debug call where Haiku literally said "I don't have context of what we just
     discussed").

## 4. Verification status

| Check | Status |
|---|---|
| `tsc --noEmit` (my code, excluding `.next/` generated files) | ✅ 0 errors |
| `eslint` on all touched files | ✅ 0 errors |
| `scripts/fast-path-smoke.ts` (regression suite) | ✅ 25/25 (was 23; +2 for `search_query`) |
| Real-API verification scripts (below) | ✅ all pass |
| Browser / manual click-through | ❌ **not done yet** |
| `next build` | ⚠️ blocked by a stale `.next/dev` cache while the dev server is running — unrelated to this code; run `rm -rf .next && npx next build` with the dev server **stopped** |

### Debug/verification scripts (all real API + real dev DB, safe to re-run)

- `scripts/multilingual-sweep.ts` — 16-language extraction + gate audit + Haiku classification
- `scripts/edit-search-verify.ts` — edit_search/delete_search real-DB round-trips, date relaxation
- `scripts/route-expand-verify.ts` — search_query, candidates-list, clarify, negative controls
- `scripts/route-explain.ts` — **zero-API** deterministic pre-model route tracer; paste any
  message in and see which tier it hits and why, without spending anything
- `scripts/fast-path-smoke.ts` — the standing regression suite, run this after any fast-path change

## 5. Next steps (in order)

1. **Stop the dev server, `rm -rf .next`, clean `next build`** — confirms nothing is actually
   broken (the build failures seen mid-session were dev-cache corruption, not code).
2. **Browser-test** everything above — nothing in this session has been clicked through yet.
   Priority: logging in a non-CN/EN language, editing an older expense by description, a
   "查一下" search question, and a deliberately-ambiguous message (to see the `clarify` question).
3. **Commit** — 4 rounds of real work sitting uncommitted on top of `2663db4`.
4. Optional/future: `gpt-5.4-mini` as the *classifier* too (it's cheaper than Haiku and aced
   extraction, but untested on the classify task); MS/ID `total_query` templates; arbitrary
   date-range support in `search_query` ("this year", "last 3 months" currently still escalate,
   by design).

## 6. Where the fuller history lives

This file is a snapshot of *where things stand*. The full reasoning trail — every round's test
results, every rejected alternative, every number measured — lives in Claude's persistent memory
for this project (not checked into git), specifically the `honey-ai-cost-strategy` and
`honey-ai-assistant` memory files. Ask a future Claude session to "read your memory on Honey's AI
cost strategy" if you need the detail behind any decision summarized above.
