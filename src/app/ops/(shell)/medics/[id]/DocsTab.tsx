"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

// T65 Phase 2B C4 — Documents tab.
//
// Each doc_type gets its own section with: existing (non-deleted) docs
// + an upload widget. Click an existing row → fetch signed URL → open
// new tab (the backend route INSERTs a medic_doc_access_log entry).
// Delete button (admin only) → soft delete with confirmation.

const DOC_TYPES: Array<{
  key: string;
  label: string;
  hint?: string;
}> = [
  { key: "gnm_cert", label: "GNM certificate" },
  { key: "bsc_cert", label: "B.Sc Nursing certificate" },
  { key: "registration_card", label: "Council registration card" },
  { key: "aadhar", label: "Aadhar", hint: "PII — keep secure" },
  { key: "pan", label: "PAN", hint: "PII — keep secure" },
  { key: "photo", label: "Photo" },
  { key: "address_proof", label: "Address proof" },
  { key: "offer_letter", label: "Offer letter" },
  { key: "payout_proof", label: "Payout proofs", hint: "Surfaced via Settle modal" },
  { key: "other", label: "Other" },
];

const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export type MedicDoc = {
  id: string;
  doc_type: string;
  file_path: string;
  file_size_bytes: number;
  mime_type: string;
  label: string | null;
  uploaded_at: string;
  uploaded_by_name: string | null;
};

interface DocsTabProps {
  medicId: string;
  docs: MedicDoc[];
  isAdmin: boolean;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function formatISTish(iso: string): string {
  // Lightweight client-side IST format — we don't import formatIST here
  // because the tab is client-component and formatIST is server-safe but
  // not bundle-sized for one display. Showing the ISO date + time is fine
  // for ops who already think in IST.
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
  } catch {
    return iso;
  }
}

export function DocsTab({ medicId, docs, isAdmin }: DocsTabProps) {
  const docsByType = new Map<string, MedicDoc[]>();
  for (const d of docs) {
    const arr = docsByType.get(d.doc_type) ?? [];
    arr.push(d);
    docsByType.set(d.doc_type, arr);
  }

  return (
    <div className="space-y-6">
      {DOC_TYPES.map((dt) => (
        <DocSection
          key={dt.key}
          medicId={medicId}
          docType={dt.key}
          label={dt.label}
          hint={dt.hint}
          docs={docsByType.get(dt.key) ?? []}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  );
}

function DocSection({
  medicId,
  docType,
  label,
  hint,
  docs,
  isAdmin,
}: {
  medicId: string;
  docType: string;
  label: string;
  hint?: string;
  docs: MedicDoc[];
  isAdmin: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
          {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
        </div>
        {isAdmin && <UploadButton medicId={medicId} docType={docType} />}
      </div>
      {docs.length === 0 ? (
        <div className="px-6 py-6 text-sm text-slate-500">
          No file uploaded.
        </div>
      ) : (
        <ul>
          {docs.map((d) => (
            <DocRow
              key={d.id}
              medicId={medicId}
              doc={d}
              isAdmin={isAdmin}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadButton({ medicId, docType }: { medicId: string; docType: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const onPick = () => {
    setErr(null);
    fileRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Reset input so re-picking same file fires onChange again.
    e.target.value = "";

    if (!ALLOWED_MIMES.includes(f.type)) {
      setErr("File type not allowed. JPEG, PNG, WebP, or PDF only.");
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setErr(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`);
      return;
    }

    const fd = new FormData();
    fd.set("file", f);
    fd.set("doc_type", docType);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/ops/medics/${medicId}/docs`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErr(`Upload failed: ${body.error ?? res.statusText}`);
          return;
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Upload failed.");
      }
    });
  };

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept={ALLOWED_MIMES.join(",")}
        className="hidden"
        onChange={onFile}
      />
      <button
        type="button"
        onClick={onPick}
        disabled={pending}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload"}
      </button>
      {err && <p className="mt-1 text-xs text-red-600 text-right">{err}</p>}
    </div>
  );
}

function DocRow({
  medicId,
  doc,
  isAdmin,
}: {
  medicId: string;
  doc: MedicDoc;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [deleting, startDelete] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openSignedUrl = async () => {
    setErr(null);
    setOpening(true);
    try {
      const res = await fetch(
        `/api/ops/medics/${medicId}/docs/${doc.id}/signed-url`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(`Could not open: ${body.error ?? res.statusText}`);
        return;
      }
      const { url } = await res.json();
      if (typeof url === "string") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Open failed.");
    } finally {
      setOpening(false);
    }
  };

  const confirmDelete = () => {
    setErr(null);
    startDelete(async () => {
      try {
        const res = await fetch(`/api/ops/medics/${medicId}/docs/${doc.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErr(`Delete failed: ${body.error ?? res.statusText}`);
          return;
        }
        setConfirming(false);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  };

  // Extract filename from file_path tail for display.
  const filename = doc.file_path.split("/").pop() ?? doc.file_path;
  const displayName = doc.label ?? filename.replace(/^[0-9a-f-]+-/, "");

  return (
    <li className="px-6 py-3 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={openSignedUrl}
          disabled={opening}
          className="block text-sm text-slate-900 hover:underline text-left truncate disabled:opacity-50"
          title={filename}
        >
          {opening ? "Opening…" : displayName}
        </button>
        <div className="mt-0.5 text-xs text-slate-500">
          {formatBytes(doc.file_size_bytes)} · {doc.mime_type} ·{" "}
          {formatISTish(doc.uploaded_at)}
          {doc.uploaded_by_name && (
            <> · uploaded by {doc.uploaded_by_name}</>
          )}
        </div>
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </div>
      {isAdmin && (
        <div>
          {confirming ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="text-xs text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-xs text-red-600 hover:text-red-700 hover:underline"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </li>
  );
}
