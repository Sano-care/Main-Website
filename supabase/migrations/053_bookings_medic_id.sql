-- M053: bookings.medic_id — FK to medics (replaces assigned_paramedic_id)
--
-- T65 Phase 2 — adds the medic assignment FK on bookings. ON DELETE SET NULL
-- so a medic deactivation/removal doesn't cascade into the booking history.
-- Co-exists with assigned_paramedic_id during this migration; M054 drops the
-- legacy column.
--
-- No backfill: zero phone-overlap audit-verified between paramedics + medics.

ALTER TABLE bookings
  ADD COLUMN medic_id UUID REFERENCES medics(id) ON DELETE SET NULL;

CREATE INDEX idx_bookings_medic ON bookings(medic_id) WHERE medic_id IS NOT NULL;

COMMENT ON COLUMN bookings.medic_id IS
  'T65 Phase 2 — assigned medic for home-visit / chronic bookings. Replaces assigned_paramedic_id (dropped in M054).';
