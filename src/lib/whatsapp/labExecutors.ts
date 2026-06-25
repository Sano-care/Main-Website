// Aarogya — patient lab catalogue lookup (search_lab_tests). READ-ONLY.
//
// Patient asks about a lab test → return name, price, turnaround, sample, and
// what-it-checks from the catalogue. Reuses the ONE shared search (src/lib/lab/
// search.ts), so chat results match the website. No write, no PII, no booking.
//
// CLINICAL BOUNDARY (MoHFW Telemedicine 2020): describe + price tests; NEVER
// recommend which test for a symptom/condition → defer to a doctor consult.

import { runLabTestSearch, type LabTestSearchRow } from "@/lib/lab/search";
import type { Identity } from "@/lib/whatsapp/identity";
import { log } from "@/lib/whatsapp/log";

function isPatient(identity: Identity): boolean {
  return identity.role === "customer" || identity.role === "new";
}

/**
 * Backstop for the clinical boundary: a "which test for <symptom>" style query is
 * a recommendation request, not a catalogue lookup → defer to a consult. Safe-by-
 * default (may defer "test for thyroid" too; the patient can rephrase as "thyroid
 * test"/"TSH"). The system-prompt rule is the primary guard; this is the backstop.
 */
export function looksLikeSymptomQuery(q: string): boolean {
  const t = q.toLowerCase();
  return (
    /\btest(s)?\s+for\b/.test(t) ||
    /\bwhich\s+tests?\b/.test(t) ||
    /\bwhat\s+tests?\b/.test(t) ||
    /\b(recommend|suggest)\b/.test(t) ||
    /\bshould\s+i\s+(get|do|take)\b/.test(t)
  );
}

/** "₹1,200" (en-IN) from paise, or the on-request line when price is null. */
function priceLabel(pricePaise: number | null): string {
  if (pricePaise == null) return "price on request — our team will confirm";
  return `₹${Math.round(pricePaise / 100).toLocaleString("en-IN")}`;
}

/** Compact, non-verbose sample summary for WhatsApp (don't dump the raw field). */
function sampleSummary(sample: string | null): string | null {
  if (!sample) return null;
  const s = sample.toLowerCase();
  if (s.includes("blood") || s.includes("serum") || s.includes("plasma") || s.includes("edta")) return "blood sample";
  if (s.includes("urine")) return "urine sample";
  if (s.includes("stool") || s.includes("faec")) return "stool sample";
  if (s.includes("swab")) return "swab";
  if (s.includes("saliva")) return "saliva sample";
  // Fall back to the first couple of words rather than the verbose instructions.
  return sample.split(/[,.;(]/)[0].trim().slice(0, 30) || null;
}

const NO_MATCH_REPLY =
  "I couldn't find that one in our catalogue — try the exact test name (e.g. \"CBC\", \"Thyroid Profile\", \"Vitamin D\"), or I can set up a consult if you're not sure which test you need.";
const SYMPTOM_REPLY =
  "I can look up any test's price and details, but I can't say which test you need for that — that's a doctor's call. Want me to set up a quick teleconsult? Or tell me the test name and I'll pull up the price.";

/** Format up to 5 catalogue rows for WhatsApp. Pure. */
export function formatLabResults(rows: LabTestSearchRow[], query: string): string {
  if (rows.length === 0) return NO_MATCH_REPLY;
  const top = rows.slice(0, 5);
  const lines = top.map((r) => {
    const bits = [priceLabel(r.price_paise)];
    if (r.tat) bits.push(`~${r.tat}`);
    const samp = sampleSummary(r.sample);
    if (samp) bits.push(samp);
    let line = `• ${r.name} — ${bits.join(" · ")}`;
    if (r.utility && r.utility.trim()) line += `\n   ${r.utility.trim()}`;
    return line;
  });
  const header =
    top.length === 1
      ? `Here's what I found for "${query}":`
      : `Here's what I found for "${query}" (${top.length}):`;
  return (
    `${header}\n${lines.join("\n")}\n\n` +
    "Home collection and the final amount are confirmed when you book. Want me to set it up, or look up another test?"
  );
}

export interface SearchLabTestsDeps {
  search?: typeof runLabTestSearch;
}

export async function executeSearchLabTests(
  args: { identity: Identity; input: { query?: string } },
  deps: SearchLabTestsDeps = {},
): Promise<string> {
  // Defense-in-depth: the tool is only advertised to patients, but re-check.
  if (!isPatient(args.identity)) {
    return "That's not something I can look up here.";
  }
  const query = (args.input.query ?? "").trim();
  if (query.length < 2) {
    return "Which test would you like the price for? Send me the name and I'll pull it up.";
  }
  if (looksLikeSymptomQuery(query)) {
    return SYMPTOM_REPLY;
  }

  const search = deps.search ?? runLabTestSearch;
  let rows: LabTestSearchRow[];
  try {
    rows = await search(query, { limit: 5 });
  } catch (err) {
    log.error("executeSearchLabTests failed", err);
    return "I couldn't pull that up just now — tell me the test name and I'll try again.";
  }
  return formatLabResults(rows, query);
}
