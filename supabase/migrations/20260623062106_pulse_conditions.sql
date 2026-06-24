-- Slice A — structured patient conditions (Pulse Records + Aarogya read access).
--
-- Augments (does NOT replace) the free-text customers.health_notes +
-- family_members.health_notes columns — those stay as free-form supplements
-- per founder sign-off 2026-06-23.
--
-- Scope: customer_id NOT NULL (the account owner). member_id is a NULLABLE FK
-- to family_members — NULL = the account holder themselves is the subject;
-- non-null = that family member is the subject. Mirrors bookings.member_id (M042).
-- (Rider: vital_readings + medications stay account-level this slice — a tracked
-- follow-up covers per-member vitals/meds; no dead member_id column added there.)
--
-- Deny-all RLS: RLS enabled, zero policies. All reads/writes go through the
-- service-role client scoped by customer_id in code (getCurrentCustomer() on the
-- Pulse side, resolveIdentity() on the Aarogya side). Matches the M035/M036/M042
-- + media_assets precedent.
--
-- Applied via Supabase MCP; recorded version = this file's prefix (20260623062106).

CREATE TABLE public.conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(trim(label)) >= 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','inactive')),
  source text NOT NULL DEFAULT 'patient' CHECK (source IN ('patient','medic','doctor','import')),
  noted_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conditions_customer ON public.conditions(customer_id);
CREATE INDEX idx_conditions_member ON public.conditions(member_id) WHERE member_id IS NOT NULL;

ALTER TABLE public.conditions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.conditions IS
  'Slice A: structured patient conditions for Pulse Records + Aarogya read access. Augments free-text health_notes. Deny-all RLS; service-role + code-level customer_id scoping.';
COMMENT ON COLUMN public.conditions.member_id IS
  'Nullable FK to family_members. NULL = account holder (customer) is the subject; non-null = that family member. ON DELETE CASCADE: removing a member removes their conditions.';
COMMENT ON COLUMN public.conditions.source IS
  'Provenance: patient (self-entered in Pulse), medic, doctor, or import (e.g. from a prescription).';
