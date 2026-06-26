"use client";

import { useRef, useState } from "react";
import { Plus, Upload, Loader2, X } from "lucide-react";

import type { FamilyMember } from "@/lib/family-members/types";
import { docTypeLabel } from "./recordsDisplay";

// Pulse A2 — upload control on the "Your records" Documents section. Posts a
// multipart file to POST /api/pulse/documents (the route + shared
// vaultDocumentBytes core own validation, the IDOR member guard, storage +
// the row). On success the parent refreshes the records list.
//
// Raw fetch (not pulseFetch) so the browser sets the multipart boundary
// Content-Type itself — pulseFetch forces application/json when a body is
// present, which corrupts a multipart upload.

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const ACCEPT_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MAX_BYTES = 10 * 1024 * 1024;

const DOC_TYPES = [
  "lab_report",
  "prescription",
  "imaging",
  "discharge_summary",
  "other",
] as const;

export default function AddDocumentForm({
  members,
  defaultMemberId,
  onUploaded,
}: {
  members: FamilyMember[];
  /** family_members.id to pre-select, or null for the account holder. */
  defaultMemberId: string | null;
  onUploaded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>("other");
  const [label, setLabel] = useState("");
  const [memberId, setMemberId] = useState<string>(defaultMemberId ?? "self");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setDocType("other");
    setLabel("");
    setMemberId(defaultMemberId ?? "self");
    setError(null);
    setSubmitting(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    reset();
    setOpen(false);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setError(null);
    if (f && !ACCEPT_MIMES.has(f.type)) {
      setFile(null);
      setError("Choose a JPG, PNG, WEBP, or PDF.");
      return;
    }
    if (f && f.size > MAX_BYTES) {
      setFile(null);
      setError("That file is too large (max 10 MB).");
      return;
    }
    setFile(f);
  }

  async function handleUpload() {
    if (!file || submitting) return;
    setSubmitting(true);
    setError(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", docType);
    if (label.trim()) fd.append("label", label.trim());
    if (memberId && memberId !== "self") fd.append("member_id", memberId);

    try {
      const res = await fetch("/api/pulse/documents", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Couldn't upload. Please try again.");
        setSubmitting(false);
        return;
      }
      onUploaded();
      close();
    } catch (err) {
      console.error("[pulse/records] document upload failed", err);
      setError("Couldn't upload. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary hover:bg-blue-100"
      >
        <Plus className="h-3.5 w-3.5" />
        Add a document
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-text-secondary">
          Add a document
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="Cancel"
          className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <label className="block">
        <span className="sr-only">Choose a file</span>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          onChange={onPick}
          className="block w-full text-xs text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-primary hover:file:bg-blue-100"
        />
      </label>
      <p className="mt-1 text-[11px] text-text-secondary">JPG, PNG, WEBP, or PDF · up to 10 MB</p>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            Type
          </span>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as (typeof DOC_TYPES)[number])}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {docTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            For
          </span>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          >
            <option value="self">Myself</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-2 block">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          Label <span className="font-normal normal-case">(optional)</span>
        </span>
        <input
          type="text"
          value={label}
          maxLength={120}
          placeholder="e.g. CBC report June"
          onChange={(e) => setLabel(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
        />
      </label>

      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}

      <button
        type="button"
        disabled={!file || submitting}
        onClick={handleUpload}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <Upload className="h-4 w-4" />
            Upload to my records
          </>
        )}
      </button>
    </div>
  );
}
