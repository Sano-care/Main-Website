-- M052: medic_event_log — the 4-event contract
--
-- T65 Phase 2 — append-only event log for the medic-app's BookingDetailScreen.
-- Each row: one medic firing one of 4 events on one booking. Idempotency at
-- DB level via UNIQUE (booking_id, medic_id, event) — duplicate POST returns
-- the existing row with HTTP 200.
--
-- ON DELETE CASCADE on booking_id: if a booking is hard-deleted (rare), its
-- event log goes with it. ON DELETE RESTRICT on medic_id: a medic with logged
-- events cannot be hard-deleted (use medics.active=false instead).

CREATE TABLE medic_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  medic_id UUID NOT NULL REFERENCES medics(id) ON DELETE RESTRICT,
  event TEXT NOT NULL CHECK (event IN ('departed','reached','visit_started','visit_done')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat NUMERIC(9,6),
  lng NUMERIC(9,6),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, medic_id, event)
);

CREATE INDEX idx_medic_event_booking    ON medic_event_log(booking_id);
CREATE INDEX idx_medic_event_medic_date ON medic_event_log(medic_id, occurred_at DESC);

COMMENT ON TABLE medic_event_log IS
  'T65 Phase 2 — append-only event log for the 4-event medic visit contract (departed → reached → visit_started → visit_done). Idempotency via UNIQUE (booking_id, medic_id, event).';
