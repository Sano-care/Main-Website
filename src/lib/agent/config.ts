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

import { buildAarogyaSystemPrompt } from "@/lib/agent/knowledge";
import type { AgentTurnInput } from "@/lib/agent/types";

export const MODEL_DEFAULT =
  process.env.ANTHROPIC_MODEL_DEFAULT ?? "claude-haiku-4-5-20251001";
export const MODEL_COMPLEX =
  process.env.ANTHROPIC_MODEL_COMPLEX ?? "claude-sonnet-4-6";

/** Max prior turns sent to the model (keeps token cost bounded). */
export const HISTORY_LIMIT = 20;

/** Max output tokens per turn (WhatsApp replies are short). */
export const MAX_OUTPUT_TOKENS = 1024;

let cachedPrompt: string | null = null;
export function getSystemPrompt(): string {
  if (cachedPrompt === null) cachedPrompt = buildAarogyaSystemPrompt();
  return cachedPrompt;
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
