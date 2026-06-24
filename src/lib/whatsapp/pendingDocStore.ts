// Patient photo & PDF — owner/member load + the pending-save store.
//
// No migration: the "doc awaiting save confirmation" record lives in audit_log
// (mirrors the relay-draft pattern). A media turn writes a patient_photo_received
// row carrying the pending payload; the next text turn reads the open pending and
// resolves it. "Open" = newest pending in the last 30 min with no later
// patient_photo_filed / declined for the same media_id.

import { supabaseAdmin } from "@/lib/supabase-server";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { log } from "@/lib/whatsapp/log";
import type { OwnerInfo, MemberInfo } from "@/lib/whatsapp/patientMedia";
import type { PendingDoc } from "@/lib/whatsapp/patientMediaConsumer";

type SupabaseLike = typeof supabaseAdmin;
const PENDING_WINDOW_MS = 30 * 60 * 1000;

export async function loadDocOwnerAndMembers(
  customerId: string,
  deps: { supabase?: SupabaseLike } = {},
): Promise<{ owner: OwnerInfo; members: MemberInfo[] }> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const [{ data: cust }, { data: fam }] = await Promise.all([
    supabase.from("customers").select("full_name").eq("id", customerId).maybeSingle(),
    supabase.from("family_members").select("id, name").eq("customer_id", customerId),
  ]);
  return {
    owner: { fullName: (cust as { full_name: string | null } | null)?.full_name ?? null },
    members: ((fam as Array<{ id: string; name: string }> | null) ?? []).map((m) => ({
      id: m.id,
      name: m.name,
    })),
  };
}

/** Stash a pending save in audit_log (carries the payload in event_data). */
export async function storePendingDocSave(
  conversationId: string,
  pending: PendingDoc,
  deps: { writeAuditFn?: typeof writeAudit } = {},
): Promise<void> {
  const writeAuditFn = deps.writeAuditFn ?? writeAudit;
  await writeAuditFn({
    conversationId,
    eventType: AuditEvent.PATIENT_PHOTO_RECEIVED,
    eventData: {
      category: pending.category,
      awaiting_save: true,
      pending: {
        media_id: pending.mediaId,
        mime: pending.mimeType,
        doc_type: pending.docType,
        customer_id: pending.customerId,
        name_match: pending.nameMatch ?? null, // non-blocking identity flag, carried to the file step
      },
    },
  });
}

/** The open pending save for this conversation, or null. */
export async function loadOpenPendingDocSave(
  conversationId: string,
  deps: { supabase?: SupabaseLike; now?: Date } = {},
): Promise<PendingDoc | null> {
  const supabase = deps.supabase ?? supabaseAdmin;
  const now = deps.now ?? new Date();
  const cutoff = new Date(now.getTime() - PENDING_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from("audit_log")
    .select("event_type, event_data, created_at")
    .eq("conversation_id", conversationId)
    .gt("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error || !data) {
    if (error) log.error("loadOpenPendingDocSave failed", error.message);
    return null;
  }

  const rows = data as Array<{ event_type: string; event_data: Record<string, unknown> | null }>;
  // Newest-first scan: a FILED / declined resolution seen before any open
  // pending means the latest pending is already resolved.
  for (const r of rows) {
    if (r.event_type === AuditEvent.PATIENT_PHOTO_FILED) return null;
    if (
      r.event_type === AuditEvent.PATIENT_PHOTO_REJECTED &&
      (r.event_data?.reason === "declined_by_patient")
    ) {
      return null;
    }
    if (r.event_type === AuditEvent.PATIENT_PHOTO_RECEIVED && r.event_data?.awaiting_save === true) {
      const p = r.event_data.pending as
        | { media_id?: string; mime?: string; doc_type?: string; customer_id?: string; name_match?: boolean | null }
        | undefined;
      if (p?.media_id && p.mime && p.doc_type && p.customer_id) {
        return {
          mediaId: p.media_id,
          mimeType: p.mime,
          category: p.doc_type,
          docType: p.doc_type,
          customerId: p.customer_id,
          nameMatch: p.name_match ?? null,
        };
      }
    }
  }
  return null;
}
