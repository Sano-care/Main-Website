import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createOpsRSCClient } from "@/lib/supabase-rsc";
import { getCurrentOpsUser } from "../../../_lib/getCurrentOpsUser";
import { formatIST } from "@/lib/time/formatIST";
import { ProfileTab } from "./ProfileTab";
import { TabPlaceholder } from "./TabPlaceholder";
import { DocsTab, type MedicDoc } from "./DocsTab";

export const metadata: Metadata = {
  title: "Ops · Medic detail",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

// T65 Phase 2B C3-full — Medic detail page with 5-tab nav.
//
// URL: /ops/medics/[id]?tab=profile|docs|payout|attendance|location
// Default tab: profile. Tab navigation is plain anchor links (?tab=
// param swap) — no client state. Each tab body renders independently;
// the surrounding header + tab bar render once per request.
//
// Profile tab is live in C3-full. Docs/Payout/Attendance/Location render
// placeholders pointing at C4/C5a/C5b.

type MedicDetail = {
  id: string;
  full_name: string;
  phone: string;
  qualification: "GNM" | "B.Sc Nursing";
  license_number: string | null;
  hire_date: string | null;
  active: boolean;
  created_at: string;
};

type Tab = "profile" | "docs" | "payout" | "attendance" | "location";
const VALID_TABS: Tab[] = ["profile", "docs", "payout", "attendance", "location"];

const TAB_LABELS: Record<Tab, string> = {
  profile: "Profile",
  docs: "Documents",
  payout: "Payout",
  attendance: "Attendance",
  location: "Location",
};

export default async function MedicDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; medic_added?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const tab: Tab = (VALID_TABS as string[]).includes(sp.tab ?? "")
    ? (sp.tab as Tab)
    : "profile";
  const showAddedToast = sp.medic_added === "1";

  const opsUser = await getCurrentOpsUser();
  const isAdmin = opsUser.role === "admin";

  const supabase = await createOpsRSCClient();
  const { data: medicData, error } = await supabase
    .from("medics")
    .select("id, full_name, phone, qualification, license_number, hire_date, active, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[ops/medics/[id]] lookup failed", error);
  }
  if (!medicData) notFound();
  const medic = medicData as MedicDetail;

  // Last-seen via location pings. Best-effort; doesn't block render.
  const { data: lastPing } = await supabase
    .from("medic_location_pings")
    .select("pinged_at")
    .eq("medic_id", id)
    .order("pinged_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Docs for the Documents tab. Fetched server-side regardless of which
  // tab is active so SSR-rendered counts are immediately accurate when
  // tabs are switched. Soft-deleted rows filtered by deleted_at IS NULL.
  let docs: MedicDoc[] = [];
  if (tab === "docs") {
    const { data: docRows } = await supabase
      .from("medic_documents")
      .select(
        "id, doc_type, file_path, file_size_bytes, mime_type, label, uploaded_at, uploaded_by",
      )
      .eq("medic_id", id)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false });
    const rows = (docRows ?? []) as Array<{
      id: string;
      doc_type: string;
      file_path: string;
      file_size_bytes: number;
      mime_type: string;
      label: string | null;
      uploaded_at: string;
      uploaded_by: string | null;
    }>;
    // Resolve uploader names (small batch lookup).
    const uploaderIds = Array.from(
      new Set(rows.map((r) => r.uploaded_by).filter((x): x is string => !!x)),
    );
    const uploaderNameById = new Map<string, string>();
    if (uploaderIds.length > 0) {
      const { data: uploaders } = await supabase
        .from("ops_users")
        .select("id, full_name")
        .in("id", uploaderIds);
      for (const u of (uploaders ?? []) as Array<{
        id: string;
        full_name: string;
      }>) {
        uploaderNameById.set(u.id, u.full_name);
      }
    }
    docs = rows.map((r) => ({
      id: r.id,
      doc_type: r.doc_type,
      file_path: r.file_path,
      file_size_bytes: r.file_size_bytes,
      mime_type: r.mime_type,
      label: r.label,
      uploaded_at: r.uploaded_at,
      uploaded_by_name: r.uploaded_by
        ? uploaderNameById.get(r.uploaded_by) ?? null
        : null,
    }));
  }

  return (
    <div className="px-8 py-8 max-w-4xl">
      {showAddedToast && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          ✓ Medic added — they can now sign in via the Sanocare Medic Android app with their phone.
        </div>
      )}

      <div className="mb-2">
        <Link
          href="/ops/medics"
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          ← All medics
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{medic.full_name}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-600">
            <span>{medic.qualification}</span>
            <span className="text-slate-300">·</span>
            <span className="font-mono">{medic.phone}</span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                medic.active
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-slate-100 text-slate-600 border border-slate-200"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  medic.active ? "bg-green-500" : "bg-slate-400"
                }`}
              />
              {medic.active ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Last seen:{" "}
            {lastPing?.pinged_at
              ? formatIST(lastPing.pinged_at, "relativeShort")
              : "Never"}
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="border-b border-slate-200 mb-6 -mx-8 px-8">
        <nav className="flex gap-1">
          {VALID_TABS.map((t) => {
            const active = tab === t;
            return (
              <Link
                key={t}
                href={`/ops/medics/${id}?tab=${t}`}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                }`}
              >
                {TAB_LABELS[t]}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Tab body */}
      {tab === "profile" && <ProfileTab medic={medic} isAdmin={isAdmin} />}
      {tab === "docs" && (
        <DocsTab medicId={id} docs={docs} isAdmin={isAdmin} />
      )}
      {tab === "payout" && <TabPlaceholder title="Payout" comingIn="C5a" />}
      {tab === "attendance" && (
        <TabPlaceholder title="Attendance" comingIn="C5b" />
      )}
      {tab === "location" && <TabPlaceholder title="Location" comingIn="C5b" />}
    </div>
  );
}
