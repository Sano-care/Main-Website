-- M051: medic_location_pings table
--
-- T65 Phase 1.5 — continuous location monitoring (founder policy lock 2026-06-15).
-- Append-only ping log. ON DELETE CASCADE on both FKs since pings have no
-- standalone value without the medic + attendance window context.
--
-- Indexes: medic+time for ops "where is this medic now" queries; attendance_id
-- for "show me track for this attendance session" ops queries.
--
-- battery_pct + speed_mps are Android-supplied diagnostic columns. Nullable
-- because not all GPS reads include them.

CREATE TABLE medic_location_pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medic_id UUID NOT NULL REFERENCES medics(id) ON DELETE CASCADE,
  attendance_id UUID REFERENCES medic_attendance(id) ON DELETE CASCADE,
  pinged_at TIMESTAMPTZ NOT NULL,
  lat NUMERIC(9,6) NOT NULL,
  lng NUMERIC(9,6) NOT NULL,
  accuracy_m NUMERIC(6,2),
  battery_pct INTEGER CHECK (battery_pct IS NULL OR (battery_pct >= 0 AND battery_pct <= 100)),
  speed_mps NUMERIC(6,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_medic_location_pings_medic_time ON medic_location_pings(medic_id, pinged_at DESC);
CREATE INDEX idx_medic_location_pings_attendance ON medic_location_pings(attendance_id, pinged_at DESC);

COMMENT ON TABLE medic_location_pings IS
  'T65 Phase 1.5 — continuous location pings during a medic''s clocked-in window. Append-only. Pings outside an open attendance window are soft-rejected by the /api/medic-app/location route.';
COMMENT ON COLUMN medic_location_pings.attendance_id IS
  'FK to medic_attendance row that was open at ping time. NULL only if attendance was closed mid-batch (race); accepted defensively.';
COMMENT ON COLUMN medic_location_pings.battery_pct IS
  'Device battery percentage at ping time. NULL when Android Battery API not available or stale.';
