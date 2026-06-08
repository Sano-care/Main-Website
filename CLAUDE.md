# CLAUDE.md

Project context for Claude Code sessions on the Sanocare Main-Website
repo. Lives in-repo so every session sees the same source-of-truth.

## Domain facts that bite if you forget them

- `family_members` table (M042) — one-to-many under `customers`, hard
  cap 8 enforced via BEFORE INSERT trigger. NO RLS policies (matches
  M035/M036 precedent — ownership enforced in API layer via
  `getCurrentCustomer()`). "Self" is virtual: `bookings.member_id =
  NULL` means booking is for account owner. `relation` is a closed
  enum without 'self' — `relation='self'` is invalid by design.
  `relation_other` is non-empty iff `relation='other'`.

- `bookings.member_id` + `bookings.coordination_phone` (M042) —
  nullable additions on existing bookings table. `member_id ON DELETE
  SET NULL` preserves booking history when a member is deleted (the
  denormalised `bookings.patient_name` snapshot stays). `coordination_phone`
  is per-booking optional direct-contact for medic-to-relative
  coordination (not the primary contact path).

- **v0 schema universe retired** (M042 prologue, 2026-06-08) —
  `profiles`, `consultations`, `family_members`, `vitals` tables from
  a May 2026 Supabase-Auth prototype were DROP CASCADE'd. Zero `src/`
  references existed. Current architecture: `customers` (M013) +
  `bookings` (M013) + `consultation_sessions` (M021) +
  `vital_readings` (M035). If you find code or queries referencing the
  v0 names, they're dead — flag for cleanup.
