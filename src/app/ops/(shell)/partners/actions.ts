"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";

const PARTNER_TYPES = new Set(["society", "clinic", "corporate", "individual"]);

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

export async function createPartner(formData: FormData) {
  const opsUser = await getCurrentOpsUser();
  const supabase = await createOpsRSCClient();

  const name = str(formData, "name");
  const partner_type = str(formData, "partner_type");
  if (!name) throw new Error("Name is required");
  if (!partner_type || !PARTNER_TYPES.has(partner_type)) {
    throw new Error("Valid partner type is required");
  }

  const { data: code, error: codeErr } = await supabase.rpc("next_code", {
    p_type: "partner",
  });
  if (codeErr || !code) {
    throw new Error(`Could not allocate partner code: ${codeErr?.message ?? "unknown"}`);
  }

  const { data: inserted, error } = await supabase
    .from("partners")
    .insert({
      partner_code: code,
      name,
      partner_type,
      contact_name: str(formData, "contact_name"),
      phone: str(formData, "phone"),
      email: str(formData, "email"),
      address_line: str(formData, "address_line"),
      city: str(formData, "city"),
      pincode: str(formData, "pincode"),
      notes: str(formData, "notes"),
      // is_active defaults to true at the DB level
      created_by: opsUser.id,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    throw new Error(`Could not create partner: ${error?.message ?? "unknown"}`);
  }

  revalidatePath("/ops/partners");
  redirect(`/ops/partners/${inserted.id}`);
}
