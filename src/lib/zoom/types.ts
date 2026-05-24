// Typed responses for the subset of the Zoom REST API that C2 calls.
// Fields are narrowed to what Sanocare actually uses — if a downstream
// caller needs more, extend here rather than each call site casting
// loose JSON. C3 will add a lot more (webhook payloads especially).

/** Subset of GET /users/{userId}. Full shape is documented at
 *  https://developers.zoom.us/api-hub/methods#operation/user */
export interface ZoomUser {
  id: string;                  // 22-char Zoom user id
  email: string;               // login email (matches doctors.email)
  first_name?: string;
  last_name?: string;
  display_name?: string;
  // PMI is returned as an integer in Zoom's response (10-12 digits).
  // We accept both number and string to be defensive.
  pmi: number | string;
  // The actual joinable URL for the PMI — includes the encrypted
  // password as a query string. This is what we copy into
  // doctors.duty_room_join_url.
  personal_meeting_url: string;
  // status: 'active' | 'inactive' | 'pending' — Sanocare only auto-fills
  // for active users.
  status: string;
  type: number; // 1=Basic, 2=Licensed, 3=On-Prem; we require >=2
}

/** Subset of GET /users/{userId}/settings. */
export interface ZoomUserSettings {
  in_meeting?: {
    // The PMI waiting-room toggle. Sanocare requires this to be true
    // for the doctor-controlled-entry NMC posture.
    waiting_room?: boolean;
  };
  schedule_meeting?: {
    // PMI password requirement — Sanocare recommends this be true.
    use_pmi_for_instant_meetings?: boolean;
    use_pmi_for_scheduled_meetings?: boolean;
  };
}
