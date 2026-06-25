// Aarogya Medic Help-Mode Part 2 — on-duty selfie consumer.
//
// A medic's inbound image is their on-duty selfie. It's the gate for the daily
// wage: setting medic_attendance.selfie_verified_at on TODAY's row flips the
// post_medic_earnings_on_attendance trigger's condition (salaried + present +
// selfie-verified) so the wage posts. This consumer ONLY sets that one column —
// the trigger owns the wage (idempotent per attendance_id, auto-reverses on
// change). Part 1 (#84) was persona + text tools; this closes the media seam.
//
// Properties (mirror the patient media consumer): never throws, storage-light,
// phone-free audit. The selfie image is persisted best-effort to the PRIVATE
// ops-media bucket with a 72h purge class (recorded in media_assets for the
// purge module) — persistence failure NEVER blocks the attendance reply.

import { fetchInboundMedia, mediaRefFromRaw } from "@/lib/whatsapp/media";
import { storeMedia } from "@/lib/whatsapp/mediaStore";
import { supabaseAdmin } from "@/lib/supabase-server";
import { log } from "@/lib/whatsapp/log";
import { AuditEvent, type AuditEventType } from "@/lib/whatsapp/safety/audit";
import type { Identity } from "@/lib/whatsapp/identity";

const SELFIE_BUCKET = "ops-media"; // private (public=false); first media_assets writer
const SELFIE_RETENTION_HOURS = 72;
const SUPPORT_LINE = "+91 97119 77782";

export interface SelfieAuditLine {
  event: AuditEventType;
  data: Record<string, unknown>;
}

export interface MedicSelfieResult {
  reply: string;
  audits: SelfieAuditLine[];
}

export interface MedicSelfieDeps {
  fetchMedia?: typeof fetchInboundMedia;
  store?: typeof storeMedia;
  supabase?: typeof supabaseAdmin;
  now?: () => number;
}

/**
 * Today's date in IST (UTC+05:30, no DST), YYYY-MM-DD. MUST match the clock-in
 * route's workDateIST() (src/app/api/medic-app/attendance/route.ts) or the lookup
 * won't find today's row.
 */
export function workDateIST(nowMs: number = Date.now()): string {
  return new Date(nowMs + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Best-effort persist of the selfie to the private bucket. NEVER throws. */
async function persistSelfie(p: {
  raw: unknown;
  medicId: string;
  nowMs: number;
  fetchMedia: typeof fetchInboundMedia;
  store: typeof storeMedia;
}): Promise<void> {
  try {
    const ref = mediaRefFromRaw(p.raw);
    if (!ref) return;
    const media = await p.fetchMedia(ref.mediaId);
    if (!media.ok) {
      log.info("medic selfie: media fetch not ok — not persisting", media.reason);
      return;
    }
    const ext = media.mimeType.includes("png") ? "png" : "jpg";
    const path = `medic-selfies/${p.medicId}/${workDateIST(p.nowMs)}/${ref.mediaId}.${ext}`;
    const res = await p.store({
      bucket: SELFIE_BUCKET,
      path,
      bytes: media.bytes,
      mimeType: media.mimeType,
      mediaId: ref.mediaId,
      ownerId: p.medicId,
      purgeAfter: new Date(p.nowMs + SELFIE_RETENTION_HOURS * 60 * 60 * 1000),
    });
    if (!res.ok) log.error("medic selfie: storeMedia failed", res.error ?? "");
  } catch (err) {
    // Storage is incidental to attendance — swallow everything.
    log.error("medic selfie: persist threw (swallowed)", err);
  }
}

export async function runMedicSelfieTurn(
  args: { raw: unknown; identity: Identity },
  deps: MedicSelfieDeps = {},
): Promise<MedicSelfieResult> {
  // Defense-in-depth role gate (mirror medicExecutors): only a medic reaches the
  // attendance write, regardless of how dispatch routed here.
  if (args.identity.role !== "medic") {
    return { reply: "Thanks! Send me a message and I'll help.", audits: [] };
  }

  const medicId = args.identity.medicId;
  const fetchMedia = deps.fetchMedia ?? fetchInboundMedia;
  const store = deps.store ?? storeMedia;
  const supabase = deps.supabase ?? supabaseAdmin;
  const nowMs = (deps.now ?? Date.now)();
  const today = workDateIST(nowMs);

  // Look up today's attendance row first (UNIQUE(medic_id, work_date) → ≤ 1).
  const { data: row, error } = await supabase
    .from("medic_attendance")
    .select("id, selfie_verified_at")
    .eq("medic_id", medicId)
    .eq("work_date", today)
    .maybeSingle();

  // Persist the selfie regardless of attendance outcome (best-effort, never throws).
  await persistSelfie({ raw: args.raw, medicId, nowMs, fetchMedia, store });

  if (error) {
    log.error("medic selfie: attendance lookup failed", error.message);
    return {
      reply: `I couldn't check your attendance just now — please try again in a moment, or call ${SUPPORT_LINE}.`,
      audits: [],
    };
  }

  // Case 4 — no clock-in for today. Do NOT set the flag.
  if (!row) {
    return {
      reply:
        "I don't see a clock-in for today — please clock in on the app first, then send your selfie. 🙏",
      audits: [{ event: AuditEvent.MEDIC_SELFIE_NO_CLOCKIN, data: { work_date: today } }],
    };
  }

  // Case 3 — already verified. Idempotent: no write, no second wage post.
  if (row.selfie_verified_at) {
    return { reply: "You're already marked present for today ✅", audits: [] };
  }

  // Case 2 — unverified → set the gate. Scoped to this row, only-if-still-null so
  // a concurrent set can't double-fire the trigger. The trigger posts the wage.
  const verifiedAt = new Date(nowMs).toISOString();
  const { error: upErr } = await supabase
    .from("medic_attendance")
    .update({ selfie_verified_at: verifiedAt })
    .eq("id", row.id)
    .is("selfie_verified_at", null);
  if (upErr) {
    log.error("medic selfie: verify update failed", upErr.message);
    return {
      reply: `I got your selfie but couldn't mark attendance just now — please try again, or call ${SUPPORT_LINE}.`,
      audits: [],
    };
  }

  return {
    reply: "Selfie received — attendance confirmed for today ✅",
    audits: [
      {
        event: AuditEvent.MEDIC_SELFIE_VERIFIED,
        data: { attendance_id: row.id, work_date: today },
      },
    ],
  };
}
