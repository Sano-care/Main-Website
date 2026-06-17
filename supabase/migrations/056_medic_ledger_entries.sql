-- M056: medic_ledger_entries — mirror of doctor_ledger_entries
--
-- T65 Phase 2 — append-only ledger for medic compensation. Mirrors the doctor
-- side exactly except:
--   1. amount_paise is BIGINT (vs INTEGER on doctor side).
--   2. FK targets medics + medic_attendance (vs doctors + doctor_attendance).
--
-- entry_type enum verbatim from doctor side, founder-confirmed.
-- Payout flow: settle inserts entry_type='payout' with negative amount_paise
-- so SUM(amount_paise) over the medic gives net outstanding.

CREATE TABLE medic_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medic_id UUID NOT NULL REFERENCES medics(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'revenue_share','commission','daily_wage','overtime','payout','adjustment','reversal'
  )),
  amount_paise BIGINT NOT NULL,
  entry_date DATE NOT NULL,
  description TEXT,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  attendance_id UUID REFERENCES medic_attendance(id) ON DELETE SET NULL,
  reverses_entry_id UUID REFERENCES medic_ledger_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES ops_users(id) ON DELETE SET NULL
);

CREATE INDEX idx_medic_ledger_medic_date ON medic_ledger_entries(medic_id, entry_date DESC);
CREATE INDEX idx_medic_ledger_booking    ON medic_ledger_entries(booking_id) WHERE booking_id IS NOT NULL;

COMMENT ON TABLE medic_ledger_entries IS
  'T65 Phase 2 — append-only medic compensation ledger. Mirrors doctor_ledger_entries with BIGINT amount_paise (doctor side gets promoted in M058).';
