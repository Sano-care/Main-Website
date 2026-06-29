import Link from "next/link";
import {
  Plus,
  Heart,
  Droplet,
  Weight,
  Activity,
  Thermometer,
  Wind,
  ChevronRight,
  FileText,
  Check,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { formatIST } from "@/lib/time/formatIST";
import type { VitalKind } from "@/app/api/pulse/_lib/validation";
import { SectionReveal } from "@/components/marketing/SectionReveal";
import { AnimatedCounter } from "@/components/marketing/AnimatedCounter";
import { getCurrentCustomer } from "../_lib/getCurrentCustomer";
import {
  getLatestVitalsByKind,
  getRecentActivity,
  getTodaySchedule,
} from "../_lib/pulseData";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { VitalReading } from "../_lib/pulseTypes";
import {
  VITAL_META,
  classifyVital,
  formatVitalValue,
  trendTextClass,
} from "../_lib/vitalsDisplay";
import { doseVisual } from "../_lib/medsDisplay";
import EmergencyRibbon from "./_components/EmergencyRibbon";
import PWAInstallPrompt from "./_components/PWAInstallPrompt";
import PulseBookingPhonePrime from "./_components/PulseBookingPhonePrime";
import PulseHomeTiles from "./_components/PulseHomeTiles";
import SnapshotDivider from "./_components/SnapshotDivider";
import ViewingSubLine from "./_components/ViewingSubLine";
import { getGreeting } from "./_lib/greeting";

// Pulse home — two hero tiles (today's vitals + today's medications) over the
// existing recent-activity card, per Sanocare_Pulse_Web_Mockup_v1.html. Fully
// server-rendered: it's a glance surface, so it paints complete on first load.
// Interaction (logging, marking doses) lives on the dedicated pages.

export const dynamic = "force-dynamic";

export default async function PulseHomePage() {
  return <PulseHomeBody />;
}

function kindIcon(kind: VitalKind): ReactNode {
  switch (kind) {
    case "bp":
      return <Heart className="h-4 w-4" />;
    case "sugar_fasting":
    case "sugar_postprandial":
    case "sugar_random":
      return <Droplet className="h-4 w-4" />;
    case "weight_kg":
      return <Weight className="h-4 w-4" />;
    case "temperature_c":
      return <Thermometer className="h-4 w-4" />;
    case "spo2_pct":
      return <Wind className="h-4 w-4" />;
    default:
      return <Activity className="h-4 w-4" />;
  }
}

async function PulseHomeBody() {
  const customer = await getCurrentCustomer();
  // The (authed) layout already redirects to /pulse/login on null. This
  // guard is purely for TypeScript narrowing.
  if (!customer) return null;
  // T90 Slice 2 Step 11: greeting is server-rendered via getGreeting() to
  // avoid a hydration mismatch on the time-of-day text. firstName extraction
  // happens inside the helper (defensive) — we pass full_name directly.
  const greeting = getGreeting(customer.full_name);

  const [latestVitals, todaySchedule, recent, familyCount] = await Promise.all([
    getLatestVitalsByKind(customer.id),
    getTodaySchedule(customer.id),
    getRecentActivity(customer.id),
    // T64: count of family members for the home tile. count='exact' +
    // head=true means we get the count without payload.
    supabaseAdmin
      .from("family_members")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customer.id)
      .then(({ count }) => count ?? 0),
  ]);

  // For the vitals tile: latest BP + latest sugar (any sugar kind).
  const latestBp = latestVitals.find((r) => r.kind === "bp") ?? null;
  const latestSugar =
    latestVitals.find((r) => r.kind.startsWith("sugar")) ?? null;
  const vitalsToShow = [latestBp, latestSugar].filter(
    (r): r is VitalReading => r !== null,
  );

  const dueCount = todaySchedule.length;
  const takenCount = todaySchedule.filter((d) => d.state === "taken").length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* T90 Step 10 — Emergency ribbon, always visible immediately */}
      {/* below the top app bar. Owns the session-count increment for */}
      {/* the home zone (one-shot per mount, debounced). */}
      <EmergencyRibbon />

      {/* T90 Slice 2 Step 11 — phone-verified prime. Renders null; */}
      {/* seeds bookingStore.phoneVerifiedUntil from the live Pulse */}
      {/* cookie so tile-tap booking flows skip the redundant OTP gate. */}
      <PulseBookingPhonePrime />

      <main className="mx-auto max-w-2xl space-y-4 px-4 pb-20 pt-5">
        {/* T90 Slice 2 Step 11 — Greeting zone. Date + time-aware */}
        {/* greeting (server-rendered) + viewing sub-line (client, */}
        {/* conditional). Drops the old blue-band greeting card. */}
        <header className="space-y-0.5">
          <p className="text-xs uppercase tracking-wider text-gray-500">
            {formatIST(new Date(), "dateLong")}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            {greeting}
          </h1>
          <ViewingSubLine />
        </header>

        {/* T90 Slice 2 Step 11 — Tile grid (Surface 6 hero zone). */}
        {/* 4 booking entries, 2×2 on every breakpoint. */}
        <PulseHomeTiles />

        {/* T90 Slice 2 Step 11 — Snapshot section divider. Label */}
        {/* tracks the active viewing target via MemberViewingContext. */}
        <SnapshotDivider />

        {/* Today's vitals tile */}
        <SectionReveal>
          <section className="rounded-2xl bg-white p-4 shadow-md">
            <TileHeader title="Today's vitals">
              <Link
                href="/pulse/vitals?add=bp"
                className="inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary"
              >
                <Plus className="h-3 w-3" />
                Log
              </Link>
            </TileHeader>

            {vitalsToShow.length === 0 ? (
              <Link
                href="/pulse/vitals?add=bp"
                className="block py-2 text-sm text-text-secondary"
              >
                No readings yet — log your first to start tracking.
              </Link>
            ) : (
              <div className="divide-y divide-slate-100">
                {vitalsToShow.map((r) => (
                  <VitalRow key={r.id} reading={r} />
                ))}
              </div>
            )}
          </section>
        </SectionReveal>

        {/* Today's medications tile */}
        <SectionReveal delay={80}>
          <section className="rounded-2xl bg-white p-4 shadow-md">
            <TileHeader
              title={
                dueCount > 0 ? (
                  <span className="inline-flex items-baseline gap-1">
                    Medications —{" "}
                    <AnimatedCounter value={dueCount} className="tabular-nums" />{" "}
                    due today
                  </span>
                ) : (
                  "Medications"
                )
              }
            >
              <Link
                href="/pulse/medications"
                className="inline-flex items-center gap-0.5 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary"
              >
                View all
                <ChevronRight className="h-3 w-3" />
              </Link>
            </TileHeader>

            {dueCount === 0 ? (
              <Link
                href="/pulse/medications"
                className="block py-2 text-sm text-text-secondary"
              >
                No doses scheduled today. Add a medicine to get started.
              </Link>
            ) : (
              <>
                <div className="divide-y divide-slate-100">
                  {todaySchedule.slice(0, 3).map((dose) => {
                    const visual = doseVisual(dose);
                    return (
                      <div
                        key={dose.intake_id}
                        className="flex items-center gap-3 py-2.5"
                      >
                        <span
                          className={
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 " +
                            (visual === "taken"
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : visual === "missed"
                                ? "border-rose-400 bg-rose-50"
                                : "border-slate-300 bg-white")
                          }
                        >
                          {visual === "taken" && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <div className="flex-1">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                            {formatIST(dose.scheduled_at, "time")}
                          </div>
                          <div
                            className={
                              "text-sm font-semibold " +
                              (visual === "missed"
                                ? "text-slate-400 line-through decoration-2 decoration-rose-400"
                                : "text-text-main")
                            }
                          >
                            {dose.name}{" "}
                            <span
                              className={
                                "font-normal " +
                                (visual === "missed" ? "" : "text-text-secondary")
                              }
                            >
                              {dose.dose}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {dueCount > 0 && (
                  <p className="mt-2 text-xs text-text-secondary">
                    {takenCount} of {dueCount} taken today.{" "}
                    <Link
                      href="/pulse/medications"
                      className="font-semibold text-primary"
                    >
                      Mark doses →
                    </Link>
                  </p>
                )}
              </>
            )}
          </section>
        </SectionReveal>

        {/* T64: Family Members tile — between Medications and Recent. */}
        <SectionReveal delay={160}>
          <section className="rounded-2xl bg-white p-4 shadow-md">
            <TileHeader title="Family">
              <Link
                href="/pulse/family-members"
                className="inline-flex items-center gap-0.5 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary"
              >
                Manage
                <ChevronRight className="h-3 w-3" />
              </Link>
            </TileHeader>

            {familyCount === 0 ? (
              <Link
                href="/pulse/family-members"
                className="block py-2 text-sm text-text-secondary"
              >
                Add family members to book on their behalf.
              </Link>
            ) : (
              <Link
                href="/pulse/family-members"
                className="flex items-center gap-3 py-2 text-sm font-medium text-text-main hover:opacity-90"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary">
                  <Users className="h-4 w-4" />
                </span>
                <span>
                  {familyCount} family member
                  {familyCount === 1 ? "" : "s"}
                </span>
              </Link>
            )}
          </section>
        </SectionReveal>

        {/* Recent activity */}
        {recent.length > 0 && (
          <SectionReveal delay={240}>
            <section>
              <h2 className="mb-2 ml-1 text-sm font-bold text-text-main">
                Recent activity
              </h2>
              <div className="rounded-2xl bg-white p-2 shadow-sm">
                {recent.map((item) => {
                  const inner = (
                    <div className="flex items-center gap-3 px-2 py-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary">
                        <FileText className="h-4 w-4" />
                      </span>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-text-main">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {formatIST(item.when, "datetime")}
                        </div>
                      </div>
                      {item.patient_view_token && (
                        <span className="text-xs font-semibold text-primary">
                          View
                        </span>
                      )}
                    </div>
                  );
                  return item.patient_view_token ? (
                    <Link
                      key={item.id}
                      href={`/rx/${item.patient_view_token}`}
                      className="block rounded-xl hover:bg-slate-50"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={item.id}>{inner}</div>
                  );
                })}
              </div>
            </section>
          </SectionReveal>
        )}

        {/* T90 Slice 2 Step 16 — PWA install prompt (Surface 7). */}
        {/* Inline card at the bottom of the zone stack. Renders null */}
        {/* unless eligibility passes (>=2 sessions, not recently */}
        {/* dismissed, not already installed, capable browser). */}
        <PWAInstallPrompt />
      </main>
    </div>
  );
}

function TileHeader({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <span className="text-xs font-bold uppercase tracking-wide text-text-secondary">
        {title}
      </span>
      {children}
    </div>
  );
}

function VitalRow({ reading }: { reading: VitalReading }) {
  const meta = VITAL_META[reading.kind];
  const trend = classifyVital(reading);
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary">
          {kindIcon(reading.kind)}
        </span>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {meta.label}
          </div>
          <div className="text-base font-bold text-text-main">
            {formatVitalValue(reading)}{" "}
            <span className="text-xs font-medium text-slate-400">
              {meta.unit}
            </span>
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className={"text-xs font-semibold " + trendTextClass(trend)}>
          ●
        </div>
        <div className="mt-0.5 text-[10px] text-slate-400">
          {formatIST(reading.taken_at, "relativeShort")}
        </div>
      </div>
    </div>
  );
}
