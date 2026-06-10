-- Migration 041: complaints table + escalation_type widening (Aarogya v2 Slice 1)
--
-- Backs the log_complaint tool (D7) and lets cancel_booking alert ops via
-- escalate_to_ops(type=cancellation). Additive only.
--
-- NOTE on the CHECK: Postgres can't modify a CHECK in place — DROP the old
-- constraint and ADD a wider one (no existing row violates the wider set).
--
-- (There is a cosmetic duplicate "040" on main — 040_paid_click_log_gclid +
-- 040_partial_paid_status; both already applied to prod. Renaming is deferred
-- to a post-Day-7 cleanup commit. 041 is the next free number.)

CREATE TABLE IF NOT EXISTS public.complaints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  phone            text NOT NULL,                 -- e164 (last-10 normalised); denormalised since booking may be null
  category         text NOT NULL
                     CHECK (category IN ('medic_behavior','clinical_quality','billing','delay','report_issue','other')),
  narrative        text NOT NULL,
  severity         text NOT NULL DEFAULT 'medium'
                     CHECK (severity IN ('low','medium','high','critical')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution_notes text,
  resolved_by      uuid REFERENCES public.ops_users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.complaints IS
  'Patient complaints captured by Aarogya (log_complaint tool). 4h SLA. '
  'phone is the normalised patient number (booking_id may be NULL if no booking '
  'matched). Ops resolves via the Phase-1 dashboard (Slice 5); until then, '
  'log_complaint also fires escalate_to_ops. Service-role only (RLS, no policies).';

CREATE INDEX IF NOT EXISTS complaints_phone_idx ON public.complaints (phone);
CREATE INDEX IF NOT EXISTS complaints_booking_idx ON public.complaints (booking_id)
  WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS complaints_unresolved_idx ON public.complaints (created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

-- Widen escalations.escalation_type to allow 'cancellation' (DROP + ADD).
ALTER TABLE public.escalations DROP CONSTRAINT IF EXISTS escalations_escalation_type_check;
ALTER TABLE public.escalations ADD CONSTRAINT escalations_escalation_type_check
  CHECK (escalation_type IN (
    'emergency','qualified_lead','booking_intent','human_requested','complaint',
    'stalled_conversation','complex_query','cold_followup_due','prescription_attempt',
    'cancellation'
  ));
