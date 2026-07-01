import { NextResponse, type NextRequest } from "next/server";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isUuid } from "@/app/api/pulse/_lib/validation";
import {
  serviceLabel,
  formatPaiseINR,
  formatRecordDate,
} from "@/app/pulse/(authed)/records/recordsDisplay";
import { renderReceiptPdf } from "@/lib/receipt/pdf/renderReceiptPdf";

// GET /api/pulse/invoices/[bookingId]/receipt
//
// Streams a Sanocare-branded payment-receipt PDF for one of the signed-in
// customer's own payments. Read-only — no DB writes.
//
// SECURITY (the non-negotiable): the payment is looked up by booking_id AND
// customer_id = session customer. A booking that isn't theirs matches zero rows
// → 404 (never another customer's receipt). NOT_DUE rows (no payment occurred)
// are excluded, so a booking with no captured payment also 404s. The full
// razorpay_payment_id is printed on the PDF — acceptable because the document is
// the customer's own receipt, hard-scoped to them.
//
// PDF: reuses the prescription @react-pdf/renderer stack (renderReceiptPdf) —
// no second PDF library.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ bookingId: string }> };

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const { bookingId } = await ctx.params;
  if (!isUuid(bookingId)) {
    return NextResponse.json({ error: "Invalid booking id." }, { status: 400 });
  }

  // Hard IDOR scope + receipts-only. Order newest-captured first, take one.
  const { data, error } = await supabaseAdmin
    .from("payments_v")
    .select(
      "booking_code, customer_name, service_category, amount_paise, status, razorpay_payment_id, captured_at, created_at",
    )
    .eq("booking_id", bookingId)
    .eq("customer_id", customer.id)
    .neq("status", "NOT_DUE")
    .order("captured_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) {
    console.error("[pulse/receipt] payments_v lookup failed", error);
    return NextResponse.json(
      { error: "Could not generate the receipt." },
      { status: 500 },
    );
  }

  const row = data?.[0] as
    | {
        booking_code: string | null;
        customer_name: string | null;
        service_category: string | null;
        amount_paise: number;
        status: string;
        razorpay_payment_id: string | null;
        captured_at: string | null;
        created_at: string;
      }
    | undefined;

  if (!row) {
    // Not this customer's booking, or no captured payment on it.
    return new NextResponse("Not found.", { status: 404 });
  }

  const status: "CAPTURED" | "REFUNDED" =
    row.status === "REFUNDED" ? "REFUNDED" : "CAPTURED";

  const pdf = await renderReceiptPdf({
    receipt_no: row.booking_code ?? bookingId,
    date_display: formatRecordDate(row.captured_at ?? row.created_at),
    bill_to: row.customer_name ?? customer.full_name ?? "—",
    service_label: serviceLabel(row.service_category),
    amount_display: formatPaiseINR(row.amount_paise),
    status,
    payment_ref: row.razorpay_payment_id ?? null,
  });

  const filename = `Sanocare-Receipt-${row.booking_code ?? bookingId}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
