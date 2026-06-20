// Slice 3 (T66) — Aarogya event notification dispatcher.
//
// Sidecar to adapter.ts / route handlers (same pattern Slice 4a established
// with slice4aExecutors.ts). Owns the per-event decision: send a free-form
// message, send an approved template, or skip silently. Called from two
// places:
//
//   1. /api/medic-app/event/route.ts — for events emitted by the medic
//      Android app: departed / reached / visit_started / visit_done /
//      patient_no_show.
//   2. ops `assignMedic()` server action — for medic_assigned. (That one
//      is NOT recorded in medic_event_log; it's a server-emitted trigger
//      reusing the same notification dispatcher.)
//
// Decision matrix (locked, see brief):
//
//   event              path                  template (if any)         outside-window
//   --------------     -------------------   -----------------------   --------------
//   medic_assigned     free-form             —                         (always open;
//                                                                       patient just
//                                                                       booked)
//   departed           template              aarogya_medic_departed    re-opens window
//   reached            free-form             —                         skip silently
//   visit_started      free-form             —                         skip silently
//   visit_done         free-form +           —                         skip silently
//                      review nudge                                     (side effects
//                                                                       happen in route)
//   patient_no_show    template              aarogya_medic_at_door     queue-marker
//                                                                       written by route
//
// All sends route through dispatchTemplateMessage / dispatchTextMessage, so
// the opt-out gate + Slice 2b hardening (retry, idempotency, audit) apply
// uniformly.

import {
  dispatchTemplateMessage,
  dispatchTextMessage,
  findOrCreateConversation,
  type DispatchResult,
} from "@/lib/whatsapp/db";
import { isWithinSessionWindow } from "@/lib/whatsapp/session";
import { AuditEvent, writeAudit } from "@/lib/whatsapp/safety/audit";
import { log } from "@/lib/whatsapp/log";

/** Subset of bookings row Slice 3 needs. Wider columns are fetched by the
 *  caller — kept narrow here so swapping data sources is one type change. */
export interface SliceThreeBooking {
  id: string;
  phone: string;
  patient_name: string | null;
  status: string | null;
}

/** Subset of medics row Slice 3 needs. */
export interface SliceThreeMedic {
  id: string;
  full_name: string | null;
  phone: string;
}

export type SliceThreeEvent =
  | "medic_assigned"
  | "departed"
  | "reached"
  | "visit_started"
  | "visit_done"
  | "patient_no_show";

export interface DispatchEventInput {
  event: SliceThreeEvent;
  booking: SliceThreeBooking;
  medic: SliceThreeMedic;
  /** Optional injectable clock (ms) for window-check tests. */
  nowMs?: number;
}

/** Skip-with-audit shape — surfaced into the route handler so it can write
 *  the right per-skip audit row alongside its own medic_event_* audit. */
export type SkipReason =
  | "opted_out"
  | "outside_window_no_template"
  | "no_change_required";

export type DispatchEventResult =
  | DispatchResult
  | { sent: false; blocked: false; skipped: true; reason: SkipReason };

const VISIT_DONE_REVIEW_PLACEHOLDER =
  "https://g.page/r/__PLACEHOLDER__/review";

/**
 * Extract the medic's first name (for templating). Falls back to a generic
 * label so a missing/blank full_name never empties the {{1}} slot and trips
 * the renderTemplate guard.
 */
function firstNameOf(medic: SliceThreeMedic): string {
  const tokens = (medic.full_name ?? "").trim().split(/\s+/).filter(Boolean);
  return tokens[0] ?? "Your Sanocare medic";
}

/**
 * Compose the free-form copy per event. Pure — no IO, deterministic.
 * Patient name (when present) gets a personal touch; review nudge appends
 * only on visit_done AND only when the env URL is set.
 */
function composeFreeformBody(
  event: SliceThreeEvent,
  booking: SliceThreeBooking,
  medic: SliceThreeMedic,
  reviewUrl: string | null,
): string {
  const medicFirst = firstNameOf(medic);
  switch (event) {
    case "medic_assigned":
      return `Good news — ${medicFirst} is your Sanocare medic and is preparing to head out. We'll let you know once they leave.`;
    case "reached":
      return `${medicFirst} has reached your location and will begin shortly. 🌿`;
    case "visit_started":
      return `Visit in progress with ${medicFirst}. We'll check back once it wraps up.`;
    case "visit_done": {
      const base = `Visit complete — hope that went well! 🌿`;
      if (reviewUrl) {
        return `${base} If we earned it, would you mind sharing a quick Google review? ${reviewUrl}`;
      }
      // Without the URL configured, drop the ask cleanly — never send a
      // broken / placeholder link to a patient.
      return base;
    }
    // The next two are template-only paths; we still have a switch arm so
    // TypeScript exhaustiveness catches a future enum addition.
    case "departed":
    case "patient_no_show":
      return base("unreachable_in_freeform");
  }
}

function base(reason: string): string {
  return `(internal: ${reason})`;
}

/** Read the Google review URL once per dispatch — env can change without a
 *  restart at the cron edge, but per-call read is cheap and always honest. */
function getReviewUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL?.trim();
  if (!raw) return null;
  // Guard against the placeholder string accidentally landing in prod env.
  if (raw === VISIT_DONE_REVIEW_PLACEHOLDER) {
    log.warn(
      "NEXT_PUBLIC_GOOGLE_REVIEW_URL is still the placeholder — review nudge skipped",
    );
    return null;
  }
  return raw;
}

