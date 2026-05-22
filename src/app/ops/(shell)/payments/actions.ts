"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { normaliseIndianPhone } from "@/lib/phone";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";
import {
  issueRefund as runIssueRefund,
  RefundError,
  type PaymentKind,
} from "@/lib/razorpay-refund";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAN_C_RE = /^SAN-C-\d+$/i;

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function requireStr(formData: FormData, key: string): string {
  const v = str(formData, key);
  if (!v) throw new Error(`${key} is required`);
  return v;
}

/**
 * Service-role client used for the refund write path. The ops admin
 * gate is enforced upstream via is_ops_admin() rpc — service-role then
 * carries the writes so RLS doesn't fight us inside the helper.
 */
function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Re-check is_ops_admin() via the cookie-authed RPC, never trusting the
 * client. Throws an Error the caller surfaces as an inline message.
 */
async function assertOpsAdmin(): Promise<{ opsUserId: string }> {
  const opsUser = await getCurrentOpsUser(); // already throws if not ops
  const supabase = await createOpsRSCClient();
  const { data, error } = await supabase.rpc("is_ops_admin");
  if (error) {
    throw new Error(`Could not verify admin role: ${error.message}`);
  }
  if (data !== true) {
    throw new Error("Refunds are restricted to ops admins.");
  }
  return { opsUserId: opsUser.id };
}

// =====================================================================
// issueRefundAction — admin only, called from the payment detail RefundForm
// =====================================================================
export async function issueRefundAction(formData: FormData) {
  const { opsUserId } = await assertOpsAdmin();

  const bookingId = requireStr(formData, "booking_id");
  if (!UUID_RE.test(bookingId)) {
    throw new Error("Invalid booking id.");
  }
  const paymentKindRaw = requireStr(formData, "payment_kind");
  if (paymentKindRaw !== "booking_fee" && paymentKindRaw !== "report_fee") {
    throw new Error(`Invalid payment kind: ${paymentKindRaw}`);
  }
  const paymentKind = paymentKindRaw as PaymentKind;

  const reason = str(formData, "reason");

  // Amount form field is in rupees (₹). Convert to paise for the helper.
  // Empty / "full" means refund everything remaining.
  let partialAmountPaise: number | null = null;
  const amountRupeesRaw = str(formData, "amount_rupees");
  if (amountRupeesRaw) {
    const n = Number(amountRupeesRaw);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("Amount must be a positive number (in rupees).");
    }
    partialAmountPaise = Math.round(n * 100);
  }

  // Confirmation step the form provides — never trust the client, but if
  // the value is missing this is the most common shape of a misclick or
  // a form-action-without-confirmation path. Surface a clean message.
  const confirmed = formData.get("confirmed");
  if (confirmed !== "yes") {
    throw new Error("Refund not confirmed.");
  }

  try {
    const result = await runIssueRefund(createServiceClient(), {
      bookingId,
      paymentKind,
      reason,
      partialAmountPaise,
      opsUserId,
    });

    // Revalidate the pages that show payment / refund state.
    revalidatePath("/ops/payments");
    revalidatePath(`/ops/bookings/${bookingId}`);
    return {
      ok: true as const,
      refundId: result.refundId,
      refundedAmountPaise: result.refundedAmountPaise,
      isPartial: result.isPartial,
      refundStatus: result.refundStatus,
    };
  } catch (e) {
    if (e instanceof RefundError) {
      return { ok: false as const, error: e.message, code: e.code };
    }
    throw e;
  }
}

// =====================================================================
// reconcileCustomer — any ops user, links the booking behind this payment
//                     to an existing customer (SAN-C code or phone).
// =====================================================================
export async function reconcileCustomerAction(formData: FormData) {
  await getCurrentOpsUser(); // any ops user

  const bookingId = requireStr(formData, "booking_id");
  if (!UUID_RE.test(bookingId)) {
    throw new Error("Invalid booking id.");
  }
  const lookup = requireStr(formData, "customer_lookup");

  const supabase = await createOpsRSCClient();

  // Resolve the customer: SAN-C code, full UUID, or phone (normalised).
  let customerId: string | null = null;
  if (UUID_RE.test(lookup)) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("id", lookup)
      .maybeSingle();
    customerId = data?.id ?? null;
  } else if (SAN_C_RE.test(lookup)) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("customer_code", lookup.toUpperCase())
      .maybeSingle();
    customerId = data?.id ?? null;
  } else {
    const normalised = normaliseIndianPhone(lookup);
    if (!normalised) {
      throw new Error(
        "Enter a SAN-C code, a full customer UUID, or a 10-digit Indian phone.",
      );
    }
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("phone", normalised)
      .maybeSingle();
    customerId = data?.id ?? null;
  }

  if (!customerId) {
    throw new Error(`No customer matches "${lookup}".`);
  }

  // Update the booking — RLS allows ops updates on bookings (M014).
  const { error } = await supabase
    .from("bookings")
    .update({ customer_id: customerId })
    .eq("id", bookingId);
  if (error) {
    throw new Error(`Could not link customer: ${error.message}`);
  }

  revalidatePath("/ops/payments");
  revalidatePath(`/ops/bookings/${bookingId}`);
  return { ok: true as const, customerId };
}
