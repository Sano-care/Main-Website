-- Slice A — structured patient allergies (Pulse Records + Aarogya read access).
--
-- Same scoping + RLS posture as public.conditions (see that migration's header):
-- customer_id NOT NULL, member_id nullable FK (NULL = account holder), deny-all
-- RLS + service-role + code-level customer_id scoping. Adds severity + reaction
-- because an allergy's clinical weight is the severity and the reaction it causes.
--
-- Applied via Supabase MCP; recorded version = this file's prefix (20260623062123).

CREATE TABLE public.allergies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.family_members(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(trim(label)) >= 1),
  severity text NOT NULL DEFAULT 'unknown' CHECK (severity IN ('mild','moderate','severe','unknown')),
  reaction text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','inactive')),
  source text NOT NULL DEFAULT 'patient' CHECK (source IN ('patient','medic','doctor','import')),
  noted_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_allergies_customer ON public.allergies(customer_id);
CREATE INDEX idx_allergies_member ON public.allergies(member_id) WHERE member_id IS NOT NULL;

ALTER TABLE public.allergies ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.allergies IS
  'Slice A: structured patient allergies for Pulse Records + Aarogya read access. Augments free-text health_notes. Deny-all RLS; service-role + code-level customer_id scoping.';
COMMENT ON COLUMN public.allergies.member_id IS
  'Nullable FK to family_members. NULL = account holder (customer) is the subject; non-null = that family member. ON DELETE CASCADE: removing a member removes their allergies.';
COMMENT ON COLUMN public.allergies.severity IS
  'Clinical weight: mild | moderate | severe | unknown (default). Surfaced to Aarogya for explain-only context — never for dosing/treatment decisions (MoHFW 2020).';
