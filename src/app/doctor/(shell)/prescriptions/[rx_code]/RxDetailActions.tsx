"use client";

// Amend / void buttons for the Rx detail page.
//
// AmendButton: clicking forks a new draft (v+1) and redirects to the
// composer for the parent's session_id. Server action handles the
// inheritance of the prescription_code and the version bump.
//
// VoidButton: inline modal-style confirmation with a reason field;
// posts to voidPrescription on confirm.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileX, History, Loader2, AlertCircle } from "lucide-react";
import {
  amendPrescription,
  voidPrescription,
} from "../../../_actions/prescription";

export function AmendButton({ prescriptionId }: { prescriptionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("prescription_id", prescriptionId);
      const r = await amendPrescription(fd);
      if (r.ok) {
        router.push(`/doctor/prescriptions`);
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 text-xs bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 px-3 py-1.5 rounded-md"
      >
        {pending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <History className="w-3 h-3" />
        )}
        {pending ? "Amending…" : "Amend"}
      </button>
      {error && (
        <div className="text-[10px] text-rose-700 flex items-center gap-1 max-w-[260px]">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

export function VoidButton({ prescriptionId }: { prescriptionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("prescription_id", prescriptionId);
      fd.set("void_reason", reason);
      const r = await voidPrescription(fd);
      if (r.ok) {
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-1.5 rounded-md border border-rose-200"
      >
        <FileX className="w-3 h-3" /> Void
      </button>
    );
  }

  return (
    <div className="absolute right-6 mt-12 z-10 w-80 rounded-lg border border-rose-200 bg-white shadow-lg p-4">
      <div className="text-sm font-semibold text-rose-700 mb-2">
        Void this prescription?
      </div>
      <p className="text-xs text-slate-600 mb-3">
        Voiding revokes the patient&apos;s link immediately. The PDF is kept
        for medical-record retention but no longer served. Reason is logged
        for audit.
      </p>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (visible in audit log)"
        className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 mb-2 focus:outline-none focus:ring-2 focus:ring-rose-500"
      />
      {error && (
        <div className="flex items-start gap-1.5 text-xs text-rose-700 mb-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setReason("");
          }}
          disabled={pending}
          className="text-xs text-slate-600 hover:text-slate-900 px-2 py-1"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || reason.trim().length < 4}
          className="inline-flex items-center gap-1.5 text-xs bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-md"
        >
          {pending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <FileX className="w-3 h-3" />
          )}
          {pending ? "Voiding…" : "Confirm void"}
        </button>
      </div>
    </div>
  );
}
