import type { Metadata } from "next";
import Image from "next/image";
import { Download, FileX, AlertTriangle, FileText } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isValidRxPatientViewTokenFormat } from "@/lib/rx/tokens";

// =====================================================================
// Patient-facing prescription view at /rx/<token>.
//
// Public route — NO auth required. The token IS the auth.
//   - 32 hex chars (128 bits) of entropy
//   - Bound to a single prescriptions row via partial UNIQUE index
//   - Cleared when the Rx is voided (so /rx/<token> immediately stops
//     serving even though the PDF object stays in storage)
//
// The PDF itself streams from /rx/<token>/pdf — a route handler that
// re-checks the token, mints a 60-second signed URL on the
// prescriptions bucket, and proxies the bytes through our domain. The
// page just renders an HTML wrapper with a "Download" link and an
// inline <iframe> preview.
//
// Failure modes:
//   - bad format / unknown token → "not found" surface
//   - status='voided'            → "revoked" surface
//   - status='superseded'        → "amended" surface (with explainer)
//   - status='draft'             → "not yet sent" (shouldn't normally
//                                  happen — drafts have NULL token —
//                                  defensive)
// =====================================================================

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Your prescription · Sanocare",
  robots: { index: false, follow: false },
};

type LookupResult =
  | { kind: "ok"; row: SentRx }
  | { kind: "not_found" }
  | { kind: "voided"; reason: string | null }
  | { kind: "superseded" }
  | { kind: "draft" };

type SentRx = {
  prescription_code: string;
  version: number;
  patient_name: string;
  sent_at: string | null;
  doctor_name: string;
};

async function lookupByToken(token: string): Promise<LookupResult> {
  if (!isValidRxPatientViewTokenFormat(token)) return { kind: "not_found" };

  const { data, error } = await supabaseAdmin
    .from("prescriptions")
    .select(
      "prescription_code, version, status, patient_name, sent_at, void_reason, doctor:doctors(full_name)",
    )
    .eq("patient_view_token", token)
    .maybeSingle();
  if (error || !data) return { kind: "not_found" };

  const row = data as unknown as {
    prescription_code: string;
    version: number;
    status: "draft" | "sent" | "superseded" | "voided";
    patient_name: string;
    sent_at: string | null;
    void_reason: string | null;
    doctor: { full_name: string } | null;
  };

  if (row.status === "voided") {
    return { kind: "voided", reason: row.void_reason };
  }
  if (row.status === "superseded") {
    return { kind: "superseded" };
  }
  if (row.status === "draft") {
    return { kind: "draft" };
  }

  return {
    kind: "ok",
    row: {
      prescription_code: row.prescription_code,
      version: row.version,
      patient_name: row.patient_name,
      sent_at: row.sent_at,
      doctor_name: row.doctor?.full_name ?? "your doctor",
    },
  };
}

export default async function PatientRxView({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await lookupByToken(token);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.svg"
              alt="Sanocare"
              width={28}
              height={28}
              className="w-7 h-7"
            />
            <div className="text-sm font-bold text-slate-900">Sanocare</div>
          </div>
          {result.kind === "ok" && (
            <a
              href={`/rx/${token}/pdf`}
              className="inline-flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-md"
              download={`${result.row.prescription_code}.pdf`}
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {result.kind === "ok" ? <ValidView token={token} row={result.row} /> : null}
        {result.kind === "not_found" ? <NotFoundView /> : null}
        {result.kind === "voided" ? <VoidedView reason={result.reason} /> : null}
        {result.kind === "superseded" ? <SupersededView /> : null}
        {result.kind === "draft" ? <DraftView /> : null}
      </main>

      <footer className="max-w-3xl mx-auto px-4 py-6 text-center text-[11px] text-slate-400">
        Sanocare · sanocare.in · This page is for the named patient only.
      </footer>
    </div>
  );
}

function ValidView({ token, row }: { token: string; row: SentRx }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-1">
          Prescription · {row.prescription_code}
          {row.version > 1 ? ` · v${row.version}` : ""}
        </div>
        <h1 className="text-xl font-bold text-slate-900">{row.patient_name}</h1>
        <div className="text-sm text-slate-600 mt-1">
          From {row.doctor_name}
          {row.sent_at && ` · ${formatWhen(row.sent_at)}`}
        </div>
      </div>

      {/* Inline preview — phone browsers render the PDF natively in
          most cases. If the iframe fails (older Safari, etc.), the
          Download button above still works. */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <iframe
          src={`/rx/${token}/pdf`}
          title="Prescription preview"
          className="w-full"
          style={{ height: "80vh", border: 0 }}
        />
      </div>

      <div className="text-xs text-slate-500 px-1">
        Tap <strong>Download</strong> above to save the PDF. If the preview
        doesn&apos;t load, the download still works.
      </div>
    </div>
  );
}

function NotFoundView() {
  return (
    <CenteredCard
      icon={<FileX className="w-10 h-10 text-slate-400 mx-auto mb-3" />}
      title="Prescription not found"
      subtitle="This link doesn't match any prescription on file. Check that you opened the latest WhatsApp message — older links may have been replaced."
    />
  );
}

function VoidedView({ reason }: { reason: string | null }) {
  return (
    <CenteredCard
      icon={<AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-3" />}
      title="Prescription revoked"
      subtitle={
        reason
          ? `This prescription has been revoked. Reason: ${reason}. Contact your doctor for a fresh script.`
          : "This prescription has been revoked. Contact your doctor for a fresh script."
      }
    />
  );
}

function SupersededView() {
  return (
    <CenteredCard
      icon={<FileText className="w-10 h-10 text-amber-500 mx-auto mb-3" />}
      title="This prescription was amended"
      subtitle="An updated version has been issued. Check your WhatsApp for the latest link — the new one supersedes this older copy."
    />
  );
}

function DraftView() {
  return (
    <CenteredCard
      icon={<FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />}
      title="Not yet ready"
      subtitle="This prescription is still being prepared. Please wait for the WhatsApp confirmation message."
    />
  );
}

function CenteredCard({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
      {icon}
      <h2 className="text-lg font-semibold text-slate-900 mb-2">{title}</h2>
      <p className="text-sm text-slate-600 max-w-md mx-auto">{subtitle}</p>
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
