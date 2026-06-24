// The ONLY file that touches the Anthropic SDK. The orchestrator depends on this
// interface, not the SDK, so the brain stays testable and the SDK surface is
// isolated here. ToolSchema is already Anthropic's tool shape, so it passes
// straight through.

import Anthropic from "@anthropic-ai/sdk";
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

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  // Lazily constructed so a missing key fails at call time (caught by the
  // adapter), not at module load (which would break the whole route).
  if (_client === null) _client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return _client;
}

export async function generateResponse(req: ClaudeRequest): Promise<ClaudeResponse> {
  const msg = await getClient().messages.create({
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    tools: req.tools as unknown as Anthropic.Tool[],
  });

  let text = "";
  const toolUses: ClaudeToolUse[] = [];
  for (const block of msg.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolUses.push({
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }

  return {
    text,
    toolUses,
    stopReason: msg.stop_reason,
    model: msg.model,
    tokensIn: msg.usage.input_tokens,
    tokensOut: msg.usage.output_tokens,
  };
}

export interface VisionRequest {
  model: string;
  system: string;
  /** The instruction that accompanies the image (the "task prompt"). */
  userText: string;
  image: { bytes: Uint8Array; mimeType: string };
  maxTokens: number;
}

/**
 * Single vision call — sends ONE image (or PDF) block + a text instruction and
 * returns the concatenated text reply. The only SDK surface for vision; the
 * brain (vision.ts) depends on this interface, not the SDK. Haiku 4.5 and
 * Sonnet 4.6 both support vision. Image bytes go as a base64 source block;
 * PDFs use a document block (Meta sends prescriptions/reports as either).
 */
export async function generateVisionJson(
  req: VisionRequest,
): Promise<{ text: string }> {
  const base64 = Buffer.from(req.image.bytes).toString("base64");
  const mediaBlock: Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam =
    req.image.mimeType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: req.image.mimeType as
              | "image/jpeg"
              | "image/png"
              | "image/gif"
              | "image/webp",
            data: base64,
          },
        };

  const msg = await getClient().messages.create({
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [
      { role: "user", content: [mediaBlock, { type: "text", text: req.userText }] },
    ],
  });

  let text = "";
  for (const block of msg.content) {
    if (block.type === "text") text += block.text;
  }
  return { text };
}
