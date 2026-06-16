-- M049: medics table
--
-- T65 Phase 1 — onboards medics as first-class entities. Phone-keyed
-- (UNIQUE) so the OTP verify route can resolve a phone to a medic_id
-- the same way it already resolves customers + doctors. RLS deferred
-- (matches M035/M036/M042 precedent — ownership enforced in the
-- /api/medic-app/* route layer via requireMedic middleware).
--
-- Qualification CHECK matches the workspace CLAUDE.md domain fact:
-- medics are GNM / B.Sc Nursing, never ANM/DNM (the Legality Framework
-- doc contradicts this; the website + founder override is GNM/B.Sc).

CREATE TABLE medics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  qualification TEXT NOT NULL CHECK (qualification IN ('GNM', 'B.Sc Nursing')),
  license_number TEXT,
  photo_url TEXT,
  hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_medics_phone ON medics(phone);
CREATE INDEX idx_medics_active ON medics(active) WHERE active = TRUE;

CREATE OR REPLACE FUNCTION update_medics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS medics_updated_at ON medics;
CREATE TRIGGER medics_updated_at
  BEFORE UPDATE ON medics
  FOR EACH ROW
  EXECUTE FUNCTION update_medics_updated_at();

COMMENT ON TABLE medics IS
  'T65 — Sanocare medics. Phone-keyed for OTP resolution. Ops onboards via /ops/medics admin UI (deferred to T65 v0.1; for v0, seed manually via SQL).';
COMMENT ON COLUMN medics.qualification IS
  'GNM or B.Sc Nursing only (founder lock). The Legality Framework doc contradicts but is overridden by website + ops.';
COMMENT ON COLUMN medics.license_number IS
  'Nullable — pilot medics may onboard pre-license-upload. Required at v0.1 ops admin UI.';
