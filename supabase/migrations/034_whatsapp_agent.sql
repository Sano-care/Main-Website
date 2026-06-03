-- Migration 034: WhatsApp AI Agent (Aarogya) — core schema
--
-- The six tables that back the self-hosted WhatsApp agent described in
-- Sanocare_WhatsApp_Agent_Architecture_v1 §6. Week-1 scope uses
-- conversations, messages, leads, escalations and audit_log; agent_versions
-- is created now so the system prompt + safety keyword list have a home when
-- the LLM lands in Week 2.
--
-- Postgres translation notes (spec DDL is CockroachDB-flavored):
--   * Inline `INDEX (...)` clauses are not valid in Postgres CREATE TABLE —
--     each is emitted as a separate CREATE INDEX below.
--   * escalations' "open" index is a partial index (WHERE acknowledged_at
--     IS NULL), same pattern as M033's consent indexes.
--   * Enum-like TEXT columns carry CHECK constraints (defense-in-depth for a
--     compliance-sensitive system), mirroring consent_ledger.source in M033.
--     event_type on audit_log is left unconstrained on purpose — it is an
--     open, extensible event vocabulary.
--
-- Additive deviation from the spec, documented in decisions.md:
--   messages.provider_message_id holds the WhatsApp `wamid`. A UNIQUE partial
--   index over inbound messages makes webhook processing idempotent — Meta
--   retries any webhook it does not see 200 for within ~5s, and without this
--   a retry would echo the user twice.
--
-- apply_migration wraps its own transaction; do NOT add BEGIN/COMMIT here.
-- Same convention as M026-M033.

-- ---------------------------------------------------------------------------
-- leads — one row per phone number we have ever heard from (created lazily).
-- Declared first because conversations.lead_id references it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_phone        text UNIQUE NOT NULL,             -- +91xxxxxxxxxx (E.164)
  name                  text,
  area                  text,                             -- e.g. "Greater Kailash"
  service_needed        text,                             -- free text
  service_intent        text                              -- canonical bucket
                          CHECK (service_intent IN
                            ('doctor_visit','nursing','lab','pharmacy','other','unknown')),
  urgency               text
                          CHECK (urgency IN ('emergency','today','this_week','planned')),
  patient_relationship  text
                          CHECK (patient_relationship IN ('self','parent','spouse','child','other')),
  qualified_at          timestamptz,
  booked_at             timestamptz,
  lifetime_value        numeric(10,2) NOT NULL DEFAULT 0,
  consent_status        text NOT NULL DEFAULT 'implicit'
                          CHECK (consent_status IN ('implicit','explicit','opted_out')),
  source_channel        text NOT NULL DEFAULT 'whatsapp_inbound',
  source_campaign       text,                             -- UTM-style attribution
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.leads IS
  'One row per WhatsApp phone number Aarogya has heard from. Created lazily on '
  'first inbound. consent_status flips to opted_out when the user sends STOP.';

-- ---------------------------------------------------------------------------
-- conversations — the live state machine for one phone number.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_phone     text NOT NULL,                       -- +91xxxxxxxxxx
  lead_id            uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  state              text NOT NULL DEFAULT 'greeting'
                       CHECK (state IN
                         ('greeting','triaging','qualifying','qualified',
                          'escalated','cold','opted_out')),
  service_intent     text
                       CHECK (service_intent IN
                         ('doctor_visit','nursing','lab','pharmacy','other','unknown')),
  escalation_status  text NOT NULL DEFAULT 'none'
                       CHECK (escalation_status IN ('none','requested','in_progress','complete')),
  opt_out            boolean NOT NULL DEFAULT false,
  language           text NOT NULL DEFAULT 'en'
                       CHECK (language IN ('en','hinglish','hi')),
  last_user_msg_at   timestamptz,
  last_bot_msg_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.conversations IS
  'Per-phone conversation state. opt_out is the permanent, global send-block '
  'checked by the outbound dispatcher before every send (architecture §3.2).';

CREATE INDEX IF NOT EXISTS idx_conversations_phone
  ON public.conversations (whatsapp_phone);

CREATE INDEX IF NOT EXISTS idx_conversations_state_last_msg
  ON public.conversations (state, last_user_msg_at);

