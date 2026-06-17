-- M058: settle_medic_payout() — transactional payout settlement
--
-- T65 Phase 2B C5a — the Settle flow's DB half. PostgREST/Supabase-JS is
-- stateless (no multi-statement transactions over the wire), so the
-- three-step settle (proof doc → settlement → ledger entry) is wrapped in
-- a single plpgsql function. A plpgsql function body is atomic: if any
-- INSERT raises, every prior INSERT in the same call rolls back. That
-- gives us steps 2-4 of the locked 4-step flow as one unit.
--
-- Step 1 (Storage upload) lives in the API route, NOT here — Storage isn't
-- transactional with Postgres. The route uploads first, calls this
-- function, and on ANY error from this call removes the orphaned Storage
-- object before re-throwing. So the full rollback semantics are:
--   - function raises  → DB auto-rolls back inserts; route deletes object.
--   - function returns → all three rows committed atomically.
--
-- entry_date is stamped in IST (the ledger's entry_date is a DATE and ops
-- think in IST), not UTC, so a late-evening settle doesn't land on the
-- wrong calendar day.
--
-- SECURITY DEFINER + pinned search_path: the route calls this via the
-- service-role client (which already bypasses RLS), but pinning search_path
-- is the safe convention for a writing function and keeps it robust if a
-- lower-privileged caller is ever wired in.

CREATE OR REPLACE FUNCTION settle_medic_payout(
  p_medic_id        UUID,
  p_amount_paise    BIGINT,
  p_reference_text  VARCHAR,
  p_payout_method   TEXT,
  p_notes           TEXT,
  p_file_path       TEXT,
  p_file_size_bytes INTEGER,
  p_mime_type       TEXT,
  p_ops_user_id     UUID
)
RETURNS TABLE (settlement_id UUID, doc_id UUID, ledger_entry_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc_id        UUID;
  v_settlement_id UUID;
  v_ledger_id     UUID;
  v_entry_date    DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  -- Step 2: proof doc row (doc_type fixed to payout_proof). Label carries
  -- the reference so the doc is identifiable from the Documents tab too.
  INSERT INTO medic_documents (
    medic_id, doc_type, file_path, file_size_bytes, mime_type, label, uploaded_by
  )
  VALUES (
    p_medic_id, 'payout_proof', p_file_path, p_file_size_bytes, p_mime_type,
    'Payout proof — ' || p_reference_text, p_ops_user_id
  )
  RETURNING id INTO v_doc_id;

  -- Step 3: settlement row, linking the proof doc from step 2.
  INSERT INTO medic_payout_settlements (
    medic_id, amount_paise, reference_text, proof_doc_id, payout_method,
    settled_by, notes
  )
  VALUES (
    p_medic_id, p_amount_paise, p_reference_text, v_doc_id, p_payout_method,
    p_ops_user_id, p_notes
  )
  RETURNING id INTO v_settlement_id;

  -- Step 4: ledger entry — payouts are STORED NEGATIVE so SUM(amount_paise)
  -- over the medic gives net outstanding (mirrors the doctor side).
  INSERT INTO medic_ledger_entries (
    medic_id, entry_type, amount_paise, entry_date, description, created_by
  )
  VALUES (
    p_medic_id, 'payout', -p_amount_paise, v_entry_date,
    'Payout settled — ' || p_payout_method || ' · ' || p_reference_text,
    p_ops_user_id
  )
  RETURNING id INTO v_ledger_id;

  RETURN QUERY SELECT v_settlement_id, v_doc_id, v_ledger_id;
END;
$$;

COMMENT ON FUNCTION settle_medic_payout IS
  'T65 Phase 2B C5a — atomic 3-step payout settlement (proof doc + settlement + negative ledger entry). Storage upload + rollback handled in the API route.';
