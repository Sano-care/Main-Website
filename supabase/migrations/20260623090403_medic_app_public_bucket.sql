-- Public Storage bucket for the Sanocare Medic Android app APK.
--
-- Founder decision (2026-06-23): public-read is acceptable — app sign-in is
-- OTP-gated to phones in the medics table, so a non-medic can download/install
-- but can never log in. The APK lives at a STABLE path (sanocare-medic-latest.apk)
-- that we overwrite each release, so the public download URL + the /download/medic
-- footer link never change.
--
-- Public bucket → readable via /storage/v1/object/public/medic-app/... with no
-- auth and no RLS policy. Uploads are service-role only (overwrite on release).
--
-- NOTE: the project-global Storage "Upload file size limit" must be ≥ the APK
-- size (~78 MB). It defaults to 50 MB and caps the per-bucket limit, so raise it
-- in the dashboard (Storage → Settings → Upload file size limit) before the first
-- upload. This migration only creates the bucket; the binary object is uploaded
-- out-of-band via the Storage API.
--
-- Applied via Supabase MCP (recorded version 20260623090403); filename matches.
-- Reversibility: delete from storage.buckets where id = 'medic-app';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('medic-app', 'medic-app', true, 209715200)  -- 200 MB ceiling (APK ~78 MB)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;
