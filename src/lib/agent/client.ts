// The ONLY file that will touch the Anthropic SDK (wired in Checkpoint 2). The
// orchestrator depends on this interface, not the SDK, so the brain stays
// testable and the SDK surface is isolated to ~20 lines.
//
// Checkpoint 2 implements generateResponse() with:
//   import Anthropic from "@anthropic-ai/sdk";
//   const client = new Anthropic();  // reads ANTHROPIC_API_KEY
//   const msg = await client.messages.create({ model, system, max_tokens,
//     messages, tools });
//   → flatten text blocks + tool_use blocks into ClaudeResponse.

import type { ToolSchema } from "@/lib/agent/tools";

export interface ClaudeRequest {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  tools: ToolSchema[];
  maxTokens: number;
}

export interface ClaudeToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeResponse {
  /** Concatenated text blocks (the user-facing reply). */
  text: string;
  toolUses: ClaudeToolUse[];
  stopReason: string | null;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export async function generateResponse(req: ClaudeRequest): Promise<ClaudeResponse> {
  // Checkpoint 2: replace this throw with the real Anthropic call.
  throw new Error(
    `Claude client not wired yet (model=${req.model}) — Checkpoint 2 needs ` +
      `@anthropic-ai/sdk installed + ANTHROPIC_API_KEY set.`,
  );
}
