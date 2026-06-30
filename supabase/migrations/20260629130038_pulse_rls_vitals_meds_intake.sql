-- R2b Part 2 — close the anon-key hole on patient health data.
--
-- vital_readings, medications, medication_intake_log have been RLS-OFF, so the
-- anon/publishable key could read/write every customer's vitals + meds directly
-- via PostgREST (DPDP exposure on health data). Enable RLS with NO policies →
-- deny-all for anon + authenticated. Every app path is unaffected: all readers
-- and writers use the service-role client, which bypasses RLS — verified for
-- the Pulse read layer (recordsFetch/pulseData), the Aarogya tools, #112's
-- createMedication writer + intake flow, the #107 reminder cron
-- (medicationReminder), and the GDA home-visit checklist (createServiceClient
-- with SUPABASE_SERVICE_ROLE_KEY). No anon/publishable-key path touches these
-- three tables. Same deny-all posture as conditions/allergies/family_members.
--
-- Verified (rolled back, zero residue): as anon, SELECT → 0 rows on all three
-- and INSERT → denied (insufficient_privilege); as service_role, all rows visible.
ALTER TABLE public.vital_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_intake_log ENABLE ROW LEVEL SECURITY;
