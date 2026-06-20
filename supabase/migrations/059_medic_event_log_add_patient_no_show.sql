-- M059 — Aarogya Slice 3 (T66)
-- Add 'patient_no_show' to medic_event_log.event CHECK constraint.
--
-- Background: 052_medic_event_log.sql created the enum as
--   ('departed','reached','visit_started','visit_done')
-- Slice 3 introduces the no-show recovery flow — the medic-app POSTs
-- patient_no_show when no one answers the door, and Aarogya sends the
-- "I'm at your door" template to the patient. A pg_cron job (M060)
-- escalates to ops if the patient remains unresponsive 5 min later.
--
-- Reversibility: drop the new constraint, restore the 4-value original.
-- Safe to roll back if no rows with event='patient_no_show' exist:
--   DELETE FROM medic_event_log WHERE event = 'patient_no_show';
--   ALTER TABLE medic_event_log DROP CONSTRAINT medic_event_log_event_check;
--   ALTER TABLE medic_event_log ADD CONSTRAINT medic_event_log_event_check
--     CHECK (event IN ('departed','reached','visit_started','visit_done'));

ALTER TABLE medic_event_log
  DROP CONSTRAINT IF EXISTS medic_event_log_event_check;

ALTER TABLE medic_event_log
  ADD CONSTRAINT medic_event_log_event_check
  CHECK (event IN ('departed', 'reached', 'visit_started', 'visit_done', 'patient_no_show'));
