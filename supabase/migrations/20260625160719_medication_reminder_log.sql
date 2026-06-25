-- Aarogya medication reminder — per-dose dedupe ledger.
-- The intake_log.state CHECK is ['pending','taken','skipped','missed'] (no
-- 'reminded'), so reminders get a dedicated log. UNIQUE(medication_id,
-- scheduled_for) makes the every-15-min cron fire exactly once per dose
-- (INSERT … ON CONFLICT DO NOTHING). Deny-all RLS; service-role only.
CREATE TABLE public.medication_reminder_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id uuid NOT NULL REFERENCES public.medications(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,   -- the dose's UTC instant (IST HH:MM → UTC)
  sent_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (medication_id, scheduled_for)
);

CREATE INDEX idx_medication_reminder_log_sched
  ON public.medication_reminder_log(scheduled_for);

ALTER TABLE public.medication_reminder_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.medication_reminder_log IS
  'Per-dose dedupe ledger for the medication-reminder cron. One row per (medication, dose instant); UNIQUE makes the 15-min sweep idempotent. Deny-all RLS; service-role only.';
