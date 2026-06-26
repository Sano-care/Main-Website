"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Upload, Loader2, X, FileText } from "lucide-react";

import type { FamilyMember } from "@/lib/family-members/types";
import { useScrollLock } from "@/hooks/useScrollLock";
import { docTypeLabel, formatFileSize } from "./recordsDisplay";

// R1 — the Documents upload, re-skinned from the inline AddDocumentForm into a
// styled modal: drop/select zone, doc-type + family-member + label, primary
// Upload with loading/error states. Behaviour is UNCHANGED — same raw multipart
// POST /api/pulse/documents (NOT pulseFetch, so the browser sets the multipart
// boundary), same fields, same server-side IDOR member guard. On success the
// parent refreshes. Traps focus, closes on Esc + backdrop.
//
// The dialog body mounts fresh each open (the parent gates on `open`), so its
// useState initial values ARE the reset — no re-seed effect.

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const ACCEPT_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BYTES = 10 * 1024 * 1024;

const DOC_TYPES = ["lab_report", "prescription", "imaging", "discharge_summary", "other"] as const;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function UploadDocumentModal({
  open,
  onClose,
  members,
  defaultMemberId,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  members: FamilyMember[];
  /** family_members.id to pre-select, or null for the account holder. */
  defaultMemberId: string | null;
  onUploaded: () => void;
}) {
  if (!open) return null;
  return (
    <UploadDialog
      onClose={onClose}
      members={members}
      defaultMemberId={defaultMemberId}
      onUploaded={onUploaded}
    />
  );
}

function UploadDialog({
  onClose,
  members,
  defaultMemberId,
  onUploaded,
}: {
  onClose: () => void;
  members: FamilyMember[];
  defaultMemberId: string | null;
  onUploaded: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  useScrollLock(true);

  const dialogRef = useRef<HTMLDivElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>("other");
  const [label, setLabel] = useState("");
  const [memberId, setMemberId] = useState<string>(defaultMemberId ?? "self");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Focus the dialog on mount (open).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Esc closes; Tab is trapped inside the dialog. addEventListener only — no
  // setState in the effect body.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const node = dialogRef.current;
      if (e.key === "Escape" && !submitting) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [submitting, onClose]);

  function pickFile(f: File | null) {
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
      onClose();
    } catch (err) {
      console.error("[pulse/records] document upload failed", err);
      setError("Couldn't upload. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={submitting ? undefined : onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
      />

      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Upload a document"
        tabIndex={-1}
        className="relative flex max-h-[92vh] w-full flex-col overflow-y-auto bg-white outline-none sm:max-w-md sm:rounded-3xl sm:shadow-2xl"
        initial={prefersReducedMotion ? false : { y: "100%", opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h2 className="text-base font-bold text-text-main">Upload a document</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-secondary hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 px-5 py-4">
          {/* Drop / select zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              pickFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={
              "rounded-2xl border-2 border-dashed p-5 text-center transition-colors " +
              (dragActive ? "border-primary bg-primary-50" : "border-slate-300 bg-slate-50")
            }
          >
            {file ? (
              <div className="flex items-center justify-center gap-2 text-sm font-medium text-text-main">
                <FileText className="h-4 w-4 text-primary" />
                <span className="truncate">{file.name}</span>
                <span className="font-mono text-xs text-text-secondary">
                  {formatFileSize(file.size)}
                </span>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">Drag a file here, or choose one below.</p>
            )}
            <label className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary hover:bg-blue-100">
              <Upload className="h-3.5 w-3.5" />
              {file ? "Choose a different file" : "Choose a file"}
              <input
                type="file"
                accept={ACCEPT}
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
            <p className="mt-2 text-[11px] text-text-secondary">
              JPG, PNG, WEBP, or PDF · up to 10 MB
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                Type
              </span>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as (typeof DOC_TYPES)[number])}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
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
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
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

          <label className="mt-3 block">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              Label <span className="font-normal normal-case">(optional)</span>
            </span>
            <input
              type="text"
              value={label}
              maxLength={120}
              placeholder="e.g. CBC report June"
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </label>

          {error ? (
            <p className="mt-3 text-sm text-rose-600" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="sticky bottom-0 border-t border-slate-100 bg-white px-5 py-4">
          <button
            type="button"
            disabled={!file || submitting}
            onClick={handleUpload}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
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
      </motion.div>
    </div>
  );
}
