# WhatsApp Agent (Aarogya) — Decisions Log

Per the handover ("if you hit ambiguity… write it up in `decisions.md` and
surface — do NOT silently decide"). Each entry is a point where reality diverged
from the spec/handover or where a judgment call was needed.

Status legend: **DECIDED** (made the call, recorded here) · **NEEDS SIGN-OFF**
(implemented a default but want @Shashwat to confirm).

---

## D1 — Database: Supabase Postgres, not CockroachDB + Drizzle — **DECIDED (confirmed by founder)**

**Context.** Spec §5 and the handover list CockroachDB + Drizzle as "existing
infrastructure, do NOT rebuild." The live `Main-Website` repo runs **entirely on
Supabase Postgres** — 33 SQL migrations in `supabase/migrations/`, accessed via
`@supabase/supabase-js` (`supabaseAdmin`). No Drizzle, no CockroachDB, no
`DATABASE_URL` anywhere.

**Decision.** Build on Supabase Postgres, matching every existing convention.
Confirmed by founder before any code was written. The handover already permitted
"existing project's ORM."

**Consequence.** Schema ships as `supabase/migrations/034_whatsapp_agent.sql`.
The spec's CockroachDB-flavored DDL was translated to Postgres:
- inline `INDEX (...)` clauses → separate `CREATE INDEX` statements;
- the escalations "open" index → a partial index `WHERE acknowledged_at IS NULL`;
- enum-like `TEXT` columns carry `CHECK` constraints (defense-in-depth, mirrors
  `consent_ledger.source` in M033).

---

## D2 — Idempotency column added to `messages` — **DECIDED**

**Context.** Meta retries any webhook it doesn't see a 200 for within ~5s. The
spec's `messages` DDL has no idempotency key, so a retry would echo the user
twice.

**Decision.** Added `messages.provider_message_id` (the WhatsApp `wamid`) with a
UNIQUE partial index over inbound rows (`uq_messages_inbound_provider_id`).
`recordInboundMessage` treats a duplicate as a no-op. This is an **additive,
non-breaking** extension of the spec DDL.

---

## D3 — Process inline before returning 200, not via a background queue — **NEEDS SIGN-OFF**

**Context.** Spec §9.1 says "return 200 within 5s; heavy processing happens
after the response (queue + worker)." The repo has no queue (Inngest/Trigger.dev
are Week-4 items) and deploys on a serverless host (Netlify).

**Decision.** Week-1 per-message work is a handful of awaited DB calls + 1–2
HTTP calls — comfortably under 5s — so the webhook processes **inline** and then
returns 200. Backgrounding the work with `after()` on a serverless host risks the
platform freezing the function post-response and **dropping a life-critical
emergency Slack alert**. Correctness of the emergency path outweighs shaving
latency at Week-1 volume. A real queue replaces this in Week 2 when LLM latency
is added (per the spec's own build plan).

---

## D4 — Full phone number in the Slack alert *body* vs. safety rule #6 — **NEEDS SIGN-OFF**

**Context.** Two rules in the handover conflict:
- Deliverable 5: "Phone number (last 4 digits only in the title; **full in the
  body**)."
- Safety rule #6: "Full numbers only in DB, **never** in Sentry / Slack message
  titles / error messages."

**Decision.** Implemented Deliverable 5 (the specific instruction): the alert
**title is masked** (`+91xxxxxx7782`) and the **body carries the full number** —
ops must be able to call an emergency patient back. Rule #6's intent (no PII in
low-control sinks like Sentry, logs, message previews) is preserved everywhere
else: all logs and the Slack fallback/preview text use `maskPhone()`. Flagging
because this is a PII/compliance policy point; confirm the full number in the
#sanocare-alerts body is acceptable.

---

## D5 — Opt-out confirmation is sent *before* the flag flips (no override flag) — **DECIDED**

**Context.** Safety rule #4: once `opt_out=true`, the dispatcher must hard-refuse
to send "anything… no exceptions, no override flags." But the opt-out flow must
also *send a confirmation*.

**Decision.** Order the opt-out flow as: (1) send confirmation while `opt_out` is
still false → (2) flip `opt_out=true`. This delivers the confirmation and engages
the permanent block **without any override flag**. Every subsequent send re-reads
`opt_out` from the DB and is refused (audit `opt_out_send_blocked`).

---

## D6 — Emergency for an opted-out user: alert ops, don't message the user — **NEEDS SIGN-OFF**

**Context.** Edge case not covered by the DoD: a user who previously sent STOP
later sends "chest pain". Rule #4 (no sends after opt-out) collides with the
life-safety goal.

**Decision.** Honor opt-out strictly — the 112 auto-reply is **blocked** by the
dispatcher (audit `opt_out_send_blocked`) — **but still fire the Slack alert and
create the p1 escalation** so a human calls the patient. We don't message an
opted-out person; ops still responds. Does not affect Week-1 DoD (the test number
is never opted out). Confirm this is the desired resolution.

---

## D7 — Emergency keyword list kept verbatim from Appendix A — **NEEDS SIGN-OFF**

**Context.** Appendix A's "general" bucket includes broad single words —
`urgent`, `serious`, `emergency` — that will over-trigger (e.g. "is this
urgent?"). Decision C.3 explicitly says "err toward escalation."

**Decision.** Kept the list **verbatim** (faithful + safety-first) rather than
silently trimming it. Matching uses word boundaries so substrings don't fire
(`fit` ∉ `benefit`). The false-positive cost is real but acceptable for a
life-critical path in Week 1; the Week-2 Claude-as-judge second line and
quarterly medical-advisor review (Appendix A) are the tuning mechanism. Flagging
in case you'd prefer to drop the broad general terms now.

---

## D8 — Outbound API version reuses the existing `v21.0` — **DECIDED**

**Context.** Spec §9.2 shows `v22.0`; the existing OTP integration
(`src/lib/otp/whatsapp.ts`) uses `v21.0` via `WHATSAPP_API_VERSION`.

**Decision.** Reuse the existing env var and its `v21.0` default for consistency.
Bumping to v22.0 is a one-line env change when desired.

---

## D9 — Sentry not wired (not installed in repo) — **NOTED**

The spec references Sentry; the repo has no Sentry SDK. Week-1 "Sentry events"
(e.g. signature-failure visibility, Test #2) are satisfied by `log.error(...)`
(redaction-aware) **plus** an `audit_log` row. Wiring Sentry is a small,
separate task — recommend doing it in Week 2 alongside the LLM.

---

## D10 — Hosting is Netlify, not Vercel — **NOTED**

Env notes and `.netlify/` artifacts show the app deploys on Netlify, not Vercel
(handover/spec say Vercel). No code impact for Week 1; relevant only for where
the env vars are set and for the queue choice in Week 2 (see D3).
