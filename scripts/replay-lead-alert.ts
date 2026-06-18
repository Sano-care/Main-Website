#!/usr/bin/env tsx
/**
 * scripts/replay-lead-alert.ts
 *
 * One-off (and re-runnable) ops tool — replays the `aarogya_lead_alert`
 * WhatsApp for an existing booking row. Useful any time an alert was
 * missed: Netlify Functions teardown race (the 2026-06-08 silent-failure
 * incident on Case #SAN-B-00058), transient Rampwin outage, an env-var
 * misconfig recovered after the fact, etc.
 *
 * The script imports the SAME `sendAarogyaLeadAlert` the production
 * routes use, so a green replay run also implicitly validates the
 * fixed call path (Mode A / Mode B / partial-advance-50 logic).
 *
 * Booking-code → payload derivation mirrors `/api/razorpay/verify`
 * (PR4a, non-lab) and `/api/lab/create-booking-prepaid` (PR4b, lab)
 * exactly. The only thing the script doesn't reconstruct is `ops_notes`
 * — those weren't passed to the lead alert in PR4a/PR4b anyway (the
 * routes pass `undefined` to the `notes` half of formatLeadAlertContext).
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=...       \
 *   SUPABASE_SERVICE_ROLE_KEY=...      \
 *   RAMPWIN_API_KEY=...                \
 *   RAMPWIN_CHANNEL_ID=...             \
 *   RAMPWIN_OPS_PHONE=919XXXXXXXXX     \
 *   npx tsx scripts/replay-lead-alert.ts SAN-B-00058
 *
 * Optional env vars (defaults match the production routes):
 *   RAMPWIN_API_URL                       — Rampwin send endpoint
 *   RAMPWIN_LEAD_ALERT_TEMPLATE_NAME      — defaults to 'aarogya_lead_alert'
 *   RAMPWIN_LEAD_ALERT_ENABLED            — set to 'false' to no-op
 *
 * Exit codes:
 *   0  delivered=true (WhatsApp accepted by Rampwin BSP)
 *   1  delivered=false (env miss / phone format / Rampwin rejected)
 *   2  booking not found / fatal error
 */

import { createClient } from "@supabase/supabase-js";
import { sendAarogyaLeadAlert } from "../src/lib/booking/meta";
import { formatLeadAlertContext } from "../src/lib/booking/contextFormat";
import {
  dbToT85Slug,
  t85ServiceDisplayName,
} from "../src/lib/booking/serviceMapper";

/**
 * Minimal projection of the `bookings` row needed to reconstruct the
 * aarogya_lead_alert payload. Hand-typed because supabase-js v2's
 * string-selector row-type inference chokes on multi-line selects.
 */
interface BookingReplayRow {
  id: string;
  booking_code: string | null;
  patient_name: string | null;
  phone: string | null;
  manual_address: string | null;
  service_category: string | null;
  amount: number | null;
  booking_fee_paid_paise: number | null;
  final_amount_paise: number | null;
  report_payment_status: string | null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n" +
      "Export them in this shell before running (or use dotenv-cli with .env.local).",
  );
  process.exit(2);
}

