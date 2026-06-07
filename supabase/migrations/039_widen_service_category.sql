-- =============================================================================
-- M039 (T85 PR4a) — widen bookings.service_category to accept T85 slugs
-- alongside legacy M003 values.
--
-- Strategy: option (a) widen + deprecate (founder Q2 lean confirmed). Both
-- legacy and T85 slugs are valid post-M039; new writes use T85 slugs; legacy
-- values age out in a future migration once analytics confirm zero new writes.
--
-- A runtime mapper (`src/lib/booking/serviceMapper.ts`) translates between
-- display ↔ DB so reads on /ops can render either form, but new bookings
-- always persist the T85 slug.
--
-- ⚠️ MIGRATION NUMBER CHECK BEFORE MERGE.
--   At branch-cut time (2026-06-07) the last applied migration was M038 and
--   M037 was reserved on an unrelated in-flight branch (founder commit pending,
--   per founder Q5 answer). If M037 lands on main first, this file may need to
--   bump to M040 before the M039 number collides. Verify at rebase + merge
--   time with `ls supabase/migrations/` and rename as needed.
-- =============================================================================

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_service_category_check;

ALTER TABLE bookings ADD CONSTRAINT bookings_service_category_check
  CHECK (service_category IS NULL OR service_category IN (
    -- Legacy (M003) — kept for back-compat with ops queries + historical rows.
    -- New writes don't use these; the runtime mapper translates display values.
    'homecare', 'teleconsult', 'chronic', 'diagnostics',
    -- T85 (M039) — service-led slugs. ServiceLedBookingModal writes these
    -- directly post-M039. medic-at-home becomes a top-level value here
    -- (was previously rolled into homecare per M003's data backfill).
    'home-visit', 'teleconsultation', 'lab-tests', 'medic-at-home'
  ));

-- Helpful audit index for the legacy → T85 cutover analytics. A future
-- migration uses this to confirm zero new writes are landing with legacy
-- values before deprecating them outright.
CREATE INDEX IF NOT EXISTS idx_bookings_service_category_legacy
  ON bookings (service_category)
  WHERE service_category IN ('homecare', 'teleconsult', 'chronic', 'diagnostics');

COMMENT ON CONSTRAINT bookings_service_category_check ON bookings IS
  'T85 widening: both legacy (M003) and T85 slugs accepted. Legacy ages out post-T85 stabilisation.';
