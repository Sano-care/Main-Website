-- M046: pulse_v1_phase1_profile_fields
-- (M045 = booking_feedback_response from PR #50 Aarogya Slice 2a, already on prod)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE family_members
  ADD COLUMN IF NOT EXISTS health_notes TEXT;

COMMENT ON COLUMN customers.email IS
  'Optional email captured on Pulse Profile tab (Pulse v1 Phase 1). Nullable.';
COMMENT ON COLUMN family_members.health_notes IS
  'Free-text health notes (conditions, allergies, etc.) captured on Pulse Profile tab Phase 1. Phase 2 will introduce structured conditions/allergies tables.';