-- ---------------------------------------------------------------------------
-- messages — append-only transcript, both directions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction            text NOT NULL CHECK (direction IN ('inbound','outbound')),
  content              text NOT NULL,
  content_type         text NOT NULL DEFAULT 'text'
                         CHECK (content_type IN
                           ('text','image','audio','video','template','location','interactive','button','unsupported')),
  provider_message_id  text,                              -- WhatsApp wamid (see header note)
  raw_payload          jsonb,                             -- full Cloud API body for audit
  claude_model_used    text,                              -- haiku|sonnet|null (null until Week 2)
  claude_tokens_in     integer,
  claude_tokens_out    integer,
  safety_flags         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.messages IS
  'Append-only message log (architecture §3.4). raw_payload preserves the full '
  'Cloud API envelope for compliance audit. Never UPDATE or DELETE rows except '
  'via the DPDP retention purge job.';

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON public.messages (conversation_id, created_at);

-- Idempotency: at most one inbound row per WhatsApp message id. Outbound rows
-- have no wamid at insert time, so the index is partial over inbound only.
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_inbound_provider_id
  ON public.messages (provider_message_id)
  WHERE direction = 'inbound' AND provider_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- escalations — one row per ops handoff (emergency, qualified lead, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.escalations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  escalation_type   text NOT NULL
                      CHECK (escalation_type IN
                        ('emergency','booking_intent','complex_query','complaint',
                         'cold_followup_due','prescription_attempt','human_requested')),
  priority          text NOT NULL CHECK (priority IN ('p1','p2','p3')),
  slack_message_id  text,
  acknowledged_at   timestamptz,
  acknowledged_by   text,                                 -- Sanocare staff identifier
  resolution_notes  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.escalations IS
  'Ops handoff queue. Week 1 writes type=emergency (p1) and type=human_requested. '
  'idx_escalations_open lists unacknowledged alerts for the ops SLA dashboard.';

CREATE INDEX IF NOT EXISTS idx_escalations_open
  ON public.escalations (created_at)
  WHERE acknowledged_at IS NULL;

-- ---------------------------------------------------------------------------
-- audit_log — append-only, immutable compliance trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  event_type       text NOT NULL,                         -- open vocabulary; see app constants
  event_data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_log IS
  'Append-only audit trail (architecture §3.4, §5 rule). Every significant event '
  'writes exactly one row: emergency_detected, opt_out_set, opt_out_send_blocked, '
  'signature_verification_failed, message_echoed, escalation_created, etc. '
  'Rows are NEVER updated or deleted.';

CREATE INDEX IF NOT EXISTS idx_audit_event_created
  ON public.audit_log (event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_conversation
  ON public.audit_log (conversation_id, created_at)
  WHERE conversation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- agent_versions — version-controlled system prompt + safety keyword list.
-- Created now (Week 1) so the Week-2 LLM has a home; one seed row inserted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version         text UNIQUE NOT NULL,                   -- v1.0, v1.0.1, ...
  system_prompt   text NOT NULL,
  model_default   text NOT NULL,
  model_complex   text NOT NULL,
  safety_keywords jsonb NOT NULL DEFAULT '{}'::jsonb,
  deployed_at     timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.agent_versions IS
  'Version-controlled Aarogya configuration (architecture §8, Appendix A). The '
  'system_prompt and safety_keywords are loaded by the orchestrator in Week 2+. '
  'At most one row should have is_active = true.';

-- At most one active agent version at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_versions_single_active
  ON public.agent_versions (is_active)
  WHERE is_active = true;

-- Week-1 placeholder row: prompt + keywords land in Week 2. Marked inactive so
-- the orchestrator's "is there an active version?" check stays false until the
-- real prompt is reviewed and promoted.
INSERT INTO public.agent_versions (version, system_prompt, model_default, model_complex, is_active)
VALUES (
  'v1.0-week1-placeholder',
  'PLACEHOLDER — Aarogya system prompt lands in Week 2. Week 1 is deterministic '
    || 'pre-checks + echo only; no LLM is invoked.',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  false
)
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verification (same RAISE NOTICE pattern as M033).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  table_count int;
BEGIN
  SELECT count(*) INTO table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN
        ('leads','conversations','messages','escalations','audit_log','agent_versions');
  RAISE NOTICE 'whatsapp agent tables present=% (expected 6)', table_count;
END $$;
