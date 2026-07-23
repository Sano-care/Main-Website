import "server-only";

import { randomBytes } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase-server";

// WhatsApp click-token — the short, human-typable handle that carries a Google
// Ads click id (gclid) through the WhatsApp handoff.
//
// A raw gclid is ~90 chars of opaque base64 — far too ugly to sit in a prefilled
// WhatsApp message. Instead we mint `SC-XXXXXX` (Crockford base32, no I/L/O/U so
// it survives being read aloud / retyped), store `token → { gclid, wbraid }` in
// wa_click_tokens, and put ONLY the token in the message as `[ref: SC-XXXXXX]`.
// The Aarogya inbound handler regexes it back out and stamps the resolved gclid
// onto the conversation, so a booking that later gets paid can be uploaded to
// Google Ads as an offline conversion.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const TOKEN_BODY_LEN = 6;

export const WA_REF_PREFIX = "SC-";

/** `SC-` + 6 Crockford-base32 chars (~1.07e9 space — ample for click volume). */
export function generateWaClickToken(): string {
  const bytes = randomBytes(TOKEN_BODY_LEN);
  let body = "";
  for (let i = 0; i < TOKEN_BODY_LEN; i++) {
    body += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `${WA_REF_PREFIX}${body}`;
}

/**
 * Matches `[ref: SC-XXXXXX]` tolerantly — any case, optional inner whitespace.
 * Patients forward/retype messages, so be generous about what we accept.
 */
export const WA_REF_RE = /\[\s*ref\s*:\s*(SC-[0-9A-HJKMNP-TV-Z]{6})\s*\]/i;

/** Pull the ref token out of an inbound message body. Null when absent. */
export function extractWaRefToken(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = WA_REF_RE.exec(text);
  return match ? match[1].toUpperCase() : null;
}

/** The suffix appended to a WhatsApp prefill message. */
export function buildWaRefSuffix(token: string): string {
  return ` [ref: ${token}]`;
}

/**
 * Persist a new token for this click. Returns null (never throws) when there is
 * no gclid or the insert fails — callers fall back to a plain WhatsApp link.
 * Retries on the (vanishingly unlikely) primary-key collision.
 */
export async function mintWaClickToken(input: {
  gclid: string;
  wbraid?: string | null;
}): Promise<string | null> {
  const gclid = input.gclid?.trim();
  if (!gclid) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateWaClickToken();
    const { error } = await supabaseAdmin.from("wa_click_tokens").insert({
      token,
      gclid,
      wbraid: input.wbraid?.trim() || null,
    });
    if (!error) return token;
    if ((error as { code?: string }).code !== "23505") {
      console.error("[wa-click-token] insert failed:", error.message);
      return null;
    }
    // 23505 → token collision, try another.
  }
  console.error("[wa-click-token] exhausted token attempts");
  return null;
}

/** Resolve a token back to its click ids. Null when unknown/expired. */
export async function resolveWaClickToken(
  token: string,
): Promise<{ gclid: string | null; wbraid: string | null } | null> {
  const normalized = token?.trim().toUpperCase();
  if (!normalized) return null;

  const { data, error } = await supabaseAdmin
    .from("wa_click_tokens")
    .select("gclid, wbraid")
    .eq("token", normalized)
    .maybeSingle();

  if (error) {
    console.error("[wa-click-token] lookup failed:", error.message);
    return null;
  }
  if (!data) return null;
  return {
    gclid: (data.gclid as string | null) ?? null,
    wbraid: (data.wbraid as string | null) ?? null,
  };
}
