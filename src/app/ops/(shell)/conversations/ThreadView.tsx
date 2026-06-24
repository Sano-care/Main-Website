"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, Phone } from "lucide-react";

import {
  redactPhone,
  telHref,
  type ConversationMeta,
  type ThreadItem,
} from "./types";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortModel(model: string | null): string {
  if (!model) return "";
  return model.replace("claude-", "").replace(/-\d{8}$/, "");
}

export function ThreadView({
  thread,
  meta,
  redact,
}: {
  thread: ThreadItem[];
  meta: ConversationMeta;
  redact: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [meta.id]);

  const phoneDisplay = redact ? redactPhone(meta.phone) : meta.phone;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/ops/conversations"
            scroll={false}
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Back to list"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <a
              href={telHref(meta.phone)}
              className="font-mono text-base font-semibold text-slate-900 hover:text-[#2B81FF]"
            >
              {phoneDisplay}
            </a>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
              <span>{meta.serviceIntent ?? "no intent"}</span>
              <span aria-hidden>·</span>
              <span>{meta.state}</span>
              <span aria-hidden>·</span>
              <span>escalation: {meta.escalationStatus}</span>
              {meta.optOut && (
                <span className="font-semibold text-rose-600">· OPTED OUT</span>
              )}
            </div>
          </div>
          <a
            href={telHref(meta.phone)}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2B81FF]/10 text-[#2B81FF] hover:bg-[#2B81FF]/20"
            aria-label="Call patient"
          >
            <Phone className="h-4 w-4" />
          </a>
        </div>

        {/* Stats strip */}
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span>
            <span className="font-semibold text-slate-700">{meta.messageCount}</span> messages
          </span>
          <span>
            <span className="font-semibold text-slate-700 tabular-nums">
              {meta.totalTokensOut.toLocaleString("en-IN")}
            </span>{" "}
            tokens out
          </span>
          {meta.modelsUsed.length > 0 && (
            <span>{meta.modelsUsed.map(shortModel).join(", ")}</span>
          )}
          <span>first seen {fmtTime(meta.firstSeenAt)}</span>
        </div>
      </div>

      {/* Thread */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-4">
        {thread.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No messages yet.</p>
        ) : (
          thread.map((item) =>
            item.kind === "message" ? (
              <MessageBubble key={`m-${item.id}`} item={item} />
            ) : (
              <AuditPill key={`a-${item.id}`} item={item} />
            ),
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageBubble({
  item,
}: {
  item: Extract<ThreadItem, { kind: "message" }>;
}) {
  const outbound = item.direction === "outbound";
  return (
    <div className={"flex " + (outbound ? "justify-end" : "justify-start")}>
      <div className="max-w-[85%] sm:max-w-[70%]">
        <div
          className={
            "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm " +
            (outbound
              ? "rounded-br-sm bg-[#2B81FF] text-white"
              : "rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200")
          }
        >
          {item.contentType !== "text" && (
            <span className="mb-1 block text-[10px] font-semibold uppercase opacity-70">
              [{item.contentType}]
            </span>
          )}
          {item.contentType === "image" || item.contentType === "document" ? (
            item.opsMediaId ? (
              item.contentType === "image" ? (
                // Inline render via the ops-only signed-URL route (302 → short-
                // lived signed URL on the private ops-media bucket). Plain <img>
                // (not next/image): the source is an authed redirect, not an
                // optimizable static asset.
                <a href={`/api/ops/media/${item.opsMediaId}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/ops/media/${item.opsMediaId}`}
                    alt="inbound media"
                    className="mt-1 max-h-64 rounded-lg ring-1 ring-slate-200"
                  />
                </a>
              ) : (
                <a
                  href={`/api/ops/media/${item.opsMediaId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium underline"
                >
                  Open document ↗
                </a>
              )
            ) : (
              <span className="text-xs italic opacity-60">
                media expired (not retained beyond 3 days)
              </span>
            )
          ) : (
            item.content
          )}
        </div>
        <div
          className={
            "mt-0.5 flex gap-2 text-[10px] text-slate-400 " +
            (outbound ? "justify-end" : "justify-start")
          }
        >
          <span>{fmtTime(item.createdAt)}</span>
          {outbound && item.model && <span>{shortModel(item.model)}</span>}
          {outbound && item.tokensOut != null && <span>{item.tokensOut} tok</span>}
        </div>
      </div>
    </div>
  );
}

function AuditPill({
  item,
}: {
  item: Extract<ThreadItem, { kind: "audit" }>;
}) {
  const ev = item.eventType;
  const err =
    (item.eventData.error as string | undefined) ??
    (item.eventData.classification as string | undefined);

  // signature_verification_failed renders as a full-width banner.
  if (ev === "signature_verification_failed") {
    return (
      <div className="my-1 rounded-lg bg-rose-100 px-3 py-1.5 text-center text-xs font-semibold text-rose-800">
        🛑 Signature verification failed · {fmtTime(item.createdAt)}
      </div>
    );
  }

  const map: Record<string, { tone: string; label: string }> = {
    emergency_detected: { tone: "bg-rose-100 text-rose-800", label: "🚨 Emergency detected" },
    escalation_created: { tone: "bg-amber-100 text-amber-800", label: "⚡ Escalation created" },
    outbound_sent: { tone: "bg-emerald-50 text-emerald-700", label: "✓ Sent" },
    outbound_template_sent: { tone: "bg-emerald-50 text-emerald-700", label: "✓ Template sent" },
    outbound_session_expired: { tone: "bg-slate-100 text-slate-500", label: "⌛ Session expired (24h)" },
    opt_out_set: { tone: "bg-slate-100 text-slate-600", label: "Opt-out set" },
    opt_out_send_blocked: { tone: "bg-slate-100 text-slate-600", label: "Send blocked (opt-out)" },
  };

  const isError = ev.startsWith("outbound_send_failed") || ev === "agent_error";
  const cfg =
    map[ev] ??
    (isError
      ? { tone: "bg-rose-100 text-rose-800", label: `✗ ${ev.replace(/_/g, " ")}` }
      : { tone: "bg-slate-100 text-slate-500", label: ev.replace(/_/g, " ") });

  return (
    <div className="flex justify-center">
      <span
        className={
          "inline-flex max-w-[90%] flex-wrap items-center justify-center gap-1 rounded-full px-2.5 py-1 text-center text-[11px] font-medium " +
          cfg.tone
        }
      >
        {cfg.label}
        {isError && err && <span className="opacity-80">· {err}</span>}
        <span className="opacity-60">· {fmtTime(item.createdAt)}</span>
      </span>
    </div>
  );
}
