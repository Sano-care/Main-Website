/**
 * One-off backfill — copy a recoverable Google Ads gclid onto existing
 * bookings that have none.
 *
 * For every booking with a NULL gclid, find the most-recent WhatsApp
 * conversation that (a) shares the phone (normalised to the last 10 digits, so
 * +91 / 91 / bare-10-digit all match), (b) carries a gclid, and (c) started
 * within 90 days of the booking — and copy gclid + wbraid across. Mirrors the
 * live `findClickIdsForPhone` used at booking creation.
 *
 * DRY-RUN by default — prints how many bookings WOULD be attributed and the
 * matches, writes nothing. Pass `--apply` to perform the update.
 *
 *   tsx scripts/backfill-booking-gclid.ts            # dry-run (report only)
 *   tsx scripts/backfill-booking-gclid.ts --apply    # actually write
 *
 * Expect very few hits today (only ~1 conversation currently carries a gclid);
 * this is a recovery pass, not a forced attribution. Skips gracefully when the
 * SUPABASE env vars are missing.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function last10(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

async function findMatch(
  supabase: SupabaseClient,
  phone: string,
  bookingCreatedAtMs: number,
): Promise<{ gclid: string; wbraid: string | null } | null> {
  const l10 = last10(phone);
  if (!l10) return null;
  const cutoffIso = new Date(bookingCreatedAtMs - NINETY_DAYS_MS).toISOString();

  const { data, error } = await supabase
    .from("conversations")
    .select("gclid, wbraid, created_at")
    .not("gclid", "is", null)
    .like("whatsapp_phone", `%${l10}`)
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[backfill-gclid] conversation lookup failed:", error.message);
    return null;
  }
  if (!data?.gclid) return null;
  return { gclid: data.gclid as string, wbraid: (data.wbraid as string | null) ?? null };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn("[backfill-gclid] SUPABASE env vars missing — skipping.");
    console.warn(
      "[backfill-gclid] Run with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set.",
    );
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, booking_code, phone, created_at")
    .is("gclid", null);
  if (error) {
    console.error("[backfill-gclid] booking scan failed:", error.message);
    process.exitCode = 1;
    return;
  }

  const rows = bookings ?? [];
  console.log(
    `[backfill-gclid] scanning ${rows.length} booking(s) with no gclid… (${apply ? "APPLY" : "dry-run"})`,
  );

  let matched = 0;
  let written = 0;
  for (const b of rows) {
    const phone = (b.phone as string | null) ?? null;
    if (!phone) continue;
    const createdMs = b.created_at ? new Date(b.created_at as string).getTime() : Date.now();
    const match = await findMatch(supabase, phone, createdMs);
    if (!match) continue;
    matched++;
    console.log(
      `[backfill-gclid] match: booking ${b.booking_code ?? b.id} → gclid ${match.gclid}`,
    );
    if (apply) {
      const { error: upErr } = await supabase
        .from("bookings")
        .update({ gclid: match.gclid, wbraid: match.wbraid })
        .eq("id", b.id as string)
        .is("gclid", null); // first-write-wins; safe to re-run
      if (upErr) {
        console.error(`[backfill-gclid] update failed for ${b.id}:`, upErr.message);
      } else {
        written++;
      }
    }
  }

  console.log(
    `[backfill-gclid] done. ${matched} booking(s) recoverable${
      apply ? `, ${written} written` : " (dry-run — nothing written; pass --apply to write)"
    }.`,
  );
}

main().catch((err) => {
  console.error("[backfill-gclid] threw:", err);
  process.exitCode = 1;
});
