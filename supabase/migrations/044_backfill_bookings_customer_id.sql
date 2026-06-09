-- Migration 044: backfill bookings.customer_id from matching customers.phone
--
-- Retroactively links every existing booking row that has customer_id IS NULL
-- but a phone that matches an existing customers row. Verified pre-apply:
-- SAN-B-00058 (+919760059900 → SAN-C-00007 Shashwat) and SAN-B-00059
-- (+918210508846 → SAN-C-00006 Aayushi) both land via this query. Any other
-- historical orphans with a matching phone in customers also get linked in
-- the same single UPDATE.
--
-- Strictly additive: bookings with customer_id already set are untouched
-- (the WHERE filter only matches NULL rows). Bookings with no matching
-- customers.phone stay NULL — those become candidates for the auto-upsert
-- path from /api/auth/verify-otp going forward, or for an ops-driven manual
-- linkage.
--
-- apply_migration wraps its own transaction.

UPDATE public.bookings b
SET customer_id = c.id
FROM public.customers c
WHERE b.customer_id IS NULL
  AND b.phone IS NOT NULL
  AND b.phone = c.phone;
