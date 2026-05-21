"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { normaliseIndianPhone } from "@/lib/phone";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Returns the canonical E.164 phone for a form field, or null if blank.
 * Throws if the input is present but doesn't look like a valid Indian
 * mobile — better to reject loud than silently store garbage that will
 * later collide with the M016 UNIQUE constraint.
 */
function canonicalPhone(formData: FormData, key: string): string | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const e164 = normaliseIndianPhone(raw);
  if (!e164) {
    throw new Error(
      `Phone number "${raw}" is not a valid Indian mobile. Use a 10-digit number starting 6-9, optionally with +91 / 91 / 0 prefix.`,
    );
  }
  return e164;
}

export async function createCustomer(formData: FormData) {
  const opsUser = await getCurrentOpsUser();
  const supabase = await createOpsRSCClient();

  const full_name = str(formData, "full_name");
  if (!full_name) {
    throw new Error("Full name is required");
  }

  const { data: code, error: codeErr } = await supabase.rpc("next_code", {
    p_type: "customer",
  });
  if (codeErr || !code) {
    throw new Error(`Could not allocate customer code: ${codeErr?.message ?? "unknown"}`);
  }

  const { data: inserted, error } = await supabase
    .from("customers")
    .insert({
      customer_code: code,
      full_name,
      phone: canonicalPhone(formData, "phone"),
      email: str(formData, "email"),
      date_of_birth: str(formData, "date_of_birth"),
      gender: str(formData, "gender"),
      address_line: str(formData, "address_line"),
      area: str(formData, "area"),
      city: str(formData, "city"),
      pincode: str(formData, "pincode"),
      notes: str(formData, "notes"),
      created_by: opsUser.id,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    throw new Error(`Could not create customer: ${error?.message ?? "unknown"}`);
  }

  revalidatePath("/ops/patients");
  redirect(`/ops/patients/${inserted.id}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Update an existing customer's profile. Only `full_name` is required;
 * every other field is optional and an empty string clears it (sets to
 * NULL). `customer_code`, `id`, `created_at`, and `created_by` are
 * immutable here — change them via direct SQL if you really must.
 */
export async function updateCustomer(formData: FormData) {
  await getCurrentOpsUser();
  const supabase = await createOpsRSCClient();

  const id = str(formData, "id");
  if (!id || !UUID_RE.test(id)) {
    throw new Error("Missing or invalid customer id");
  }

  const full_name = str(formData, "full_name");
  if (!full_name) {
    throw new Error("Full name is required");
  }

  const { error } = await supabase
    .from("customers")
    .update({
      full_name,
      phone: canonicalPhone(formData, "phone"),
      email: str(formData, "email"),
      date_of_birth: str(formData, "date_of_birth"),
      gender: str(formData, "gender"),
      address_line: str(formData, "address_line"),
      area: str(formData, "area"),
      city: str(formData, "city"),
      pincode: str(formData, "pincode"),
      notes: str(formData, "notes"),
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Could not update customer: ${error.message}`);
  }

  revalidatePath("/ops/patients");
  revalidatePath(`/ops/patients/${id}`);
}
