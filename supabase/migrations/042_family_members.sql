-- Migration 042: T64 — family_members table + bookings.member_id + bookings.coordination_phone
--
-- One account-owner (a customer) can have up to 8 family members for whom
-- they book Sanocare services on behalf. The booking row optionally links
-- to one family member; NULL = booking is for Self (the account owner).
--
-- Per T64_BRIEF_PATCH.md divergence 1: NO RLS policies on family_members.
-- Ownership is enforced in the API layer (/api/pulse/family-members/*)
-- via getCurrentCustomer() + WHERE customer_id = <resolved id> on every
-- query. Matches the existing precedent set by M035 (vital_readings) and
-- M036 (medications), and the API uses the service-role client which
-- bypasses RLS anyway.
--
-- Per T64_BRIEF_PATCH.md divergence 2: the account-owner table is
-- public.customers (M013), keyed by phone. FK column is named
-- customer_id to match bookings.customer_id (M013).
--
-- "Self" is a virtual UI concept, not a stored row. There is intentionally
-- no relation = 'self' in the CHECK constraint; Self bookings simply use
-- bookings.member_id = NULL. Existing 57 prod bookings stay NULL — no
-- backfill needed.
--
-- apply_migration wraps its own transaction.

-- ====================================================================
-- M042 prologue: retire the v0 universe.
-- ====================================================================
-- These four tables are from a May 2026 Supabase-Auth-pattern prototype that
-- predates the current customers + bookings architecture (M013+). Zero src/
-- references. 28 test rows total. Founder confirms no external dependencies +
-- no plan to re-adopt Supabase Auth (Sanocare stays on cookie-OTP). Dropping
-- CASCADE is safe.
--
-- v0 universe being retired:
--   profiles       (11 rows) — Supabase-Auth-style multi-role profile table
--   consultations  ( 8 rows) — v0 booking surface (predates bookings + consultation_sessions)
--   family_members ( 3 rows) — v0 family list (collides with T64 canonical name)
--   vitals         ( 6 rows) — v0 vitals (predates vital_readings M035)

DROP TABLE IF EXISTS public.vitals CASCADE;
DROP TABLE IF EXISTS public.consultations CASCADE;
DROP TABLE IF EXISTS public.family_members CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ====================================================================
-- family_members
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,

  -- Display name shown across Pulse + booking surfaces + the
  -- aarogya_lead_alert {{1}} template variable when this member is the
  -- subject of a booking. Trim-and-min-2 mirrors the IdentifyStep
  -- validator in the booking modal.
  name text NOT NULL CHECK (length(trim(name)) >= 2),

  -- Closed enum of common-Indian-household relations. 'other' is the
  -- escape hatch and requires relation_other to be set (see CHECK
  -- below). 'self' is intentionally absent — see file header.
  relation text NOT NULL CHECK (relation IN (
    'spouse', 'father', 'mother', 'son', 'daughter',
    'brother', 'sister', 'other'
  )),

  -- Free-text override for relation = 'other' (e.g. "father-in-law",
  -- "aunt"). The CHECK below enforces: non-empty when relation='other',
  -- null otherwise.
  relation_other text,

  -- Nullable. Many patients won't share. When null, the lead-alert
  -- {{2}} template variable falls back to "—y" (matches current T85
  -- behavior for missing-age cases).
  dob date,

  gender text CHECK (gender IN ('male', 'female', 'other', 'prefer-not-to-say')),

  -- Free-text ops notes about the member (e.g. "diabetic, on metformin").
  -- Surfaced in the aarogya_lead_alert {{5}} Context string when this
  -- member is booked.
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- relation_other coupling: required for 'other', forbidden otherwise.
  CONSTRAINT family_members_relation_other_check CHECK (
    (relation = 'other' AND relation_other IS NOT NULL AND length(trim(relation_other)) >= 1)
    OR (relation <> 'other' AND relation_other IS NULL)
  )
);

COMMENT ON TABLE public.family_members IS
  'T64: per-customer family members. One account → N members (hard cap 8 via trigger). Bookings optionally link via bookings.member_id; NULL = booking is for Self.';

COMMENT ON COLUMN public.family_members.customer_id IS
  'FK to customers.id. ON DELETE CASCADE: deleting the customer (rare) deletes their family list.';

COMMENT ON COLUMN public.family_members.dob IS
  'Nullable. Computed-age helper in src/lib/family-members/relations.ts returns null when this is null; lead-alert {{2}} falls back to "—y".';

-- One lookup pattern dominates: "all members for this customer". Index
-- by customer_id keeps that O(log n).
CREATE INDEX IF NOT EXISTS idx_family_members_customer
  ON public.family_members (customer_id);

-- ====================================================================
-- Hard cap: 8 family members per customer
-- ====================================================================

-- Enforced via BEFORE INSERT trigger. UPDATE is not gated (customer_id
-- is set on INSERT and never reassigned — no UI for transferring
-- members between accounts).
--
-- A partial unique index can't enforce a count; trigger is the right
-- shape.

CREATE OR REPLACE FUNCTION public.enforce_family_members_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT count(*) FROM public.family_members WHERE customer_id = NEW.customer_id) >= 8 THEN
    RAISE EXCEPTION 'Family member cap reached (8 members per customer)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_members_cap ON public.family_members;
CREATE TRIGGER trg_family_members_cap
  BEFORE INSERT ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_family_members_cap();

-- ====================================================================
-- bookings.member_id + bookings.coordination_phone
-- ====================================================================

-- Nullable FK to family_members. NULL = booking is for Self. ON DELETE
-- SET NULL: deleting a family member preserves booking history (the
-- row continues to exist with member_id reverted to NULL = "now looks
-- like a Self booking").
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS member_id uuid NULL
    REFERENCES public.family_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bookings.member_id IS
  'T64: nullable FK to family_members. NULL = booking is for Self (account owner). ON DELETE SET NULL preserves booking history when the member is deleted.';

-- Optional per-booking direct-contact phone for medic-to-relative
-- coordination (e.g. "the medic should call the patient''s daughter at
-- this number to coordinate arrival, not the account owner"). Free
-- text — validated client-side via libphonenumber-js; the DB stores
-- whatever the client sent, same loose discipline as bookings.phone.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS coordination_phone text NULL;

COMMENT ON COLUMN public.bookings.coordination_phone IS
  'T64: optional per-booking direct-contact phone for medic-to-relative coordination. Account-owner phone (in bookings.phone / customers.phone) remains the primary contact. Not template-routed; surfaced in ops_notes / ops dashboards.';

-- Index for the "all bookings for this member" query that T72 will
-- need eventually. Partial: only non-null member_id rows. Small index,
-- low cardinality (≤8 members per account × N bookings per member).
CREATE INDEX IF NOT EXISTS idx_bookings_member
  ON public.bookings (member_id)
  WHERE member_id IS NOT NULL;
