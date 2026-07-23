import "server-only";

import { createClient } from "@supabase/supabase-js";

import { sendConsultJoinLink } from "@/lib/consult/meta";

// PB4a — the ~10-min-before teleconsult join-link sweep. Selects scheduled
// teleconsult sessions whose slot is imminent and whose join link hasn't been
// sent, then delivers the /c/<token> WhatsApp (sanocare_consult_join) and stamps
// consultation_sessions.join_link_sent_at.
//
// Idempotency (claim-then-send): each candidate is claimed by an atomic
// `UPDATE … SET join_link_sent_at = now() WHERE id = ? AND join_link_sent_at IS
// NULL` — only the winner proceeds, so overlapping ticks can't double-send. If
// the send then throws, the claim is reverted (join_link_sent_at → NULL) so a
// later tick retries. Sends NOTHING unless WHATSAPP_CONSULT_ENABLED === "true".

export interface JoinLinkSweepResult {
  enabled: boolean;
  scanned: number;
  sent: number;
  failed: number;
}

// Window: send from ~15 min before the slot up to a 2-min grace after, so a
// */5 cron always catches an imminent consult at least once, ~10 min prior.
const WINDOW_AHEAD_MS = 15 * 60 * 1000;
const WINDOW_GRACE_MS = 2 * 60 * 1000;

export async function runConsultJoinSweep(): Promise<JoinLinkSweepResult> {
  if (process.env.WHATSAPP_CONSULT_ENABLED !== "true") {
    return { enabled: false, scanned: 0, sent: 0, failed: 0 };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server credentials missing");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const now = Date.now();
  const windowStart = new Date(now - WINDOW_GRACE_MS).toISOString();
  const windowEnd = new Date(now + WINDOW_AHEAD_MS).toISOString();

  const { data: sessions, error } = await supabase
    .from("consultation_sessions")
    .select("id, booking_id, doctor_id, scheduled_at")
    .eq("modality", "teleconsultation")
    .eq("status", "scheduled")
    .is("join_link_sent_at", null)
    .gte("scheduled_at", windowStart)
    .lte("scheduled_at", windowEnd);
  if (error) {
    throw new Error(`consult-join sweep query failed: ${error.message}`);
  }

  let sent = 0;
  let failed = 0;

  for (const s of sessions ?? []) {
    const sessionId = s.id as string;

    // Claim atomically — only the row that flips NULL → now() proceeds.
    const claim = await supabase
      .from("consultation_sessions")
      .update({ join_link_sent_at: new Date().toISOString() })
      .eq("id", sessionId)
      .is("join_link_sent_at", null)
      .select("id");
    if (claim.error || !claim.data || claim.data.length === 0) continue;

    const [participantRes, bookingRes, doctorRes] = await Promise.all([
      supabase
        .from("consultation_participants")
        .select("join_token")
        .eq("session_id", sessionId)
        .eq("role", "patient")
        .maybeSingle(),
      supabase
        .from("bookings")
        .select("phone, patient_name")
        .eq("id", s.booking_id as string)
        .maybeSingle(),
      supabase
        .from("doctors")
        .select("full_name")
        .eq("id", s.doctor_id as string)
        .maybeSingle(),
    ]);

    const joinToken = participantRes.data?.join_token as string | undefined;
    const phone = bookingRes.data?.phone as string | undefined;

    if (!joinToken || !phone) {
      // Can't deliver — revert the claim so a later tick retries once data lands.
      await supabase
        .from("consultation_sessions")
        .update({ join_link_sent_at: null })
        .eq("id", sessionId);
      console.error(`[consult-join] session ${sessionId} missing token/phone — skipped`);
      failed++;
      continue;
    }

    try {
      await sendConsultJoinLink({
        phone,
        joinToken,
        patientName: (bookingRes.data?.patient_name as string | null) ?? "there",
        doctorName: (doctorRes.data?.full_name as string | null) ?? "your doctor",
      });
      sent++;
    } catch (e) {
      await supabase
        .from("consultation_sessions")
        .update({ join_link_sent_at: null })
        .eq("id", sessionId);
      console.error(`[consult-join] send failed for session ${sessionId} — un-claimed for retry`, e);
      failed++;
    }
  }

  return { enabled: true, scanned: sessions?.length ?? 0, sent, failed };
}
