import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Send, FileX, History, CheckCircle2, AlertCircle } from "lucide-react";
import { getDoctorPrescriptionsList } from "../../_lib/prescriptionData";

export const metadata: Metadata = {
  title: "My prescriptions · Sanocare",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function DoctorPrescriptionsList() {
  const all = await getDoctorPrescriptionsList();

  // Group by status. We always want drafts at the top (they need
  // action), then sent (the live ones), then superseded + voided.
  const drafts = all.filter((r) => r.status === "draft");
  const sent = all.filter((r) => r.status === "sent");
  const superseded = all.filter((r) => r.status === "superseded");
  const voided = all.filter((r) => r.status === "voided");

  return (
    <div className="max-w-5xl mx-auto px-6 sm:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">My prescriptions</h1>
        <p className="text-sm text-slate-600 mt-1">
          Everything you&apos;ve drafted or sent. Latest version of each
          chain shown — open one to see prior versions.
        </p>
      </div>

      <Section
        title="Drafts"
        icon={<FileText className="w-3.5 h-3.5" />}
        items={drafts}
        empty="No drafts open."
        emphasis
      />
      <Section
        title="Sent"
        icon={<Send className="w-3.5 h-3.5" />}
        items={sent}
        empty="No prescriptions sent yet."
      />
      <Section
        title="Amended (superseded)"
        icon={<History className="w-3.5 h-3.5" />}
        items={superseded}
        empty="No amended prescriptions."
        muted
      />
      <Section
        title="Voided"
        icon={<FileX className="w-3.5 h-3.5" />}
        items={voided}
        empty="No voided prescriptions."
        muted
      />
    </div>
  );
}

type ListRow = Awaited<ReturnType<typeof getDoctorPrescriptionsList>>[number];

function Section({
  title,
  icon,
  items,
  empty,
  emphasis,
  muted,
}: {
  title: string;
  icon: React.ReactNode;
  items: ListRow[];
  empty: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={
        "mb-6 rounded-2xl border bg-white overflow-hidden " +
        (emphasis ? "border-amber-200" : "border-slate-200")
      }
    >
      <div
        className={
          "flex items-center justify-between px-6 py-3 border-b " +
          (emphasis
            ? "bg-amber-50 border-amber-200"
            : "bg-slate-50 border-slate-100")
        }
      >
        <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-slate-600">
          {icon}
          {title}
        </div>
        <div className="text-xs text-slate-500">{items.length}</div>
      </div>
      {items.length === 0 ? (
        <div className="px-6 py-4 text-sm text-slate-400">{empty}</div>
      ) : (
        <ul className={"divide-y divide-slate-100 " + (muted ? "opacity-70" : "")}>
          {items.map((r) => (
            <li key={r.id}>
              <Link
                href={
                  r.status === "draft"
                    ? `/doctor/sessions/${r.session_id}/prescribe`
                    : `/doctor/prescriptions/${r.prescription_code}`
                }
                className="block px-6 py-3 hover:bg-slate-50 flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-slate-900">
                      {r.prescription_code}
                    </span>
                    {r.version > 1 && (
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
                        v{r.version}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-700 truncate mt-0.5">
                    {r.patient_name}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-500">
                  {r.status === "sent" ? (
                    <div className="flex items-center gap-1.5 justify-end">
                      <span>{r.sent_at ? formatWhen(r.sent_at) : "—"}</span>
                      {r.whatsapp_sent_at ? (
                        <CheckCircle2
                          className="w-3.5 h-3.5 text-emerald-600"
                          aria-label="WhatsApp delivered"
                        />
                      ) : (
                        <AlertCircle
                          className="w-3.5 h-3.5 text-amber-600"
                          aria-label="WhatsApp not delivered"
                        />
                      )}
                    </div>
                  ) : (
                    <div>{formatWhen(r.created_at)}</div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
