"use client";

// Ops actions for a single Rx detail page.
//
// Resend WhatsApp (admin only — same restriction as Rampwin send paths
// elsewhere) and Download PDF (any ops user).
//
// Patient-view URL is also surfaced inline with a copy button so the
// ops user can paste it into a WhatsApp / SMS / email manually when
// the BSP path is wedged.

import { useState, useTransition } from "react";
import {
  Copy,
  Send,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { resendRxWhatsApp, getRxPdfSignedUrl } from "../actions";

export function RxOpsActions({
  prescriptionId,
  status,
  whatsappSentAt,
  rxUrl,
  hasPdf,
}: {
  prescriptionId: string;
  status: "draft" | "sent" | "superseded" | "voided";
  whatsappSentAt: string | null;
  rxUrl: string | null;
  hasPdf: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [resendPending, startResendTransition] = useTransition();
  const [resendResult, setResendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pdfPending, startPdfTransition] = useTransition();
  const [pdfError, setPdfError] = useState<string | null>(null);

  const onResend = () => {
    setResendResult(null);
    startResendTransition(async () => {
      const fd = new FormData();
      fd.set("prescription_id", prescriptionId);
      const r = await resendRxWhatsApp(fd);
      setResendResult(
        r.ok
          ? { ok: true, msg: "WhatsApp resent." }
          : { ok: false, msg: r.error },
      );
    });
  };

  const onDownload = () => {
    setPdfError(null);
    startPdfTransition(async () => {
      const url = await getRxPdfSignedUrl(prescriptionId);
      if (!url) {
        setPdfError("Could not generate signed URL for the PDF.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    });
  };

  const onCopy = () => {
    if (!rxUrl) return;
    navigator.clipboard.writeText(rxUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex flex-col items-end gap-2 max-w-md">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {hasPdf && (
          <button
            type="button"
            onClick={onDownload}
            disabled={pdfPending}
            className="inline-flex items-center gap-1.5 text-xs bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 px-3 py-1.5 rounded-md"
          >
            {pdfPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            {pdfPending ? "Signing…" : "Download PDF"}
          </button>
        )}
        {status === "sent" && (
          <button
            type="button"
            onClick={onResend}
            disabled={resendPending}
            className={
              "inline-flex items-center gap-1.5 text-xs disabled:opacity-50 px-3 py-1.5 rounded-md " +
              (whatsappSentAt
                ? "bg-slate-100 hover:bg-slate-200 text-slate-800"
                : "bg-emerald-600 hover:bg-emerald-700 text-white")
            }
          >
            {resendPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            {resendPending
              ? "Resending…"
              : whatsappSentAt
                ? "Resend WhatsApp"
                : "Send WhatsApp"}
          </button>
        )}
      </div>

      {rxUrl && status === "sent" && (
        <div className="w-full rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px]">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
            Patient view URL
          </div>
          <div className="flex items-center gap-1.5">
            <code className="font-mono text-[10px] break-all flex-1">
              {rxUrl}
            </code>
            <button
              type="button"
              onClick={onCopy}
              className="text-[10px] bg-slate-900 hover:bg-slate-800 text-white px-2 py-0.5 rounded"
            >
              <Copy className="w-2.5 h-2.5 inline mr-0.5" />
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={rxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-slate-700 hover:text-slate-900 px-1"
            >
              <ExternalLink className="w-2.5 h-2.5 inline" />
            </a>
          </div>
        </div>
      )}

      {resendResult && (
        <div
          className={
            "rounded-md px-2 py-1.5 text-xs flex items-start gap-1.5 max-w-[300px] " +
            (resendResult.ok
              ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
              : "bg-rose-50 border border-rose-200 text-rose-800")
          }
        >
          {resendResult.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          )}
          <span>{resendResult.msg}</span>
        </div>
      )}
      {pdfError && (
        <div className="rounded-md px-2 py-1.5 text-xs bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-1.5 max-w-[300px]">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{pdfError}</span>
        </div>
      )}
    </div>
  );
}
