import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsAdminApi } from "@/app/ops/_lib/requireOpsAdmin";

export const runtime = "nodejs";

// T65 Phase 2B C4 — POST /api/ops/medics/[id]/docs
//
// Multipart upload for medic PII + payout proof docs. Admin-only via
// requireOpsAdminApi. Validates MIME whitelist + 10 MB cap server-side
// (the medic_documents CHECK constraint + bucket policy enforce too —
// defence in depth).
//
// Storage path convention: {medic_id}/{doc_type}/{uuid}-{original_filename}.
// Filename sanitization strips control chars + restricts to a safe charset
// before persisting (the path becomes part of a signed URL later).
//
// On success: INSERTs medic_documents row + returns the new doc id.

const VALID_DOC_TYPES = new Set([
  "gnm_cert",
  "bsc_cert",
  "registration_card",
  "aadhar",
  "pan",
  "photo",
  "address_proof",
  "offer_letter",
  "payout_proof",
  "other",
]);

const VALID_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeFilename(name: string): string {
  // Allow alphanumeric + dot + dash + underscore; collapse anything else
  // to a single dash. Cap at 80 chars.
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

  // Verify medic exists (avoids orphan Storage objects).
  const { data: medic, error: medicErr } = await supabaseAdmin
    .from("medics")
    .select("id")
    .eq("id", medicId)
    .maybeSingle();
  if (medicErr) {
    console.error("[ops/medics/docs] medic lookup failed", medicErr);
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

  const file = formData.get("file");
  const docType = String(formData.get("doc_type") ?? "");
  const labelRaw = formData.get("label");
  const label =
    typeof labelRaw === "string" && labelRaw.trim().length > 0
      ? labelRaw.trim().slice(0, 120)
      : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (!VALID_DOC_TYPES.has(docType)) {
    return NextResponse.json({ error: "invalid_doc_type" }, { status: 400 });
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

  const filename = sanitizeFilename(file.name || "file");
  const objectId = crypto.randomUUID();
  const storagePath = `${medicId}/${docType}/${objectId}-${filename}`;

  // Upload to Storage. upsert:false so a colliding objectId (extremely
  // unlikely with UUIDv4) doesn't silently overwrite.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadErr } = await supabaseAdmin.storage
    .from("medic-documents")
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadErr) {
    console.error("[ops/medics/docs] storage upload failed", uploadErr);
    return NextResponse.json(
      { error: "storage_upload_failed", detail: uploadErr.message },
      { status: 500 },
    );
  }

  // INSERT row. If this fails, remove the orphaned Storage object so we
  // don't accumulate dead bytes.
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("medic_documents")
    .insert({
      medic_id: medicId,
      doc_type: docType,
      file_path: storagePath,
      file_size_bytes: file.size,
      mime_type: file.type,
      label,
      uploaded_by: adminGate.id,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    console.error("[ops/medics/docs] insert failed; rolling back storage", insertErr);
    await supabaseAdmin.storage.from("medic-documents").remove([storagePath]);
    return NextResponse.json(
      { error: "insert_failed", detail: insertErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { doc_id: inserted.id, file_path: storagePath },
    { status: 201 },
  );
}
