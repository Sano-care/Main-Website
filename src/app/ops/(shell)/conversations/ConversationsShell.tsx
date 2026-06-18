"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, MessageSquare, RefreshCw } from "lucide-react";

import { ConversationList } from "./ConversationList";
import { ThreadView } from "./ThreadView";
import type { ConversationMeta, ConversationRow, ThreadItem } from "./types";

const REDACT_KEY = "ops_conv_redact";

// Redact preference lives in localStorage (shared across list + thread, persists
// across reloads). useSyncExternalStore reads it without a set-state-in-effect
// and renders `false` on the server to avoid a hydration mismatch.
function subscribeRedact(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function getRedactSnapshot(): boolean {
  return localStorage.getItem(REDACT_KEY) === "1";
}

function useRedact(): [boolean, () => void] {
  const redact = useSyncExternalStore(
    subscribeRedact,
    getRedactSnapshot,
    () => false,
  );
  const toggle = useCallback(() => {
    localStorage.setItem(REDACT_KEY, redact ? "0" : "1");
    // Notify same-tab subscribers (native `storage` only fires cross-tab).
    window.dispatchEvent(new StorageEvent("storage", { key: REDACT_KEY }));
  }, [redact]);
  return [redact, toggle];
}

export function ConversationsShell({
  conversations,
  thread,
  meta,
  selectedId,
}: {
  conversations: ConversationRow[];
  thread: ThreadItem[] | null;
  meta: ConversationMeta | null;
  selectedId: string | null;
}) {
  const router = useRouter();
  const [redact, toggleRedact] = useRedact();
  const [reloading, setReloading] = useState(false);

  function reload() {
    setReloading(true);
    router.refresh();
    window.setTimeout(() => setReloading(false), 700);
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      {/* Page header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-[#2B81FF]" />
          <h1 className="text-base font-bold text-slate-900">Conversations</h1>
          <span className="text-xs tabular-nums text-slate-400">
            {conversations.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleRedact}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            title="Toggle phone-number masking for screen-sharing"
          >
            {redact ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="hidden sm:inline">{redact ? "Masked" : "Full"}</span>
          </button>
          <button
            type="button"
            onClick={reload}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            <RefreshCw className={"h-4 w-4 " + (reloading ? "animate-spin" : "")} />
            <span className="hidden sm:inline">Reload</span>
          </button>
        </div>
      </header>

      {/* Two-pane (≥lg) / single-pane drill-down (<lg) */}
      <div className="flex min-h-0 flex-1">
        <div
          className={
            (selectedId ? "hidden lg:flex" : "flex") +
            " w-full flex-col border-r border-slate-200 bg-white lg:w-[360px] lg:shrink-0"
          }
        >
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            redact={redact}
          />
        </div>
        <div
          className={
            (selectedId ? "flex" : "hidden lg:flex") + " min-w-0 flex-1 flex-col"
          }
        >
          {meta && thread ? (
            <ThreadView thread={thread} meta={meta} redact={redact} />
          ) : (
            <div className="flex flex-1 items-center justify-center bg-slate-50 p-8 text-center text-sm text-slate-400">
              Select a conversation to view the thread.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
