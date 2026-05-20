"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../_lib/getCurrentOpsUser";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
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
      phone: str(formData, "phone"),
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