async function main() {
  const bookingCode = process.argv[2]?.trim();
  if (!bookingCode) {
    console.error(
      "Usage: npx tsx scripts/replay-lead-alert.ts <booking_code>\n" +
        "Example: npx tsx scripts/replay-lead-alert.ts SAN-B-00058",
    );
    process.exit(2);
  }

  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // Fetch the booking row by booking_code. The select string is
  // intentionally on one line; multi-line throws off supabase-js v2's
  // row-type inference. We cast through `unknown` to the explicit
  // BookingReplayRow projection above.
  const { data, error } = await supabase
    .from("bookings")
    .select("id, booking_code, patient_name, phone, manual_address, service_category, amount, booking_fee_paid_paise, final_amount_paise, report_payment_status")
    .eq("booking_code", bookingCode)
    .single();

  if (error || !data) {
    console.error(`Booking ${bookingCode} not found:`, error?.message ?? error);
    process.exit(2);
  }
  const booking = data as unknown as BookingReplayRow;

  // Resolve service display name via the same single-source helpers the
  // production routes use. Handles both T85 slugs and legacy values.
  const serviceCategoryRaw = String(booking.service_category ?? "").trim();
  const t85Slug = dbToT85Slug(serviceCategoryRaw);
  if (!t85Slug) {
    console.error(
      `Booking ${bookingCode} has unmappable service_category="${serviceCategoryRaw}" — ` +
        "no T85 display name. Out of scope for aarogya_lead_alert (e.g. 'chronic' is a separate product).",
    );
    process.exit(2);
  }
  const serviceDisplay = t85ServiceDisplayName(t85Slug);

  // Derive { paidPaise, totalPaise, mode } per service type — matches
  // the persistence shape each production route writes.
  //
  //   Lab (PR4b create-booking-prepaid):
  //     final_amount_paise         = grand total (always)
  //     booking_fee_paid_paise     = Razorpay capture (full grand total
  //                                  for Mode A, ₹200 for Mode B)
  //     report_payment_status      = 'CAPTURED' (Mode A) | 'PARTIAL_PAID' (Mode B)
  //
  //   Non-lab (PR4a razorpay/verify, partial-advance-50):
  //     amount                     = full service price in RUPEES (no final_amount_paise)
  //     booking_fee_paid_paise     = ₹249-equivalent advance in paise
  let mode: "partial-advance-50" | "lab-full" | "lab-partial";
  let paidPaise: number;
  let totalPaise: number;

  if (t85Slug === "lab-tests") {
    const finalPaise = Number(booking.final_amount_paise);
    const paidNowPaise = Number(booking.booking_fee_paid_paise);
    if (!Number.isFinite(finalPaise) || !Number.isFinite(paidNowPaise)) {
      console.error(
        `Booking ${bookingCode} is a lab booking but missing final_amount_paise / booking_fee_paid_paise — ` +
          "cannot reconstruct payment payload.",
      );
      process.exit(2);
    }
    paidPaise = paidNowPaise;
    totalPaise = finalPaise;
    mode = booking.report_payment_status === "CAPTURED" ? "lab-full" : "lab-partial";
  } else {
    const amountInr = Number(booking.amount);
    const paidNowPaise = Number(booking.booking_fee_paid_paise);
    if (!Number.isFinite(amountInr) || !Number.isFinite(paidNowPaise)) {
      console.error(
        `Booking ${bookingCode} is non-lab but missing amount / booking_fee_paid_paise — ` +
          "cannot reconstruct payment payload.",
      );
      process.exit(2);
    }
    paidPaise = paidNowPaise;
    totalPaise = amountInr * 100;
    mode = "partial-advance-50";
  }

  const contextText = formatLeadAlertContext(undefined, {
    paidPaise,
    totalPaise,
    mode,
  });

  // Print intended payload BEFORE sending so the operator can Ctrl-C
  // if anything looks off.
  console.log(`\nReplaying aarogya_lead_alert for booking ${bookingCode}`);
  console.log(`  Patient:   ${booking.patient_name}`);
  console.log(`  Phone:     ${booking.phone}`);
  console.log(`  Service:   ${serviceDisplay} (slug=${t85Slug}, db="${serviceCategoryRaw}")`);
  console.log(`  Location:  ${booking.manual_address}`);
  console.log(`  Mode:      ${mode}`);
  console.log(`  Context:   ${contextText}`);
  console.log(`  Recipient: ${process.env.RAMPWIN_OPS_PHONE ?? "(RAMPWIN_OPS_PHONE not set)"}\n`);

  const result = await sendAarogyaLeadAlert({
    patientName: String(booking.patient_name ?? "").trim(),
    // Age is not collected in PR4a/PR4b — placeholder "—y" until T64
    // (family-member picker) ships and starts persisting age.
    ageWithYearSuffix: "—y",
    serviceDisplayName: serviceDisplay,
    location: String(booking.manual_address ?? "").trim(),
    context: contextText,
    patientPhone: String(booking.phone ?? "").trim(),
  });

  console.log("\nResult:", result);
  if (result.delivered) {
    console.log("WhatsApp dispatched. Check the ops device within ~5 seconds.");
    process.exit(0);
  } else {
    console.log(
      "Delivery returned false. See the [aarogya_lead_alert] logs above " +
        "for the specific failure (env miss / phone format / Rampwin HTTP error).",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Replay failed with unexpected error:", err);
  process.exit(2);
});
