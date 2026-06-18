"use server";

import { revalidatePath } from "next/cache";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { requireOpsAdmin } from "../../../_lib/requireOpsAdmin";

// T65 Phase 2B C3-full — medic detail server actions.
//
// Both gated by requireOpsAdmin (redirect to /ops/no-access for agents).
// updateMedicAction handles inline profile edits; deactivateMedicAction
// flips active=false via the explicit confirmation modal (admin can also
// just untick the active checkbox in updateMedic).

const PHONE_RE = /^\+91[6-9]\d{9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUALIFICATIONS = new Set(["GNM", "B.Sc Nursing"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UpdateMedicResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

function getString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function updateMedicAction(
  _prev: UpdateMedicResult | null,
  formData: FormData,
): Promise<UpdateMedicResult> {
  await requireOpsAdmin();
  const supabase = await createOpsRSCClient();

  const id = getString(formData, "id");
  if (!UUID_RE.test(id)) {
    return { ok: false, error: "Invalid medic id." };
  }

  const full_name = getString(formData, "full_name");
  if (full_name.length < 2 || full_name.length > 80) {
    return { ok: false, error: "Full name must be 2–80 characters.", field: "full_name" };
  }

  const phone = getString(formData, "phone");
  if (!PHONE_RE.test(phone)) {
    return { ok: false, error: "Phone must be E.164 +91XXXXXXXXXX.", field: "phone" };
  }

  const qualification = getString(formData, "qualification");
  if (!QUALIFICATIONS.has(qualification)) {
    return { ok: false, error: "Qualification must be GNM or B.Sc Nursing.", field: "qualification" };
  }

  const licenseRaw = getString(formData, "license_number");
  const license_number = licenseRaw.length > 0 ? licenseRaw : null;

  const hireRaw = getString(formData, "hire_date");
  const hire_date = hireRaw.length > 0 ? hireRaw : null;
  if (hire_date && !DATE_RE.test(hire_date)) {
    return { ok: false, error: "Hire date must be YYYY-MM-DD.", field: "hire_date" };
  }

  const active = formData.get("active") === "on";

  // Dupe-phone guard — exclude self (the row we're editing).
  const { data: dupe } = await supabase
    .from("medics")
    .select("id")
    .eq("phone", phone)
    .neq("id", id)
    .maybeSingle();
  if (dupe) {
    return {
      ok: false,
      error: "Another medic is already registered with this phone.",
      field: "phone",
    };
  }

  const { error: updateErr } = await supabase
    .from("medics")
    .update({ full_name, phone, qualification, license_number, hire_date, active })
    .eq("id", id);
  if (updateErr) {
    console.error("[ops/medics/[id]] update failed", updateErr);
    return { ok: false, error: `Could not save: ${updateErr.message}` };
  }

  revalidatePath(`/ops/medics/${id}`);
  revalidatePath("/ops/medics");
  return { ok: true };
}

export async function deactivateMedicAction(formData: FormData): Promise<void> {
  await requireOpsAdmin();
  const supabase = await createOpsRSCClient();
  const id = getString(formData, "id");
  if (!UUID_RE.test(id)) {
    throw new Error("Invalid medic id.");
  }
  const { error } = await supabase
    .from("medics")
    .update({ active: false })
    .eq("id", id);
  if (error) {
    console.error("[ops/medics/[id]] deactivate failed", error);
    throw new Error(`Could not deactivate: ${error.message}`);
  }
  revalidatePath(`/ops/medics/${id}`);
  revalidatePath("/ops/medics");
}
