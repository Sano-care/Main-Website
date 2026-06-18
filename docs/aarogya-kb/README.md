# Aarogya KB — Source of Truth

This directory is the **canonical source** for Aarogya's system prompt and knowledge base content.

## How the KB reaches production

The markdown in this directory is **hand-synced** into a TypeScript constant in
`src/lib/agent/knowledge.ts` (`AAROGYA_SYSTEM_PROMPT` / `buildAarogyaSystemPrompt`).
That constant is consumed by `src/lib/agent/config.ts:getSystemPrompt()` and
flows into every Claude turn via `src/lib/agent/orchestrator.ts`.

There is **no build step** copying these files into `src/`. The relationship is
manual and human-enforced. (Netlify functions can't read the OneDrive originals
at runtime, which is why the runtime KB is an embedded string constant.)

## Drift policy

When you edit ANY file in this directory:

1. Mirror the change into `src/lib/agent/knowledge.ts` in the **same PR**.
2. Update the `KB_SOURCE_COMMIT` constant at the top of `knowledge.ts` to the
   commit SHA of the updated markdown (the prior sync's `docs/aarogya-kb/` commit).
3. A future CI drift check compares the constant against the actual last-modified
   commit of `docs/aarogya-kb/` — mismatched values fail review.

Conversely, when you edit `knowledge.ts`:

1. Mirror the change into the matching markdown file here.
2. Update `KB_SOURCE_COMMIT` to the new SHA.

> This PR (KB Hardening v2) **establishes** the baseline, so `KB_SOURCE_COMMIT`
> ships as the sentinel `"PR-INTRODUCED"` — a commit cannot embed its own
> not-yet-existing hash. The **first future sync PR** replaces it with the real
> SHA of the commit that last modified this directory.

## File map

| File | Purpose |
|---|---|
| `aarogya-system-prompt.md` | The full system prompt sent to Claude on every turn |
| `service-catalog.md` | Service details (price, SLA, what it includes) |
| `faq.md` | FAQ corpus for retrieval / inline reference |
| `safety-rails.md` | Hard rules, emergency triage, opt-out, lab-accreditation handling |
| `brand-voice.md` | Tone, persona, Hinglish usage guidelines |
| `function-escalate-to-ops.md` | Tool schema + behaviour for `escalate_to_ops` |
| `function-set-opt-out.md` | Tool schema + behaviour for `set_opt_out` |

> Note: the original dispatch referenced a single `function-definitions.md`; the
> actual source splits tool docs into the two `function-*.md` files above, which
> are copied as-is.

## What does NOT belong here

- Patient data (names, phone numbers, conversation logs) — these go in Supabase, never in markdown.
- Legacy BSP flow JSONs (Rampwin / Pinnacle era) — those live in OneDrive `Aarogya_KB/legacy/` for historical reference, not in the repo.
- Test prompts or scratch experiments — keep those out of the source-of-truth directory.

## Related

- Runtime: `src/lib/agent/knowledge.ts`, `src/lib/agent/config.ts`, `src/lib/agent/orchestrator.ts`
- Senders: `src/lib/whatsapp/` (Slice 2a + 2b)
- KB Hardening v1 (2026-06-18, NABL fix in OneDrive): pre-repo, no PR
- KB Hardening v2 (this directory's creation): this PR
