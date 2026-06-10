-- Migration 043: drop NOT NULL on customers.full_name + customers.customer_code
--
-- Enables the customer auto-upsert path that lands on /api/auth/verify-otp:
-- a brand-new phone (no existing customers row) gets a customers row inserted
-- immediately on OTP success with just the phone populated. full_name fills in
-- when the patient types their name in IdentifyStep / LabBasketWindow; the
-- ops UI continues to set customer_code manually for new walk-in customers
-- and leaves auto-upserted rows with NULL until first ops touch.
--
-- Per founder plan-gate (2026-06-09): no triggers, no DEFAULTs. The columns
-- become genuinely optional. The UNIQUE constraint on customer_code already
-- allows multiple NULL values (PostgreSQL UNIQUE NULL semantics) so this is
-- a no-op for the existing 7 customer rows.
--
-- Applies cleanly to the existing 7 rows because all of them already have
-- non-NULL full_name + customer_code (verified before apply). Reverting via
-- adding NOT NULL back would fail if any auto-upserted rows exist with NULL
-- values — that's intentional; revert is a separate planning exercise.
--
-- apply_migration wraps its own transaction.

ALTER TABLE public.customers
  ALTER COLUMN full_name DROP NOT NULL;

ALTER TABLE public.customers
  ALTER COLUMN customer_code DROP NOT NULL;

COMMENT ON COLUMN public.customers.full_name IS
  'Patient display name. Nullable since M043 — populated lazily when the patient first types their name (booking form, Pulse signup). Auto-upserted rows from /api/auth/verify-otp start with NULL here.';

COMMENT ON COLUMN public.customers.customer_code IS
  'Display code (SAN-C-NNNNN). Nullable since M043 — populated by the ops UI when the customer is first reviewed by ops. Auto-upserted rows from /api/auth/verify-otp start with NULL here. UNIQUE constraint permits multiple NULLs per Postgres semantics.';
