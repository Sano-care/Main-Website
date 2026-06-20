-- M060 — Aarogya Slice 3 (T66) — no-show recovery flow timer.
--
-- 5-minute window after the medic-app POSTs patient_no_show: if the
-- patient inbounds OR the medic logs visit_started, we cancel the
-- escalation. Otherwise pg_cron fires an audit_log + escalations row
-- so ops sees the no-show in their queue.
--
-- Storage: dedicated queue table (not audit_log) so atomic claim
-- semantics (UPDATE ... RETURNING) are race-safe across the
-- every-minute cron firing.
--
-- Reversibility:
--   SELECT cron.unschedule('no-show-escalation-check');
--   DROP TABLE no_show_escalation_queue;
--   (pg_cron extension stays — used elsewhere or harmless if not.)

-- 1) Queue table — one row per patient_no_show event, terminal columns
--    are escalated_at (sent to ops) or recovered_at (patient came back).
CREATE TABLE IF NOT EXISTS no_show_escalation_queue (
  booking_id    UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  medic_id      UUID NOT NULL,
  no_show_at    TIMESTAMPTZ NOT NULL,
  escalated_at  TIMESTAMPTZ,
  recovered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_no_show_pending
  ON no_show_escalation_queue (no_show_at)
  WHERE escalated_at IS NULL AND recovered_at IS NULL;

-- 2) pg_cron extension (no-op if already enabled).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 3) Drop any prior schedule under this name so re-runs are idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('no-show-escalation-check');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 4) Schedule: every minute, recover-then-escalate, atomic per row.
SELECT cron.schedule(
  'no-show-escalation-check',
  '* * * * *',
  $cron$
    DO $body$
    DECLARE
      rec record;
    BEGIN
      -- a) Recovery — for each still-pending row, check if patient came back.
      FOR rec IN
        UPDATE no_show_escalation_queue q
           SET recovered_at = NOW()
         WHERE q.escalated_at IS NULL
           AND q.recovered_at IS NULL
           AND (
             EXISTS (
               SELECT 1 FROM medic_event_log m
                WHERE m.booking_id = q.booking_id
                  AND m.event = 'visit_started'
                  AND m.occurred_at > q.no_show_at
             )
             OR EXISTS (
               SELECT 1 FROM messages msg
                 JOIN conversations c ON c.id = msg.conversation_id
                 JOIN bookings b ON b.phone = c.whatsapp_phone
                WHERE b.id = q.booking_id
                  AND msg.direction = 'inbound'
                  AND msg.created_at > q.no_show_at
             )
           )
        RETURNING q.booking_id, q.medic_id
      LOOP
        INSERT INTO audit_log (event_type, event_data)
        VALUES ('no_show_recovery_inbound',
                jsonb_build_object('booking_id', rec.booking_id, 'medic_id', rec.medic_id));
      END LOOP;

      -- b) Escalation — atomically claim rows older than 5 min, write audit + escalations row.
      FOR rec IN
        UPDATE no_show_escalation_queue q
           SET escalated_at = NOW()
         WHERE q.escalated_at IS NULL
           AND q.recovered_at IS NULL
           AND q.no_show_at < NOW() - INTERVAL '5 minutes'
        RETURNING q.booking_id, q.medic_id
      LOOP
        INSERT INTO audit_log (event_type, event_data)
        VALUES ('no_show_escalation_fired',
                jsonb_build_object('booking_id', rec.booking_id, 'medic_id', rec.medic_id));

        -- Look up the conversation_id via the booking's phone; if there's
        -- no conversations row yet (patient never received the door
        -- template — unusual but possible), skip the escalations insert.
        -- The audit row is the source of truth either way; ops can join
        -- back via the audit payload.
        INSERT INTO escalations (conversation_id, escalation_type, priority)
        SELECT c.id, 'no_show_escalation', 'p1'
          FROM bookings b
          JOIN conversations c ON c.whatsapp_phone = b.phone
         WHERE b.id = rec.booking_id
         LIMIT 1;
      END LOOP;
    END $body$;
  $cron$
);
