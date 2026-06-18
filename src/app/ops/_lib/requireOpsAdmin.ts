import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentOpsUser, type CurrentOpsUser } from "./getCurrentOpsUser";

// T65 Phase 2B — admin-only wrappers around getCurrentOpsUser().
//
// requireOpsAdmin(): for server components / RSC pages / server actions.
// Throws redirect('/ops/no-access') for non-admin roles (mirrors the
// existing path used by getCurrentOpsUser() for is_active=false / no-row).
//
// requireOpsAdminApi(): for route handlers (where redirect() doesn't
// work). Returns either the verified user OR a 403 NextResponse the
// caller can return directly — mirrors the requireMedic() shape for
// consistency.

export const requireOpsAdmin = cache(async (): Promise<CurrentOpsUser> => {
  const opsUser = await getCurrentOpsUser();
  if (opsUser.role !== "admin") {
    redirect("/ops/no-access");
  }
  return opsUser;
});

export async function requireOpsAdminApi(): Promise<
  CurrentOpsUser | NextResponse
> {
  try {
    const opsUser = await getCurrentOpsUser();
    if (opsUser.role !== "admin") {
      return NextResponse.json(
        { error: "admin_required" },
        { status: 403 },
      );
    }
    return opsUser;
  } catch {
    // getCurrentOpsUser() redirects on no-auth — route handler can't
    // redirect; surface as 401.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

// requireOpsUserApi(): any active ops user (admin OR agent). For route
// handlers whose READ is open to both roles (e.g. GET medic ledger) while
// the WRITE on the same surface stays admin-only via requireOpsAdminApi().
// Same redirect-can't-happen-in-a-route handling as above → 401.
export async function requireOpsUserApi(): Promise<
  CurrentOpsUser | NextResponse
> {
  try {
    return await getCurrentOpsUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
