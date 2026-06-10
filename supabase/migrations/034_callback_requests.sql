-- Migration 034: Quick Book callback request queue
-- Audit row per "Get a Callback" submission from the homepage Quick
-- Book card. Patient enters name + phone; we record it for ops to
-- ring back. Not a Booking yet — no service category, no address,
-- no GPS. Once ops makes contact and the patient picks a service,
-- ops creates the real booking via /ops/bookings/new and (optional)
-- updates this row to mark it converted.
--
-- No RLS policy — writes happen via service-role from the
-- /api/callback-request route. Reads will be ops-only via a future
-- /ops/callbacks surface (not in this PR).
--
-- apply_migration wraps its own transaction; same convention as
-- M026–M033.

CREATE TABLE IF NOT EXISTS public.callback_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  phone           text NOT NULL,
  source          text NOT NULL DEFAULT 'homepage_quick_book'
                    CHECK (source IN ('homepage_quick_book')),
  user_agent      text,
  ip_hash         text,
  converted_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES public.ops_users(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_callback_requests_created_at
  ON public.callback_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_callback_requests_unresolved
  ON public.callback_requests (created_at DESC)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE public.callback_requests IS
  'Homepage Quick Book callback queue. Patient gives name + phone; '
  'ops rings back. Not a booking — no service / address / GPS. '
  'converted_booking_id links to the eventual real booking if any.';

DO $$
BEGIN
  RAISE NOTICE 'callback_requests present=% indexes=%',
    (SELECT count(*) FROM information_schema.tables
       WHERE table_schema='public' AND table_name='callback_requests'),
    (SELECT count(*) FROM pg_indexes
       WHERE schemaname='public' AND tablename='callback_requests');
END $$;
