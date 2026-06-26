"use client";

import { useEffect, useState } from "react";

import { useViewingMember } from "@/app/pulse/_lib/MemberViewingContext";
import { pulseFetch } from "@/app/pulse/_lib/pulseClient";
import type { PulseRecords } from "@/lib/pulse/recordsFetch";
import { memberParamFor } from "./recordsDisplay";

// Shared records loader for the landing grid + the per-category detail screens.
// Same contract as the original RecordsSurface effect: gated on membersLoading
// so the viewing target (→ ?member=) is final before the first fetch, scoped by
// the session customer server-side, abortable, retry via reloadKey. Every screen
// stays scoped to the active viewing member — no cross-member leakage.

const LOAD_ERROR = "Couldn't load your records. Check your connection and try again.";

export type RecordsLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; records: PulseRecords; loadedFor: string };

export function useRecords() {
  const { viewing, members, membersLoading } = useViewingMember();
  const memberParam = memberParamFor(viewing);

  const [state, setState] = useState<RecordsLoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (membersLoading) return;
    const ctrl = new AbortController();
    async function run() {
      const res = await pulseFetch<{ records?: PulseRecords }>(
        `/api/pulse/records?member=${encodeURIComponent(memberParam)}`,
        { signal: ctrl.signal },
      );
      if (ctrl.signal.aborted) return;
      if (!res.ok || !res.data.records) {
        setState({ status: "error", message: LOAD_ERROR });
        return;
      }
      setState({ status: "ready", records: res.data.records, loadedFor: memberParam });
    }
    void run();
    return () => ctrl.abort();
  }, [membersLoading, memberParam, reloadKey]);

  const initialLoading = membersLoading || state.status === "loading";
  const stale = state.status === "ready" && state.loadedFor !== memberParam;

  function reload() {
    setState({ status: "loading" });
    setReloadKey((k) => k + 1);
  }

  return { state, viewing, members, memberParam, initialLoading, stale, reload };
}
