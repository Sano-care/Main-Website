import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsAdminApi } from "@/app/ops/_lib/requireOpsAdmin";

export const runtime = "nodejs";

// T65 Phase 2B C5a — POST /api/ops/medics/[id]/settle
//
// Admin-only transactional payout settlement. The locked 4-step flow:
//   1. Storage upload to medic-documents at
//      {medic_id}/payout_proof/{uuid}-{filename}
//   2. INSERT medic_documents (doc_type='payout_proof')   ┐
//   3. INSERT medic_payout_settlements (proof_doc_id=2)    ├ atomic (RPC)
//   4. INSERT medic_ledger_entries (entry_type='payout',  ┘
//      amount_paise = -amount)
//
// Steps 2-4 run inside settle_medic_payout() (M058) — a plpgsql function,
// so they commit as one unit or not at all. Step 1 (Storage) can't join a
// Postgres transaction, so we wrap the whole flow in try/catch: upload
// first, call the function, and on ANY failure remove the orphaned Storage
// object before surfacing the error. Net effect: a failure at any step
// leaves ZERO partial state — no Storage object, no doc, no settlement, no
// ledger entry.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const VALID_PAYOUT_METHODS = new Set(["upi", "bank_transfer", "cash", "other"]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
  return cleaned.length > 0 ? cleaned : "file";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminGate = await requireOpsAdminApi();
  if (adminGate instanceof NextResponse) return adminGate;

  const { id: medicId } = await params;
  if (!UUID_RE.test(medicId)) {
    return NextResponse.json({ error: "invalid_medic_id" }, { status: 400 });
  }

  // Verify medic exists before touching Storage (no orphan objects).
  const { data: medic, error: medicErr } = await supabaseAdmin
    .from("medics")
    .select("id")
    .eq("id", medicId)
    .maybeSingle();
  if (medicErr) {
    console.error("[ops/medics/settle] medic lookup failed", medicErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!medic) {
    return NextResponse.json({ error: "medic_not_found" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_multipart" }, { status: 400 });
  }

  // ---- Field validation (before any Storage work) ----
  const file = formData.get("file");
  const amountPaise = Number(formData.get("amount_paise"));
  const referenceRaw = formData.get("reference_text");
  const payoutMethod = String(formData.get("payout_method") ?? "");
  const notesRaw = formData.get("notes");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (!VALID_MIMES.has(file.type)) {
    return NextResponse.json(
      { error: "mime_not_allowed", got: file.type },
      { status: 400 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "file_too_large", limit_bytes: MAX_FILE_SIZE },
      { status: 400 },
    );
  }

  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  const referenceText =
    typeof referenceRaw === "string" ? referenceRaw.trim() : "";
  if (referenceText.length === 0 || referenceText.length > 120) {
    return NextResponse.json({ error: "invalid_reference_text" }, { status: 400 });
  }

  if (!VALID_PAYOUT_METHODS.has(payoutMethod)) {
    return NextResponse.json({ error: "invalid_payout_method" }, { status: 400 });
  }

  const notes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0
      ? notesRaw.trim().slice(0, 500)
      : null;

  // ---- Step 1: Storage upload ----
  const filename = sanitizeFilename(file.name || "proof");
  const objectId = crypto.randomUUID();
  const storagePath = `${medicId}/payout_proof/${objectId}-${filename}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadErr } = await supabaseAdmin.storage
    .from("medic-documents")
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadErr) {
    console.error("[ops/medics/settle] storage upload failed", uploadErr);
    return NextResponse.json(
      { error: "storage_upload_failed", detail: uploadErr.message },
      { status: 500 },
    );
  }

  // ---- Steps 2-4: atomic RPC. Roll back Storage on ANY failure. ----
  try {
    const { data, error: rpcErr } = await supabaseAdmin.rpc(
      "settle_medic_payout",
      {
        p_medic_id: medicId,
        p_amount_paise: amountPaise,
        p_reference_text: referenceText,
        p_payout_method: payoutMethod,
        p_notes: notes,
        p_file_path: storagePath,
        p_file_size_bytes: file.size,
        p_mime_type: file.type,
        p_ops_user_id: adminGate.id,
      },
    );
    if (rpcErr) throw new Error(rpcErr.message);

    // rpc returns RETURNS TABLE → array of one row.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.settlement_id) {
      throw new Error("settle returned no settlement_id");
    }

    return NextResponse.json(
      {
        settlement_id: row.settlement_id,
        doc_id: row.doc_id,
        ledger_entry_id: row.ledger_entry_id,
      },
      { status: 201 },
    );
  } catch (e) {
    // Roll back the orphaned Storage object — the DB inserts already
    // auto-rolled back inside the function.
    const { error: removeErr } = await supabaseAdmin.storage
      .from("medic-documents")
      .remove([storagePath]);
    if (removeErr) {
      console.error(
        "[ops/medics/settle] CRITICAL: settle failed AND storage rollback failed — orphaned object",
        storagePath,
        removeErr,
      );
    }
    const detail = e instanceof Error ? e.message : "settle_failed";
    console.error("[ops/medics/settle] settle failed; storage rolled back", detail);
    return NextResponse.json(
      { error: "settle_failed", detail },
      { status: 500 },
    );
  }
}
