-- M048: customers_health_notes_column
--
-- T90 Slice 2 Step 13 — symmetric health-notes column on customers so the
-- Pulse Profile tab can edit the same field for both viewing-self (writes
-- to customers.health_notes) and viewing-family-member (writes to
-- family_members.health_notes, already added in M046). Without this column,
-- the self-viewing Profile tab has no place to store health notes — a UX
-- gap noted in the Step 13 plan-gate.
--
-- Nullable, no backfill needed (NULL is correct for everyone today — the
-- field has never been collected before).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS health_notes TEXT;

COMMENT ON COLUMN customers.health_notes IS
  'Free-text health notes for the account holder (caregiver themselves). Mirrors family_members.health_notes; symmetric Profile tab editing UX across self + family viewing.';
