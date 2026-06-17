-- M057: medic_payout_settlements — one row per settled payout
--
-- T65 Phase 2 Hub — Settle Payout flow. Manual entry (no Razorpay Payouts
-- API in Phase 2). Each settlement carries a UPI/bank txn reference + a
-- proof doc (UPI screenshot or bank receipt), both required.
--
-- ON DELETE RESTRICT on proof_doc_id: can't soft-delete the proof while the
-- settlement still references it.
--
-- The settle transaction in code:
--   1. INSERT INTO medic_documents (doc_type='payout_proof', ...)
--   2. INSERT INTO medic_payout_settlements (..., proof_doc_id=$1)
--   3. INSERT INTO medic_ledger_entries (entry_type='payout',
--      amount_paise=-settlement.amount_paise, ...)
-- All three or none — wrapped in a single transaction at the API layer.

CREATE TABLE medic_payout_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medic_id UUID NOT NULL REFERENCES medics(id) ON DELETE RESTRICT,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  reference_text VARCHAR(120) NOT NULL,
  proof_doc_id UUID NOT NULL REFERENCES medic_documents(id) ON DELETE RESTRICT,
  payout_method TEXT NOT NULL CHECK (payout_method IN ('upi','bank_transfer','cash','other')),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_by UUID NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_settlements_medic_date ON medic_payout_settlements(medic_id, settled_at DESC);

COMMENT ON TABLE medic_payout_settlements IS
  'T65 Phase 2 Hub — manual-entry payout settlements. Each row references a payout_proof doc + writes a negative-amount ledger entry. v0 = no Razorpay Payouts API.';
