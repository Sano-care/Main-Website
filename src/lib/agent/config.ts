// Agent configuration: which system prompt + which model.
//
// System prompt: loaded from the bundled KB (buildAarogyaSystemPrompt). This is
// git-versioned and fast (no per-message DB round-trip). agent_versions holds
// the same text as the audit/version record (seeded separately); switching to
// DB-load-with-cache is a one-function change if prompt hot-swapping is needed.
//
// Model routing (founder spec): Haiku 4.5 default; Sonnet 4.6 when the turn is
// likely complex — conversation has run several turns, the emergency pre-check
// fired (second-line scrutiny), or the message is long/ambiguous.

import {
  buildAarogyaSystemPrompt,
  LANGUAGE_MIRROR_RULE,
  SHORT_MESSAGE_RULE,
  CUSTOMER_REGISTERED_ADDENDUM,
  CUSTOMER_CAREHUB_ADDENDUM,
  OPS_MODE_ADDENDUM,
  MEDIC_ADDENDUM,
  renderContextBlock,
  renderOpsContextBlock,
  type ContextBlockInput,
} from "@/lib/agent/knowledge";
import type { AgentTurnInput } from "@/lib/agent/types";
import type { Identity } from "@/lib/whatsapp/identity";

export const MODEL_DEFAULT =
  process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-haiku-4-5-20251001";
export const MODEL_COMPLEX =
  process.env.ANTHROPIC_MODEL_COMPLEX ?? "claude-sonnet-4-6";

/** Max prior turns sent to the model (keeps token cost bounded). */
export const HISTORY_LIMIT = 20;

/** Max output tokens per turn (WhatsApp replies are short). */
export const MAX_OUTPUT_TOKENS = 1024;

let cachedPrompt: string | null = null;

/**
 * The base KB-derived system prompt (catalog + safety + persona). Cached
 * because it's identical every turn. Slice 4a layers additional addendums
 * on top via getSystemPromptForTurn — this function stays available as
 * the legacy zero-arg entry point and is also what getSystemPromptForTurn
 * builds on.
 */
export function getSystemPrompt(): string {
  if (cachedPrompt === null) cachedPrompt = buildAarogyaSystemPrompt();
  return cachedPrompt;
}

/**
 * Slice 4a — hybrid composition that layers identity-conditional
 * addendums + the per-turn PATIENT CONTEXT block on top of the base
 * prompt. Pure function — no IO, safe to call every turn.
 *
 * Backward compat: the existing zero-arg getSystemPrompt() still works.
 * The orchestrator decides which one to call based on whether the
 * adapter threaded identity + context through.
 */
export function getSystemPromptForTurn(
  identity: Identity,
  context: ContextBlockInput,
  opsExtras?: { pendingDraftTargetPhone?: string | null },
): string {
  const sections: string[] = [
    getSystemPrompt(),
    LANGUAGE_MIRROR_RULE,
    SHORT_MESSAGE_RULE,
  ];

  // Medic mode REPLACES the patient flow for this turn: push the medic addendum
  // and return early — no patient context block, no customer/ops composition.
  // (Mirrors the ops_founder early-return below; medic never sees the patient
  // booking flow.)
  if (identity.role === "medic") {
    sections.push(MEDIC_ADDENDUM);
    return sections.join("\n\n");
  }

  // Registered AND carehub members are both known returning customers — both
  // get the name/last-booking personalization. CareHub members get the
  // member-benefits addendum layered on top.
  if (
    identity.role === "customer" &&
    (identity.subRole === "registered" || identity.subRole === "carehub")
  ) {
    sections.push(CUSTOMER_REGISTERED_ADDENDUM);
  }
  if (identity.role === "customer" && identity.subRole === "carehub") {
    sections.push(CUSTOMER_CAREHUB_ADDENDUM);
  }

  if (identity.role === "ops_founder") {
    sections.push(OPS_MODE_ADDENDUM);
    sections.push(renderOpsContextBlock({
      pendingDraftTargetPhone: opsExtras?.pendingDraftTargetPhone ?? null,
    }));
    // Skip the patient context block in ops mode — there's no patient
    // on this turn.
    return sections.join("\n\n");
  }

  sections.push(renderContextBlock(context));
  return sections.join("\n\n");
}

const COMPLEX_TURN_THRESHOLD = 3;
const LONG_MESSAGE_CHARS = 240;

/** Pick the model for this turn. Returns the model id. */
export function selectModel(input: Pick<AgentTurnInput, "turnCount" | "emergencyPreCheckFired" | "userText">): string {
  if (input.emergencyPreCheckFired) return MODEL_COMPLEX;
  if (input.turnCount > COMPLEX_TURN_THRESHOLD) return MODEL_COMPLEX;
  if (input.userText.length > LONG_MESSAGE_CHARS) return MODEL_COMPLEX;
  return MODEL_DEFAULT;
}
