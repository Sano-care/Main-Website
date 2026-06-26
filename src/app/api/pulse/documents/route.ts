import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { vaultDocumentBytes } from "@/lib/pulse/documentVault";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/pulse/documents — patient uploads a record (lab report, prescription,
// scan, discharge summary) from the Pulse web app into their private vault.
//
// Same session auth as every other /api/pulse route (requirePulseCustomer →
// service-role client, RLS-bypassing). The canonical writer is the shared
// vaultDocumentBytes core (no fork of the pulse_documents / bucket writes);
// this route just parses + validates the multipart upload, enforces the
// member IDOR guard, and writes the DPDP audit. Viewing reuses the existing
// /api/pulse/documents/[docId]/signed-url route (unchanged).

const VALID_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const VALID_DOC_TYPES = new Set([
  "lab_report",
  "prescription",
  "imaging",
  "discharge_summary",
  "other",
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches the bucket + CHECK cap.

export async function POST(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "That upload didn't come through. Try again." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Please choose a file to upload." }, { status: 400 });
  }
  if (!VALID_MIMES.has(file.type)) {
    return NextResponse.json(
      { error: "I can save photos (JPG, PNG or WEBP) or PDFs. That file type isn't one I can keep." },
      { status: 400 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "That file looks empty — try a different one." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is a little too large (max 10 MB). A clearer single-page photo usually works." },
      { status: 400 },
    );
  }

  const docTypeRaw = String(formData.get("doc_type") ?? "");
  const docType = VALID_DOC_TYPES.has(docTypeRaw) ? docTypeRaw : "other";

  const labelRaw = formData.get("label");
  const label =
    typeof labelRaw === "string" && labelRaw.trim().length > 0
      ? labelRaw.trim().slice(0, 120)
      : null;

  // member_id is optional. When present it MUST belong to THIS customer —
  // IDOR guard (a forged member id can't file a doc onto someone else's
  // member). "self"/"" → account holder (member_id null).
  const memberRaw = formData.get("member_id");
  let memberId: string | null = null;
  if (typeof memberRaw === "string" && memberRaw.trim().length > 0 && memberRaw !== "self") {
    const { data: member, error: memberErr } = await supabaseAdmin
      .from("family_members")
      .select("id")
      .eq("id", memberRaw)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (memberErr) {
      console.error("[pulse/documents] member lookup failed", memberErr);
      return NextResponse.json({ error: "Couldn't save that document. Please try again." }, { status: 500 });
    }
    if (!member) {
      return NextResponse.json(
        { error: "That family member isn't on your account." },
        { status: 400 },
      );
    }
    memberId = memberRaw;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const core = await vaultDocumentBytes({
    customerId: customer.id, // session customer — never trusted from input
    bytes,
    mimeType: file.type,
    docType,
    label,
    memberId,
    source: "pulse_upload",
  });

  if (!core.ok || !core.documentId) {
    // Validation already short-circuited above; here it's upload/insert
    // failure (the core rolled back any orphaned object).
    console.error("[pulse/documents] vault write failed:", core.reason);
    return NextResponse.json(
      { error: "Couldn't save that document. Please try again." },
      { status: 500 },
    );
  }

  // DPDP audit — ids/type/size only, never bytes or filename contents.
  await writeAudit({
    conversationId: null,
    eventType: AuditEvent.PULSE_VAULT_UPLOADED,
    identity: { role: "customer", identifiers: { customer_id: customer.id } },
    eventData: {
      document_id: core.documentId,
      doc_type: core.docType,
      mime: file.type,
      size_bytes: core.sizeBytes,
      member_scoped: Boolean(memberId),
      source: "pulse_upload",
    },
  });

  return NextResponse.json(
    {
      document: {
        id: core.documentId,
        doc_type: core.docType,
        label,
        file_size_bytes: core.sizeBytes,
        mime_type: file.type,
        member_id: memberId,
      },
    },
    { status: 201 },
  );
}
