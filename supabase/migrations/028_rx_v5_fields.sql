-- 028_rx_v5_fields.sql
--
-- C2-Rx v5 renderer-rewrite: snapshot fields added to support the
-- new layout. Applied to prod via Supabase MCP `apply_migration` on
-- 2026-05-28 with name `028_rx_v5_fields`. Post-state confirmed via
-- direct re-query: rx_with_past_medical_history=0,
-- rx_with_presenting_complaints_duration=0, bk_with_booked_through=0,
-- bk_with_sponsor_label=0, rx_cols_added=2, bk_cols_added=2.
--
-- This file mirrors the SQL that landed in the database so the repo
-- stays a source-of-truth audit trail alongside Supabase's internal
-- schema_migrations. BEGIN/COMMIT stripped per M026/M027 convention —
-- `apply_migration` wraps its own transaction.
--
-- Changes:
--   prescriptions.past_medical_history             — free-text PMH
--                                                    rendered under
--                                                    "Past Medical
--                                                    History" heading
--   prescriptions.presenting_complaints_duration   — free-text
--                                                    duration shown
--                                                    below the chief
--                                                    complaint
--   bookings.booked_through                        — channel string
--                                                    (Website / WhatsApp
--                                                    / Walk-in / Phone)
--   bookings.sponsor_label                         — display string for
--                                                    the sponsor cell
--                                                    on the Rx
--
-- All four nullable. No collision with existing v3/v4 columns.

ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS past_medical_history             text,
  ADD COLUMN IF NOT EXISTS presenting_complaints_duration   text;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booked_through  text,
  ADD COLUMN IF NOT EXISTS sponsor_label   text;

-- Post-state sanity (single % per RAISE NOTICE — M022 lesson).
DO $$
DECLARE
  v_rx_with_pmh  int;
  v_rx_with_dur  int;
  v_bk_with_bt   int;
  v_bk_with_spn  int;
BEGIN
  SELECT count(*) INTO v_rx_with_pmh
    FROM public.prescriptions WHERE past_medical_history IS NOT NULL;
  SELECT count(*) INTO v_rx_with_dur
    FROM public.prescriptions WHERE presenting_complaints_duration IS NOT NULL;
  SELECT count(*) INTO v_bk_with_bt
    FROM public.bookings WHERE booked_through IS NOT NULL;
  SELECT count(*) INTO v_bk_with_spn
    FROM public.bookings WHERE sponsor_label IS NOT NULL;

  RAISE NOTICE 'M028: prescriptions w/ past_medical_history = %',           v_rx_with_pmh;
  RAISE NOTICE 'M028: prescriptions w/ presenting_complaints_duration = %', v_rx_with_dur;
  RAISE NOTICE 'M028: bookings w/ booked_through = %',                      v_bk_with_bt;
  RAISE NOTICE 'M028: bookings w/ sponsor_label = %',                       v_bk_with_spn;
END $$;
