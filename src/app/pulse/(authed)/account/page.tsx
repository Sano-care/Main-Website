import Link from "next/link";

import { getCurrentCustomer } from "../../_lib/getCurrentCustomer";
import { supabaseAdmin } from "@/lib/supabase-server";
import PulseSignOutButton from "../../_components/PulseSignOutButton";

/**
 * T90 Slice 2 Step 14 — Account settings stub (/pulse/account).
 *
 * Account-holder surface — does NOT rescope by viewing member (founder
 * confirmation). Always shows the caregiver's phone + email regardless
 * of which family member the chrome chip is currently viewing.
 *
 * Phase 1 content (deliberately minimal):
 *   1. Account header
 *   2. Phone row (read-only — phone is the auth artefact, edits land
 *      in a future verify-new-phone flow)
 *   3. Email row (read-only summary; edit deep-links to /pulse/profile
 *      per founder direction — Profile is the canonical edit location,
 *      Account is a read-only summary)
 *   4. "More options coming" placeholder card
 *   5. Sign out CTA (third exit-affordance after Drawer + AvatarMenu;
 *      intentional redundancy — every "exit" surface has Sign out)
 *
 * Step 17 may consolidate the placeholder copy / migrate Drawer +
 * AvatarMenu to consume PulseSignOutButton.
 *
 * Auth gated by (authed) layout — null-check below is type narrowing.
 * force-dynamic so a freshly-saved email on the Profile tab reflects
 * here on next navigation.
 */

export const dynamic = "force-dynamic";

export default async function PulseAccountPage() {
  const customerCookie = await getCurrentCustomer();
  if (!customerCookie) return null;

  // Read the email column directly — getCurrentCustomer only returns
  // id/full_name/phone (Step 03 contract).
  const { data: row } = await supabaseAdmin
    .from("customers")
    .select("email")
    .eq("id", customerCookie.id)
    .maybeSingle();

  const email = (row?.email as string | null) ?? null;
  const phoneDisplay = formatIndianPhone(customerCookie.phone);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-24 pt-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-text-main">
          Account settings
        </h1>
      </header>

      {/* === Account section ============================== */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
          Your account
        </h2>
        <div className="mt-3 space-y-3">
          {/* Phone — read-only, no edit path in Phase 1 */}
          <div className="px-1 py-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Phone
            </p>
            <p className="mt-0.5 text-sm font-semibold text-text-main">
              {phoneDisplay}
            </p>
          </div>

          {/* Email — read-only summary; edit deep-links to Profile tab */}
          <Link
            href="/pulse/profile"
            className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2 text-left hover:bg-slate-50"
          >
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                Email
              </p>
              {email ? (
                <p className="mt-0.5 truncate text-sm font-semibold text-text-main">
                  {email}
                </p>
              ) : (
                <p className="mt-0.5 text-sm font-medium text-primary">
                  Add email <span aria-hidden="true">→</span>
                </p>
              )}
            </div>
            {email ? (
              <span className="text-sm font-medium text-primary">
                Edit <span aria-hidden="true">→</span>
              </span>
            ) : null}
          </Link>
        </div>
      </section>

      {/* === "More options coming" placeholder =============== */}
      <section
        aria-disabled="true"
        className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
      >
        <p className="text-sm font-semibold text-text-secondary">
          More options coming
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          Notification preferences, language, and more.
        </p>
      </section>

      {/* === Sign out CTA =================================== */}
      <div className="pt-2">
        <PulseSignOutButton />
      </div>
    </div>
  );
}

function formatIndianPhone(phone: string): string {
  const digits = phone.replace(/^\+/, "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+91 ${digits.slice(2)}`;
  }
  return phone;
}
