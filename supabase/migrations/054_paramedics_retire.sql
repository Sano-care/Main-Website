-- M054: drop the legacy paramedics surface
--
-- T65 Phase 2 — founder ruling 2026-06-17: medics is canonical, paramedics
-- retires. Single FK references it (bookings.assigned_paramedic_id), 3 rows
-- (seed test data with mostly non-E.164 phones), zero overlap with medics.
--
-- The 9 bookings with assigned_paramedic_id set lose the column entirely;
-- their other audit columns (assigned_at, assigned_by) survive.

ALTER TABLE bookings DROP CONSTRAINT bookings_assigned_paramedic_id_fkey;
ALTER TABLE bookings DROP COLUMN assigned_paramedic_id;

DROP TABLE paramedics;
