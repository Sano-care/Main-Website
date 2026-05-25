// Daily.co REST client. The entire C2-V API surface against Daily
// lives in this file: two POSTs, one GET for the idempotency
// fallback.
//
// Public functions:
//   createDutyRoom({ name, doctorDisplayName })  → POST /rooms
//   getRoomByName(name)                          → GET  /rooms/{name}
//   provisionDutyRoom({ name, doctorDisplayName }) — idempotent wrapper:
//     tries createDutyRoom; on "already exists" falls back to
//     getRoomByName so re-clicking the ops "Provision" button is safe.
//   mintMeetingToken(props)                      → POST /meeting-tokens
//
// All take an opaque room_name. Sanocare's convention (set by the ops
// action that calls this): "sano-d-NNNNN-duty-room" derived from
// doctor_code, lowercased, hyphenated. Stable per-doctor.

import { dailyFetch, DailyApiError, isDailyRoomAlreadyExists } from "./auth";
import type {
  DailyRoom,
  DailyMeetingToken,
  DailyMeetingTokenProperties,
} from "./types";

/**
 * Create the per-doctor persistent Duty Room.
 *
 * Properties (founder-decided / NMC-aligned):
 *   privacy:           "private"  — requires a meeting token to enter
 *   enable_knocking:   true       — doctor admits each patient
 *   enable_chat:       true       — useful for spelling drug names
 *   enable_screenshare: true      — doctor can share reports
 *   start_audio_off:   true       — patient starts muted (medical hot-mic
 *                                    is the wrong default)
 *   start_video_off:   false      — patient camera on by default
 *   lang:              "en"
 *
 * Returns the full room object including the `url` (persisted on
 * doctors.duty_room_join_url) and `name` (persisted on
 * doctors.duty_room_provider_ref).
 *
 * If a room with this name already exists, Daily returns HTTP 400
 * with `info` containing "already exists". This call propagates that
 * as a DailyApiError; use provisionDutyRoom() for the idempotent
 * wrapper that catches it.
 */
export async function createDutyRoom(input: {
  name: string;
}): Promise<DailyRoom> {
  return dailyFetch<DailyRoom>({
    method: "POST",
    path: "/rooms",
    body: {
      name: input.name,
      privacy: "private",
      properties: {
        enable_knocking: true,
        enable_chat: true,
        enable_screenshare: true,
        start_audio_off: true,
        start_video_off: false,
        lang: "en",
      },
    },
  });
}

/**
 * Fetch a single room by name. Used as the idempotency fallback in
 * provisionDutyRoom() and by ops if they want to verify configuration.
 *
 * Returns the room object. Throws DailyApiError(404) if the room
 * doesn't exist; use isDailyNotFound() to distinguish.
 */
export async function getRoomByName(name: string): Promise<DailyRoom> {
  return dailyFetch<DailyRoom>({
    method: "GET",
    path: `/rooms/${encodeURIComponent(name)}`,
  });
}

/**
 * Idempotent room provisioning. Used by the ops "Provision Duty Room"
 * action. First call creates the room; subsequent calls return the
 * existing room. Re-clicking the button after a successful create
 * doesn't error — it returns the same room.
 *
 * Catches the specific "already exists" error from createDutyRoom()
 * and falls back to getRoomByName(). Any other error propagates.
 */
export async function provisionDutyRoom(input: {
  name: string;
}): Promise<DailyRoom> {
  try {
    return await createDutyRoom(input);
  } catch (err) {
    if (isDailyRoomAlreadyExists(err)) {
      return await getRoomByName(input.name);
    }
    throw err;
  }
}

/**
 * Mint a short-lived meeting token. The token IS the auth — the
 * patient or doctor passes it to DailyIframe.join({ token }) and
 * Daily validates it server-side on connect.
 *
 * TTL discipline (C2-V Step 0 review):
 *   Patient (is_owner=false): 90 minutes — covers a 15-min consult
 *     plus knock-wait and slack against the doctor running late.
 *     Earlier draft was 30 min; raised to 90 after review.
 *   Doctor  (is_owner=true):  8 hours — matches the doctor portal
 *     session TTL from C1; one token for a working shift.
 *
 * The function does NOT decide TTL — the caller passes `exp` directly
 * (computed from Date.now()). Centralising TTL in the API routes
 * keeps the policy reading where the decision is made.
 */
export async function mintMeetingToken(
  properties: DailyMeetingTokenProperties,
): Promise<DailyMeetingToken> {
  return dailyFetch<DailyMeetingToken>({
    method: "POST",
    path: "/meeting-tokens",
    body: { properties },
  });
}

// Re-export commonly-needed error helpers for caller convenience.
export { DailyApiError, isDailyRoomAlreadyExists };
export { isDailyNotFound } from "./auth";
