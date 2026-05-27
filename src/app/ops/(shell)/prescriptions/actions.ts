"use server";

// Ops-side prescription actions.
//
// Surface:
//   resendRxWhatsApp(formData)     → re-trigger Rampwin delivery for a
//                                    sent Rx (uses the same template-
//                                    shape env flag as the doctor send)
//   getRxPdfSignedUrl(rxId)        → mint a short-lived signed URL to
//                                    the PDF in the prescriptions
//                                    bucket so ops can preview or
//                                    download
//
// All actions assert ops-user via getCurrentOpsUser(). Resend is
// admin-only because it can spam a patient if abused; preview/download
// is allowed for any ops user.

import { revalidatePath } from "next/cache";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";
import {
  sendRxLink,
  RampwinRxDeliveryError,
  isRxDocumentHeaderEnabled,
} from "@/lib/rx/rampwin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESCRIPTIONS_BUCKET = "prescriptions";

function reqStr(formData: FormData, key: string): string {
  const v = formData.get(key);
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`${key} is required`);
  }
  return v.trim();
}

async function assertOpsAdmin() {
  await getCurrentOpsUser();
  const supabase = await createOpsRSCClient();
  const { data, error } = await supabase.rpc("is_ops_admin");
  if (error) {
    throw new Error(`Could not verify admin role: ${error.message}`);
  }
  if (data !== true) {
    throw new Error("This action is restricted to ops admins.");
  }
}

export type OpsRxActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Resend the patient's WhatsApp Rx link. Used when the original
 * delivery failed (whatsapp_sent_at IS NULL) or the patient lost the
 * message. Only sent / non-voided rows are eligible.
 */
export async function resendRxWhatsApp(
  formData: FormData,
): Promise<OpsRxActionResult<{ whatsapp_sent: boolean; rx_url: string }>> {
  try {
    await assertOpsAdmin();
    const id = reqStr(formData, "prescription_id");
    if (!UUID_RE.test(id)) {
      return { ok: false, error: "Invalid prescription id." };
    }

    // Load the prescription + the doctor + the patient phone. We
    // also pull session_id + sent_at because the WhatsApp template's
    // {{3}} placeholder is the consultation date; we use
    // consultation_sessions.scheduled_at as the primary source,
    // falling back to prescriptions.sent_at when the session row is
    // gone (rare; ops can manually delete a stale session).
    const { data: rxRow, error: rxErr } = await supabaseAdmin
      .from("prescriptions")
      .select(
        "id, prescription_code, version, status, doctor_id, session_id, booking_id, patient_name, patient_view_token, pdf_storage_path, sent_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (rxErr || !rxRow) {
      return { ok: false, error: `Prescription not found: ${rxErr?.message ?? ""}` };
    }
    const rx = rxRow as {
      id: string;
      prescription_code: string;
      version: number;
      status: string;
      doctor_id: string;
      session_id: string;
      booking_id: string;
      patient_name: string;
      patient_view_token: string | null;
      pdf_storage_path: string | null;
      sent_at: string | null;
    };
    if (rx.status !== "sent") {
      return {
        ok: false,
        error: `Can only resend a 'sent' Rx — this one is ${rx.status}.`,
      };
    }
    if (!rx.patient_view_token) {
      return { ok: false, error: "Patient-view token is missing on this Rx." };
    }

    const { data: doctorRow } = await supabaseAdmin
      .from("doctors")
      .select("full_name")
      .eq("id", rx.doctor_id)
      .maybeSingle();
    const doctorName = (doctorRow as { full_name: string } | null)?.full_name ?? "your doctor";

    // Pull patient phone from booking (preferring linked customer).
    const { data: bookingRow } = await supabaseAdmin
      .from("bookings")
      .select("phone, customer:customers(phone)")
      .eq("id", rx.booking_id)
      .maybeSingle();
    const cust = (bookingRow as { customer: { phone: string | null } | null } | null)?.customer;
    const phone = cust?.phone ?? (bookingRow as { phone: string | null } | null)?.phone ?? null;
    if (!phone) {
      return {
        ok: false,
        error: "No patient phone on file for this booking — copy the link and share it directly.",
      };
    }

    // For document-header mode, mint a 1h signed URL. Uses the shared
    // env-parse helper so this and rampwin.ts can never disagree on a
    // trailing-whitespace value.
    let signedPdfUrl: string | null = null;
    if (isRxDocumentHeaderEnabled() && rx.pdf_storage_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from(PRESCRIPTIONS_BUCKET)
        .createSignedUrl(rx.pdf_storage_path, 60 * 60);
      signedPdfUrl = signed?.signedUrl ?? null;
    }

    const rxUrl = `${(
      process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://sanocare.in"
    ).replace(/\/+$/, "")}/rx/${rx.patient_view_token}`;

    // Body-only template needs the consultation date for {{3}}. Prefer
    // consultation_sessions.scheduled_at; fall back to rx.sent_at when
    // the session row is gone. We accept the fallback because the
    // wording "your consultation on <date>" remains sensible — sent_at
    // is typically minutes after scheduled_at for an in-flight Rx.
    const { data: sessionRow } = await supabaseAdmin
      .from("consultation_sessions")
      .select("scheduled_at")
      .eq("id", rx.session_id)
      .maybeSingle();
    const consultationDateIso =
      (sessionRow as { scheduled_at: string | null } | null)?.scheduled_at ??
      rx.sent_at ??
      new Date().toISOString();

    try {
      const result = await sendRxLink({
        phone,
        patientName: rx.patient_name,
        doctorName,
        patientViewToken: rx.patient_view_token,
        signedPdfUrl,
        prescriptionCode: rx.prescription_code,
        consultationDateIso,
      });
      await supabaseAdmin
        .from("prescriptions")
        .update({
          whatsapp_sent_at: new Date().toISOString(),
          whatsapp_message_id: result.providerMessageId ?? null,
        })
        .eq("id", rx.id);
      revalidatePath("/ops/prescriptions");
      revalidatePath(`/ops/prescriptions/${rx.prescription_code}`);
      revalidatePath(`/ops/bookings/${rx.booking_id}`);
      return { ok: true, data: { whatsapp_sent: true, rx_url: rxUrl } };
    } catch (e) {
      if (e instanceof RampwinRxDeliveryError) {
        return { ok: false, error: `Rampwin: ${e.message}` };
      }
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Could not resend WhatsApp.",
      };
    }
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not resend WhatsApp.",
    };
  }
}

/**
 * Returns a short-lived (5 min) signed URL on the Rx PDF, scoped to
 * the requesting ops user. Used by the detail page's "Download PDF"
 * button.
 */
export async function getRxPdfSignedUrl(
  rxId: string,
): Promise<string | null> {
  await getCurrentOpsUser();
  if (!UUID_RE.test(rxId)) return null;

  const { data, error } = await supabaseAdmin
    .from("prescriptions")
    .select("pdf_storage_path")
    .eq("id", rxId)
    .maybeSingle();
  if (error || !data) return null;
  const path = (data as { pdf_storage_path: string | null }).pdf_storage_path;
  if (!path) return null;

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(PRESCRIPTIONS_BUCKET)
    .createSignedUrl(path, 60 * 5);
  if (signErr || !signed?.signedUrl) return null;
  return signed.signedUrl;
}
