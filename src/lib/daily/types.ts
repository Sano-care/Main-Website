// Typed responses for the subset of the Daily.co REST API that C2-V calls.
// Full API surface is large — narrow to what Sanocare actually reads.
// Extend here rather than casting loose JSON at call sites.

/** Subset of POST /rooms and GET /rooms/{name}. */
export interface DailyRoom {
  /** Internal Daily id. We don't persist this. */
  id?: string;
  /** Room name — the stable identifier we DO persist on doctors.duty_room_provider_ref. */
  name: string;
  /** Full join URL, e.g. "https://sanocare.daily.co/sano-d-00001-duty-room". Stored on doctors.duty_room_join_url. */
  url: string;
  /** "private" requires a meeting token. C2-V always uses private. */
  privacy: "public" | "private";
  /** Subset of the config block we read. Daily returns much more. */
  config?: {
    enable_knocking?: boolean;
    enable_chat?: boolean;
    enable_screenshare?: boolean;
    start_audio_off?: boolean;
    start_video_off?: boolean;
    lang?: string;
  };
  created_at?: string;
  api_created?: boolean;
}

/** POST /meeting-tokens response. */
export interface DailyMeetingToken {
  /** The signed token string. Client passes this to DailyIframe.join({ token }). */
  token: string;
}

/** Properties block we send when minting a meeting token. */
export interface DailyMeetingTokenProperties {
  /** The room the token grants access to. */
  room_name: string;
  /** true for doctor (admit/deny power, screen share), false for patient (knocks, no screen share). */
  is_owner: boolean;
  /** Unix seconds. Patient: 90 min; doctor: 8h. */
  exp: number;
  /** Optional display name in the participant list. */
  user_name?: string;
  /** Patient: false (lock screen share); doctor: true. */
  enable_screenshare?: boolean;
  /** Patient: true (start muted in medical context); doctor: false. */
  start_audio_off?: boolean;
}