/**
 * Main entry. Resolves the patient conversation, gates on opt-out, applies
 * the per-event decision matrix, and dispatches via the right chokepoint.
 * Never throws — all failures resolve to a DispatchResult so the route
 * handler / ops action can log + respond to its caller without coupling.
 */
export async function dispatchEventNotification(
  input: DispatchEventInput,
): Promise<DispatchEventResult> {
  const { event, booking, medic } = input;
  const nowMs = input.nowMs ?? Date.now();

  // Ensure the patient has a conversation row (created if first contact —
  // they need an opt-out path + audit trail anyway).
  let conversationId: string;
  let isNewConversation: boolean;
  try {
    const r = await findOrCreateConversation(booking.phone);
    conversationId = r.conversation.id;
    isNewConversation = r.isNew;
    // Quick opt-out short-circuit using the conversation row we already
    // fetched. The chokepoints re-read opt_out before sending anyway —
    // this is purely so we audit `skipped_optout` rather than burn a
    // template send budget. Slice 2b's per-send re-read remains
    // authoritative.
    if (r.conversation.opt_out === true) {
      await writeAudit({
        conversationId,
        eventType: AuditEvent.MEDIC_EVENT_NOTIFICATION_SKIPPED_OPTOUT,
        eventData: { booking_id: booking.id, medic_id: medic.id, event },
      });
      return { sent: false, blocked: false, skipped: true, reason: "opted_out" };
    }
  } catch (err) {
    // findOrCreateConversation failure leaves Slice 3 with no conversation
    // to send into. Surface a generic dispatch failure — the route handler
    // will write medic_event_notification_failed.
    log.error("findOrCreateConversation failed in Slice 3 dispatcher", err);
    return { sent: false, blocked: false, error: "conversation_lookup_failed" };
  }
  void isNewConversation; // currently unused; reserved for future telemetry

  const safetyFlags = { slice3_event: event };

  // Template events: send the approved template. Templates re-open / sit
  // outside the 24h window — no session check.
  if (event === "departed") {
    return dispatchTemplateMessage({
      conversationId,
      phone: booking.phone,
      templateName: "aarogya_medic_departed",
      vars: { medic_first_name: firstNameOf(medic) },
      safetyFlags,
    });
  }
  if (event === "patient_no_show") {
    return dispatchTemplateMessage({
      conversationId,
      phone: booking.phone,
      templateName: "aarogya_medic_at_door",
      vars: {
        medic_first_name: firstNameOf(medic),
        medic_phone: medic.phone,
      },
      safetyFlags,
    });
  }

  // Free-form events: need the 24h window. medic_assigned is the one
  // exception — patient just placed a booking, so we're well inside the
  // window (or the very first contact, which findOrCreateConversation +
  // dispatchTextMessage handles).
  let windowOpen = true;
  if (event !== "medic_assigned") {
    try {
      windowOpen = await isWithinSessionWindow(conversationId, nowMs);
    } catch (err) {
      log.error("session window check failed in Slice 3 dispatcher", err);
      windowOpen = false;
    }
  }

  if (!windowOpen) {
    await writeAudit({
      conversationId,
      eventType: AuditEvent.MEDIC_EVENT_NOTIFICATION_SKIPPED_WINDOW,
      eventData: { booking_id: booking.id, medic_id: medic.id, event },
    });
    return {
      sent: false,
      blocked: false,
      skipped: true,
      reason: "outside_window_no_template",
    };
  }

  const reviewUrl = event === "visit_done" ? getReviewUrl() : null;
  const body = composeFreeformBody(event, booking, medic, reviewUrl);

  return dispatchTextMessage({
    conversationId,
    phone: booking.phone,
    body,
    safetyFlags: {
      ...safetyFlags,
      ...(reviewUrl ? { review_nudge_appended: true } : {}),
    },
  });
}

/** Minimal supabase-like shape the assignMedic hook uses. Kept here so the
 *  helper is unit-testable without an RSC-client mock. */
export interface AssignNotifyClient {
  from(table: string): {
    select(fields: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{
          data: Record<string, unknown> | null;
          error: unknown;
        }>;
      };
    };
  };
}

/**
 * Helper for the `assignMedic()` server action — fetches booking + medic
 * via the caller's supabase client and dispatches a `medic_assigned`
 * notification. Never throws. The caller (ops action) uses this so its
 * own concerns (auth, revalidation) stay surgical.
 */
export async function notifyOnMedicAssigned(
  supabase: AssignNotifyClient,
  bookingId: string,
  medicId: string,
): Promise<DispatchEventResult | { sent: false; blocked: false; error: string }> {
  try {
    const { data: bookingForDispatch } = await supabase
      .from("bookings")
      .select("id, phone, patient_name, status")
      .eq("id", bookingId)
      .maybeSingle();
    const { data: medicForDispatch } = await supabase
      .from("medics")
      .select("id, full_name, phone")
      .eq("id", medicId)
      .maybeSingle();
    if (!bookingForDispatch || !medicForDispatch) {
      return { sent: false, blocked: false, error: "booking_or_medic_lookup_failed" };
    }
    return await dispatchEventNotification({
      event: "medic_assigned",
      booking: {
        id: bookingForDispatch.id as string,
        phone: bookingForDispatch.phone as string,
        patient_name: (bookingForDispatch.patient_name as string | null) ?? null,
        status: (bookingForDispatch.status as string | null) ?? null,
      },
      medic: {
        id: medicForDispatch.id as string,
        full_name: (medicForDispatch.full_name as string | null) ?? null,
        phone: medicForDispatch.phone as string,
      },
    });
  } catch (e) {
    log.error("notifyOnMedicAssigned failed", e);
    return { sent: false, blocked: false, error: "notify_threw" };
  }
}
