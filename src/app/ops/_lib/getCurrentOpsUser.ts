import { cache } from "react";
import { redirect } from "next/navigation";
import { createOpsRSCClient } from "@/lib/supabase-rsc";

export type CurrentOpsUser = {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "agent";
};

/**
 * Resolve the currently signed-in ops user, or redirect.
 * Wrapped in React `cache()` so multiple callers in the same request
 * share a single Supabase round-trip.
 */
export const getCurrentOpsUser = cache(async (): Promise<CurrentOpsUser> => {
  const supabase = await createOpsRSCClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/ops/login");

  const { data: opsUser } = await supabase
    .from("ops_users")
    .select("full_name, email, role")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!opsUser) redirect("/ops/no-access");

  return {
    id: user.id,
    email: opsUser.email,
    full_name: opsUser.full_name,
    role: opsUser.role as "admin" | "agent",
  };
});
