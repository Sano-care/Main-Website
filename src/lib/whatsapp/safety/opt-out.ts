// Deterministic opt-out detection (architecture §3.2, safety rule #4, TRAI /
// MEITY commercial-messaging rules §3.1).
//
// Detection is regex-only and runs in the pre-check layer before any LLM.
// Persisting the block (conversations.opt_out = true, leads.consent_status =
// 'opted_out') and the permanent send-refusal live in the orchestrator / db
// layer — opt-out is permanent and GLOBAL once set (no override flag exists).

export const OPT_OUT_KEYWORDS = [
  "stop",
  "unsubscribe",
  "remove",
  "do not contact",
  "do not message",
  "dont contact",
] as const;

// Exact confirmation required by Week-1 Deliverable 4.
export const OPT_OUT_CONFIRMATION =
  "Got it. We won't message you again. If you change your mind, just message " +
  "us. — Aarogya";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMPILED: { keyword: string; re: RegExp }[] = OPT_OUT_KEYWORDS.map(
  (keyword) => ({
    keyword,
    re: new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i"),
  }),
);

export interface OptOutMatch {
  matched: boolean;
  keyword?: string;
}

/**
 * Scan an inbound message for opt-out intent. Returns the matched keyword for
 * audit context, or { matched: false }.
 */
export function detectOptOut(text: string): OptOutMatch {
  if (!text) return { matched: false };
  for (const { keyword, re } of COMPILED) {
    if (re.test(text)) return { matched: true, keyword };
  }
  return { matched: false };
}
