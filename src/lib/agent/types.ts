// Channel-agnostic agent contract. The orchestrator (the "brain") knows nothing
// about WhatsApp — adapters translate each channel to/from these types so the
// website widget (Week 4) and mobile app (Week 5) reuse the same orchestrator.

// Type-only import (erased at compile time → no agent↔whatsapp runtime cycle).
import type { Identity } from "@/lib/whatsapp/identity";

export type Channel = "whatsapp" | "website" | "mobile";

export type ServiceIntent =
  | "doctor_visit" // Home Visit + Doctor Consult
  | "nursing" // Home Nursing
  | "lab" // Lab Test at Home
  | "teleconsult" // Teleconsultation
  | "pharmacy" // reserved — not live
  | "other"
  | "unknown";

/** One prior turn, already loaded from the messages table (oldest → newest). */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/** What an adapter hands the orchestrator for a single turn. */
export interface AgentTurnInput {
  conversationId: string;
  channel: Channel;
  /** The just-received user text (already past the deterministic pre-checks). */
  userText: string;
  /** Prior turns for context (the orchestrator caps this; pass last ~20). */
  history: ConversationMessage[];
  /** Number of user turns so far in this conversation (drives model routing). */
  turnCount: number;
  /**
   * True if the deterministic emergency regex fired upstream. The LLM is then a
   * second line only; the canned 112 reply + escalation already happened.
   */
  emergencyPreCheckFired?: boolean;
  /**
   * T-Aarogya-P1 C2 — adapter-resolved caller identity (doctor / medic /
   * customer / new). Adapter-injected ONLY — never derived from model output
   * (prompt-injection guard). Present for context + future medic-mode routing;
   * the orchestrator does NOT branch persona on it in this PR (medic KB is a
   * later, separately-gated PR), so customer/new behaviour is unchanged.
   */
  identity?: Identity;
  /**
   * Slice 4a — Tier-1 patient context block input, shape matching
   * renderContextBlock() in knowledge.ts. When provided alongside
   * identity, the orchestrator uses getSystemPromptForTurn() for a
   * personalized system prompt. Absent → falls back to the legacy
   * getSystemPrompt() (no personalization).
   */
  tier1ContextBlock?: {
    patient_name: string | null;
    last_booking: {
      service_category: string | null;
      status: string;
      created_at: string;
    } | null;
    // Slice 5 — populated for active CareHub members (M061), else null.
    carehub: { active: boolean; started_at: string; monthly_inr: number } | null;
    language: "english" | "hindi" | "hinglish" | null;
  };
  /** Slice 4a — surfaced into the OPS MODE context block (ops mode only). */
  pendingRelayDraftTargetPhone?: string | null;
}

/** A tool the model asked us to run (validated/executed by the adapter layer). */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentTurnResult {
  /** User-facing reply text (may be empty if the turn was tool-only). */
  replyText: string;
  toolCalls: ToolCall[];
  modelUsed: string;
  tokensIn: number;
  tokensOut: number;
  /** Anthropic stop_reason, for observability. */
  stopReason: string | null;
}

// ---------------------------------------------------------------------------
// Tool input shapes (what the model fills in; validated before execution).
// ---------------------------------------------------------------------------
export interface EscalateToOpsInput {
  escalation_type:
    | "qualified_lead"
    | "human_requested"
    | "emergency"
    | "complaint"
    | "stalled_conversation";
  service_intent: ServiceIntent;
  urgency: "emergency" | "today" | "this_week" | "planned";
  patient_name: string;
  patient_age: string;
  patient_relationship: "self" | "parent" | "spouse" | "child" | "other" | "unknown";
  location: string;
  context: string;
  summary_for_ops: string;
}

export interface SetOptOutInput {
  reason?: string;
}

/** service_intent enum → the display name used in the aarogya_lead_alert {{3}}. */
export const SERVICE_DISPLAY: Record<ServiceIntent, string> = {
  doctor_visit: "Home Visit",
  nursing: "Medic at Home",
  lab: "Lab Tests",
  teleconsult: "Teleconsultation",
  pharmacy: "Pharmacy",
  other: "Other",
  unknown: "Other",
};
