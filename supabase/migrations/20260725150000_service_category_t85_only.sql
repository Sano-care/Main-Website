-- Collapse bookings.service_category to the 4 canonical T85 slugs.
--
-- Founder decision: the only valid service vocabulary is
--   home-visit | teleconsultation | lab-tests | medic-at-home
-- Every legacy value is retired. Existing rows are renamed; the CHECK is
-- then tightened so no new row can hold a retired value. "chronic" is a
-- discontinued service and is folded into medic-at-home.
--
-- Rename mapping (evidence per value verified in prod, 90 rows total):
--   homecare (21), "Home visit" (2), home-visit (4)      -> home-visit       (27)
--   teleconsult (13)                                     -> teleconsultation (13)
--   diagnostics (4), lab (3), lab-tests (2)              -> lab-tests         (9)
--   chronic (5, discontinued), nursing (4), medic-at-home(32) -> medic-at-home (41)
--
-- ORDER MATTERS: rename the rows BEFORE tightening the CHECK, or the
-- UPDATEs trip the new constraint.

-- 1) Rename legacy rows to their T85 slug.
UPDATE public.bookings SET service_category = 'home-visit'
  WHERE service_category IN ('homecare', 'Home visit');
UPDATE public.bookings SET service_category = 'teleconsultation'
  WHERE service_category = 'teleconsult';
UPDATE public.bookings SET service_category = 'lab-tests'
  WHERE service_category IN ('diagnostics', 'lab');
UPDATE public.bookings SET service_category = 'medic-at-home'
  WHERE service_category IN ('chronic', 'nursing');
-- (home-visit / teleconsultation / lab-tests / medic-at-home already canonical.)

-- 2) Tighten the CHECK to the 4 T85 slugs only (NULL stays permitted, as before).
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_service_category_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_service_category_check
  CHECK (
    service_category IS NULL
    OR service_category = ANY (ARRAY[
      'home-visit'::text,
      'teleconsultation'::text,
      'lab-tests'::text,
      'medic-at-home'::text
    ])
  );

-- 3) Post-state assertion: no row holds a retired value. Fails the whole
--    migration (transactional) if the rename missed anything.
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.bookings
   WHERE service_category IS NOT NULL
     AND service_category NOT IN ('home-visit','teleconsultation','lab-tests','medic-at-home');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'service_category cleanup failed: % row(s) still hold a retired value', v_bad;
  END IF;
END $$;
