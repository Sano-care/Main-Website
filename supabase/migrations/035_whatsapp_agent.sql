-- Migration 035: WhatsApp AI Agent (Aarogya) — core schema
--
-- Six tables backing the self-hosted agent (architecture v1 §6). Renumbered
-- from 034 to avoid collision with the parallel callback_requests migration.
--
-- Week-2-ready additions beyond the reviewed Week-1 schema:
--   * conversations.channel — the agent brain is channel-agnostic; WhatsApp is
--     channel #1, website + mobile follow (default 'whatsapp').
--   * escalations.escalation_type CHECK is the UNION of the architecture spec
--     and the escalate_to_ops function enum (function-escalate-to-ops.md), so
--     the Week-2 tool call cannot throw on 'qualified_lead'/'stalled_conversation'.
--   * RLS ENABLED with zero policies on all six tables — these hold full phone
--     numbers, transcripts and medical context; the service-role client bypasses
--     RLS, the public anon key is denied (closes the §13 lead-leak risk).
--
-- Postgres translation notes (spec DDL is CockroachDB-flavored): inline INDEX
-- clauses -> separate CREATE INDEX; partial index for open escalations; CHECK
-- constraints for enum-like columns (mirrors consent_ledger.source, M033).
-- messages.provider_message_id + its unique partial index give webhook
-- idempotency against Meta retries.
--
-- apply_migration wraps its own transaction; no BEGIN/COMMIT here.

CREATE TABLE IF NOT EXISTS public.leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_phone        text UNIQUE NOT NULL,
  name                  text,
  area                  text,
  service_needed        text,
  service_intent        text
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
  source_campaign       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.leads IS
  'One row per WhatsApp phone number Aarogya has heard from. Created lazily on '
  'first inbound. consent_status flips to opted_out when the user sends STOP.';

CREATE TABLE IF NOT EXISTS public.conversations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_phone     text NOT NULL,
  lead_id            uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  channel            text NOT NULL DEFAULT 'whatsapp'
                       CHECK (channel IN ('whatsapp','website','mobile')),
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
  'Per-phone conversation state. channel is the delivery surface (whatsapp first; '
  'website/mobile later). opt_out is the permanent, global send-block checked by '
  'the outbound dispatcher before every send (architecture §3.2).';

CREATE INDEX IF NOT EXISTS idx_conversations_phone
  ON public.conversations (whatsapp_phone);
CREATE INDEX IF NOT EXISTS idx_conversations_state_last_msg
  ON public.conversations (state, last_user_msg_at);

CREATE TABLE IF NOT EXISTS public.messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction            text NOT NULL CHECK (direction IN ('inbound','outbound')),
  content              text NOT NULL,
  content_type         text NOT NULL DEFAULT 'text'
                         CHECK (content_type IN
                           ('text','image','audio','video','document','sticker',
                            'location','interactive','button','contacts','reaction',
                            'order','system','template','unsupported')),
  provider_message_id  text,
  raw_payload          jsonb,
  claude_model_used    text,
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_inbound_provider_id
  ON public.messages (provider_message_id)
  WHERE direction = 'inbound' AND provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.escalations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  escalation_type   text NOT NULL
                      CHECK (escalation_type IN
                        ('emergency','qualified_lead','booking_intent','human_requested',
                         'complaint','stalled_conversation','complex_query',
                         'cold_followup_due','prescription_attempt')),
  priority          text NOT NULL CHECK (priority IN ('p1','p2','p3')),
  slack_message_id  text,
  acknowledged_at   timestamptz,
  acknowledged_by   text,
  resolution_notes  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.escalations IS
  'Ops handoff queue. escalation_type is the union of the architecture spec and '
  'the escalate_to_ops function enum. idx_escalations_open lists unacknowledged '
  'alerts for the ops SLA view. slack_message_id is retained for back-compat but '
  'the Week-2 handoff is a WhatsApp template to the ops number, not Slack.';

CREATE INDEX IF NOT EXISTS idx_escalations_open
  ON public.escalations (created_at)
  WHERE acknowledged_at IS NULL;

CREATE TABLE IF NOT EXISTS public.audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  event_type       text NOT NULL,
  event_data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_log IS
  'Append-only audit trail (architecture §3.4). One row per significant event: '
  'emergency_detected, opt_out_set, opt_out_send_blocked, ops_viewed_full_number, '
  'emergency_for_opted_out_user, signature_verification_failed, message_echoed, '
  'escalation_created, etc. Rows are NEVER updated or deleted.';

CREATE INDEX IF NOT EXISTS idx_audit_event_created
  ON public.audit_log (event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_conversation
  ON public.audit_log (conversation_id, created_at)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version         text UNIQUE NOT NULL,
  system_prompt   text NOT NULL,
  model_default   text NOT NULL,
  model_complex   text NOT NULL,
  safety_keywords jsonb NOT NULL DEFAULT '{}'::jsonb,
  deployed_at     timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.agent_versions IS
  'Version-controlled Aarogya configuration (architecture §8, Appendix A). '
  'system_prompt + safety_keywords are loaded by the orchestrator in Week 2+. '
  'At most one row has is_active = true.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_versions_single_active
  ON public.agent_versions (is_active)
  WHERE is_active = true;

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

-- Row Level Security: ENABLE on every table, attach NO policies. Service-role
-- (supabaseAdmin) bypasses RLS; the public anon/authenticated roles are denied.
-- See decisions.md D11.
ALTER TABLE public.leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;

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
