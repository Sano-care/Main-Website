import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateConsultJoinToken,
  defaultJoinTokenExpiry,
} from "@/lib/consult/tokens";

// PB4a — shared teleconsult session-creation. Extracted from the ops
// createBooking action (src/app/ops/(shell)/bookings/actions.ts) so the ops
// path AND the native/bearer path (POST /api/pulse/teleconsult/verify) create
// the consultation_sessions + consultation_participants rows the exact same
// way — reuse, don't fork.
//
// Inserts:
//   - consultation_sessions (modality='teleconsultation', status='scheduled',
//     snapshotting the doctor's Duty Room URL at create time — may be NULL; the
//     /c/[token] page surfaces a graceful fallback).
//   - consultation_participants (role='patient', with a freshly minted 32-hex
//     join token + expiry). The token is what the /c/<token> WhatsApp link
//     resolves against.
//
// It deliberately does NOT deliver the join-link WhatsApp — callers decide when.
// The ops path sends it immediately; the native path defers to the cron sender
// (PR-B) which fires ~10 min before the slot.
//
// `createdBy` is the ops user id on the ops path, or NULL on the native path
// (consultation_sessions.created_by is nullable — verified against live schema).

export interface CreateTeleconsultSessionInput {
  bookingId: string;
  doctorId: string;
  /** Doctor's Duty Room join URL, snapshotted onto the session. May be null. */
  dutyRoomUrl: string | null;
  /** ISO timestamp for the scheduled consult (session.scheduled_at, NOT NULL). */
  scheduledAtIso: string;
  /** Patient customer id for the participant row. May be null (booking-only). */
  customerId: string | null;
  /** Ops user id on the ops path; null on the native/bearer path. */
  createdBy: string | null;
}

export interface CreateTeleconsultSessionResult {
  sessionId: string;
  joinToken: string;
  joinTokenExpiresAt: string;
}

/**
 * Create the consultation session + patient participant (with join token) for a
 * teleconsultation booking. Throws on either insert failure so the caller can
 * surface a "booking created but session failed — clean up" error (the FK from
 * sessions → bookings means a bare booking without a session is recoverable).
 */
export async function createTeleconsultSession(
  supabase: SupabaseClient,
  input: CreateTeleconsultSessionInput,
): Promise<CreateTeleconsultSessionResult> {
  const { data: session, error: sessionErr } = await supabase
    .from("consultation_sessions")
    .insert({
      booking_id: input.bookingId,
      doctor_id: input.doctorId,
      modality: "teleconsultation",
      status: "scheduled",
      duty_room_url_snapshot: input.dutyRoomUrl,
      scheduled_at: input.scheduledAtIso,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (sessionErr || !session) {
    throw new Error(
      `consultation_sessions insert failed for booking ${input.bookingId}: ${sessionErr?.message ?? "unknown"}`,
    );
  }

  const joinToken = generateConsultJoinToken();
  const tokenExpiry = defaultJoinTokenExpiry(input.scheduledAtIso);

  const { error: partErr } = await supabase
    .from("consultation_participants")
    .insert({
      session_id: session.id,
      role: "patient",
      customer_id: input.customerId,
      join_token: joinToken,
      join_token_expires_at: tokenExpiry.toISOString(),
    });

  if (partErr) {
    throw new Error(
      `consultation_participants insert failed for session ${session.id}: ${partErr.message}`,
    );
  }

  return {
    sessionId: session.id as string,
    joinToken,
    joinTokenExpiresAt: tokenExpiry.toISOString(),
  };
}
