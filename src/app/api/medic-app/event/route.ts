// T65 Phase 2 — POST /api/medic-app/event
//
// Records one of the 5 visit events (departed / reached / visit_started /
// visit_done / patient_no_show) for a booking the requesting medic owns.
// Append-only.
//
// Auth: requireMedic cookie. Ownership check: bookings.medic_id must equal
// the cookied medic_id.
//
// Idempotency: UNIQUE (booking_id, medic_id, event) at DB level (M052).
// On duplicate POST we return the existing event row with HTTP 200 (NOT
// 201) per founder spec — client treats both as success.
//
// Side effects (T66 — Aarogya Slice 3, this PR):
//   - audit_log medic_event_* trail at every branch
//   - bookings.status → 'COMPLETED' on visit_done
//   - no_show_escalation_queue insert on patient_no_show (M060 cron then
//     handles the 5-min ops escalation)
//   - dispatchEventNotification (slice3Dispatcher) sends the right
//     Aarogya WhatsApp per event. Notification failures NEVER block the
//     medic-app POST — the medic needs to know its event was recorded.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireMedic } from "@/lib/auth/requireMedic";
import { AuditEvent, type AuditEventType, writeAudit } from "@/lib/whatsapp/safety/audit";
import {
  dispatchEventNotification,
  type SliceThreeEvent,
} from "@/lib/whatsapp/slice3Dispatcher";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_EVENTS = new Set([
  "departed",
  "reached",
  "visit_started",
  "visit_done",
  "patient_no_show",
]);

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  const auth = await requireMedic(request);
  if (auth instanceof NextResponse) return auth;

  let body: {
    booking_id?: string;
    event?: string;
    lat?: number;
    lng?: number;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const bookingId = String(body.booking_id ?? "");
  if (!UUID_RE.test(bookingId)) {
    return NextResponse.json({ error: "invalid_booking_id" }, { status: 400 });
  }

  const event = String(body.event ?? "");
  if (!VALID_EVENTS.has(event)) {
    return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  }

  const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
  const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 500) : null;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 },
    );
  }

  // Ownership check: this medic must own this booking.
  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("id, medic_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingErr) {
    console.error("[medic-app/event] booking lookup failed", bookingErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!booking) {
    await writeAudit({
      eventType: AuditEvent.MEDIC_EVENT_UNKNOWN_BOOKING,
      eventData: { booking_id: bookingId, medic_id: auth.medic_id, event },
    });
    return NextResponse.json({ error: "booking_not_found" }, { status: 404 });
  }
  if (booking.medic_id !== auth.medic_id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Idempotency: if a row already exists for (booking, medic, event), return it.
  const { data: existing, error: existingErr } = await supabase
    .from("medic_event_log")
    .select("id, occurred_at")
    .eq("booking_id", bookingId)
    .eq("medic_id", auth.medic_id)
    .eq("event", event)
    .maybeSingle();
  if (existingErr) {
    console.error("[medic-app/event] dedupe lookup failed", existingErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (existing) {
    await writeAudit({
      eventType: AuditEvent.MEDIC_EVENT_IDEMPOTENT_RETURN,
      eventData: { booking_id: bookingId, medic_id: auth.medic_id, event },
    });
    return NextResponse.json(
      { event_id: existing.id, recorded_at: existing.occurred_at, deduped: true },
      { status: 200 },
    );
  }

  // Fresh insert.
  const { data: inserted, error: insertErr } = await supabase
    .from("medic_event_log")
    .insert({
      booking_id: bookingId,
      medic_id: auth.medic_id,
      event,
      lat,
      lng,
      notes,
    })
    .select("id, occurred_at")
    .single();
  if (insertErr || !inserted) {
    console.error("[medic-app/event] insert failed", insertErr);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  // ---- Slice 3 (T66) side effects + Aarogya notification ------------
  // CRITICAL: this whole block is wrapped so notification failures never
  // block the medic-app's POST response. The medic needs to know the
  // event was recorded regardless of downstream comms.
  const audit = (eventType: AuditEventType, eventData: Record<string, unknown>) =>
    writeAudit({ eventType, eventData });

  await audit(AuditEvent.MEDIC_EVENT_RECEIVED, {
    booking_id: bookingId, medic_id: auth.medic_id, event,
  });
  await audit(AuditEvent.MEDIC_EVENT_INSERTED, {
    booking_id: bookingId, medic_id: auth.medic_id, event,
  });

  try {
    // Fetch the wider booking + medic context for the dispatcher.
    const { data: bookingDetail } = await supabase
      .from("bookings")
      .select("id, phone, patient_name, status")
      .eq("id", bookingId)
      .maybeSingle();
    const { data: medicDetail } = await supabase
      .from("medics")
      .select("id, full_name, phone")
      .eq("id", auth.medic_id)
      .maybeSingle();

    if (!bookingDetail || !medicDetail) {
      await audit(AuditEvent.MEDIC_EVENT_NOTIFICATION_FAILED, {
        booking_id: bookingId, medic_id: auth.medic_id, event,
        error: "booking_or_medic_lookup_failed",
      });
    } else if (bookingDetail.status === "CANCELLED") {
      // Event arrived on a cancelled booking — log + refuse the POST.
      // The medic_event_log row is left in place for forensics; the
      // 409 tells the medic-app the dispatch was blocked at this layer.
      await audit(AuditEvent.MEDIC_EVENT_CANCELLED_BOOKING, {
        booking_id: bookingId, medic_id: auth.medic_id, event,
      });
      return NextResponse.json({ error: "booking_cancelled" }, { status: 409 });
    } else {
      // visit_done side effect: bookings.status → COMPLETED.
      if (event === "visit_done") {
        const { error: updateErr } = await supabase
          .from("bookings")
          .update({ status: "COMPLETED" })
          .eq("id", bookingId);
        if (!updateErr) {
          await audit(AuditEvent.MEDIC_EVENT_BOOKING_STATUS_UPDATED, {
            booking_id: bookingId, from: bookingDetail.status, to: "COMPLETED",
          });
        }
      }

      // patient_no_show side effect: queue the 5-min escalation marker.
      // The pg_cron job (M060) picks this up on its next firing.
      if (event === "patient_no_show") {
        const { error: queueErr } = await supabase
          .from("no_show_escalation_queue")
          .insert({
            booking_id: bookingId,
            medic_id: auth.medic_id,
            no_show_at: inserted.occurred_at,
          });
        // Duplicate is benign (the medic re-clicked) — only audit real failures.
        if (queueErr && queueErr.code !== "23505") {
          await audit(AuditEvent.MEDIC_EVENT_NOTIFICATION_FAILED, {
            booking_id: bookingId, medic_id: auth.medic_id, event,
            error: "no_show_queue_insert_failed",
          });
        } else {
          await audit(AuditEvent.NO_SHOW_ESCALATION_PENDING, {
            booking_id: bookingId, medic_id: auth.medic_id,
          });
        }
      }

      // Fire the patient-facing Aarogya notification. The dispatcher
      // owns per-event routing (template vs free-form vs skip).
      const dispatchRes = await dispatchEventNotification({
        event: event as SliceThreeEvent,
        booking: {
          id: bookingDetail.id,
          phone: bookingDetail.phone as string,
          patient_name: (bookingDetail.patient_name as string | null) ?? null,
          status: bookingDetail.status as string | null,
        },
        medic: {
          id: medicDetail.id,
          full_name: (medicDetail.full_name as string | null) ?? null,
          phone: medicDetail.phone as string,
        },
      });

      if (dispatchRes.sent) {
        await audit(AuditEvent.MEDIC_EVENT_NOTIFICATION_SENT, {
          booking_id: bookingId, medic_id: auth.medic_id, event,
          provider_message_id: dispatchRes.providerMessageId ?? null,
        });
      } else if ("skipped" in dispatchRes && dispatchRes.skipped) {
        // Skip audit already written inside the dispatcher
        // (medic_event_notification_skipped_optout / _skipped_window).
      } else if ("blocked" in dispatchRes && dispatchRes.blocked) {
        // opt_out_send_blocked audit already written inside the chokepoint.
        // Nothing to add here.
      } else if (!dispatchRes.sent) {
        await audit(AuditEvent.MEDIC_EVENT_NOTIFICATION_FAILED, {
          booking_id: bookingId, medic_id: auth.medic_id, event,
          error: "error" in dispatchRes ? dispatchRes.error : "unknown",
        });
      }
    }
  } catch (e) {
    // Notification failure must NOT block the medic-app POST response.
    console.error("[medic-app/event] Slice 3 dispatch failure", e);
    await audit(AuditEvent.MEDIC_EVENT_NOTIFICATION_FAILED, {
      booking_id: bookingId, medic_id: auth.medic_id, event,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json(
    { event_id: inserted.id, recorded_at: inserted.occurred_at },
    { status: 201 },
  );
}
