import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOpsAdminApi } from "@/app/ops/_lib/requireOpsAdmin";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";

// T65 Phase 2B C4 — DELETE /api/ops/medics/[id]/docs/[docId]
//
// Soft delete only. Sets deleted_at + deleted_by; Storage object stays
// (a separate cron will purge N days later — out of v0 scope). The
// medic_documents.deleted_at IS NULL index in M055 means the docs tab
// query naturally filters these out without explicit WHERE clauses.
//
// Idempotent: re-deleting an already-soft-deleted doc returns 200 with
// the existing deleted_at (rather than 404 / 409 churn).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const adminGate = await requireOpsAdminApi();
  if (adminGate instanceof NextResponse) return adminGate;

  const { id: medicId, docId } = await params;
  if (!UUID_RE.test(medicId) || !UUID_RE.test(docId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const { data: doc, error: docErr } = await supabaseAdmin
    .from("medic_documents")
    .select("id, medic_id, deleted_at")
    .eq("id", docId)
    .maybeSingle();
  if (docErr) {
    console.error("[ops/medics/docs/delete] lookup failed", docErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ error: "doc_not_found" }, { status: 404 });
  }
  if (doc.medic_id !== medicId) {
    return NextResponse.json({ error: "doc_medic_mismatch" }, { status: 400 });
  }
  if (doc.deleted_at) {
    return NextResponse.json({ ok: true, deleted_at: doc.deleted_at });
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabaseAdmin
    .from("medic_documents")
    .update({ deleted_at: now, deleted_by: adminGate.id })
    .eq("id", docId);
  if (updateErr) {
    console.error("[ops/medics/docs/delete] soft-delete failed", updateErr);
    return NextResponse.json(
      { error: "delete_failed", detail: updateErr.message },
      { status: 500 },
    );
  }

  revalidatePath(`/ops/medics/${medicId}`);
  return NextResponse.json({ ok: true, deleted_at: now });
}
