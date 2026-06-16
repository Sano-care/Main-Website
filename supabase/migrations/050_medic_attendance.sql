-- M050: medic_attendance table
--
-- T65 Phase 1 — append-only attendance log. ONE open row per medic at
-- any time (clock_out_at IS NULL = currently clocked in). The route
-- handler enforces "one open" by querying for an open row before
-- allowing clock_in.
--
-- ON DELETE RESTRICT on medic_id intentional — attendance history
-- preserved if a medic row is hard-deleted (which should never happen
-- in practice; the active=false soft-delete is the canonical path).

CREATE TABLE medic_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medic_id UUID NOT NULL REFERENCES medics(id) ON DELETE RESTRICT,
  clock_in_at TIMESTAMPTZ NOT NULL,
  clock_in_lat NUMERIC(9,6),
  clock_in_lng NUMERIC(9,6),
  clock_out_at TIMESTAMPTZ,
  clock_out_lat NUMERIC(9,6),
  clock_out_lng NUMERIC(9,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_medic_attendance_medic_date ON medic_attendance(medic_id, clock_in_at);

-- Partial index for the hot path: "find this medic's currently open
-- attendance row" runs on every authenticated /attendance hit.
CREATE INDEX idx_medic_attendance_open ON medic_attendance(medic_id)
  WHERE clock_out_at IS NULL;

COMMENT ON TABLE medic_attendance IS
  'T65 — append-only medic clock in/out log. One open row per medic at any time. v0 has no geofence enforcement; lat/lng are optional capture.';
COMMENT ON COLUMN medic_attendance.clock_in_lat IS
  'NULL when the medic denied location permission at clock-in time. Acceptable in v0 (geofence enforcement is v0.1+ scope).';
