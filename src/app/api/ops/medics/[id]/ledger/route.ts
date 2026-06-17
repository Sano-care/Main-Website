import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  requireOpsAdminApi,
  requireOpsUserApi,
} from "@/app/ops/_lib/requireOpsAdmin";

export const runtime = "nodejs";

// T65 Phase 2B C5a — medic compensation ledger.
//
//   GET  /api/ops/medics/[id]/ledger?from=&to=&page=
//        Admin + agent read. Paginated rows (newest-first) each carrying a
//        running balance. The running balance is the GLOBAL cumulative sum
//        (every entry the medic has ever had, oldest-first) evaluated at
//        that row — NOT a per-page or per-window sum — so a row's balance
//        reads correctly regardless of which date window / page it lands
//        in. Equivalent to SUM(amount_paise) OVER (ORDER BY entry_date,
//        created_at); computed via a forward walk in JS (mirrors the
//        doctor-side pattern, no window-function-over-PostgREST gymnastics).
//
//   POST /api/ops/medics/[id]/ledger
//        Admin only. Manual ledger entry (earning correction / adjustment).
//        Payouts are NOT creatable here — they must go through the Settle
//        flow (POST .../settle) so they always carry a proof doc. Reversals
//        need a reverses_entry_id linkage that's out of C5a scope.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PAGE_SIZE = 50;

// Cap on the oldest-first scan used to compute running balances. A medic
// won't approach this in v0; if one ever does the oldest visible balances
// would drift, so we log when the cap bites.
const LEDGER_SCAN_CAP = 5000;

// Manual entry types. Payout is excluded (Settle flow owns it); reversal is
// excluded (needs reverses_entry_id, out of scope).
const MANUAL_ENTRY_TYPES = new Set([
  "revenue_share",
  "commission",
  "daily_wage",
  "overtime",
  "adjustment",
]);

type LedgerRow = {
  id: string;
  entry_type: string;
  amount_paise: number;
  entry_date: string;
  description: string | null;
  booking_id: string | null;
  created_at: string;
};

/** First day of the current IST month, as YYYY-MM-DD. */
function istMonthStart(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}-01`;
}

/** Today in IST, as YYYY-MM-DD. */
function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireOpsUserApi();
  if (gate instanceof NextResponse) return gate;

  const { id: medicId } = await params;
  if (!UUID_RE.test(medicId)) {
    return NextResponse.json({ error: "invalid_medic_id" }, { status: 400 });
  }

  const sp = request.nextUrl.searchParams;
  const from = DATE_RE.test(sp.get("from") ?? "")
    ? (sp.get("from") as string)
    : istMonthStart();
  const to = DATE_RE.test(sp.get("to") ?? "")
    ? (sp.get("to") as string)
    : istToday();
  const pageRaw = Number(sp.get("page") ?? "1");
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  // Fetch the medic's full ledger oldest-first so running balances are the
  // true cumulative figure at each row (independent of the date window).
  const { data, error } = await supabaseAdmin
    .from("medic_ledger_entries")
    .select(
      "id, entry_type, amount_paise, entry_date, description, booking_id, created_at",
    )
    .eq("medic_id", medicId)
    .order("entry_date", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true }) // deterministic tie-break for same-tx rows
    .limit(LEDGER_SCAN_CAP);
  if (error) {
    console.error("[ops/medics/ledger] fetch failed", error);
    return NextResponse.json({ error: "fetch_failed" }, { status: 500 });
  }

  const all = (data ?? []) as LedgerRow[];
  if (all.length >= LEDGER_SCAN_CAP) {
    console.warn(
      `[ops/medics/ledger] scan cap hit for medic ${medicId}; running balances on the oldest rows may be approximate`,
    );
  }

  // Forward-walk: assign each row its cumulative running balance.
  let balance = 0;
  const withBalance = all.map((r) => {
    balance += r.amount_paise;
    return { ...r, running_balance_paise: balance };
  });

  // Filter to the [from, to] window (inclusive on entry_date), newest-first.
  const filtered = withBalance
    .filter((r) => r.entry_date >= from && r.entry_date <= to)
    .reverse();

  const total = filtered.length;
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  // Resolve booking_code for any rows carrying a booking_id (for the link).
  const bookingIds = Array.from(
    new Set(
      pageRows
        .map((r) => r.booking_id)
        .filter((x): x is string => !!x),
    ),
  );
  const codeById = new Map<string, string>();
  if (bookingIds.length > 0) {
    const { data: bookings } = await supabaseAdmin
      .from("bookings")
      .select("id, booking_code")
      .in("id", bookingIds);
    for (const b of (bookings ?? []) as Array<{
      id: string;
      booking_code: string | null;
    }>) {
      if (b.booking_code) codeById.set(b.id, b.booking_code);
    }
  }

  return NextResponse.json({
    rows: pageRows.map((r) => ({
      id: r.id,
      entry_type: r.entry_type,
      amount_paise: r.amount_paise,
      entry_date: r.entry_date,
      description: r.description,
      booking_id: r.booking_id,
      booking_code: r.booking_id ? codeById.get(r.booking_id) ?? null : null,
      running_balance_paise: r.running_balance_paise,
      created_at: r.created_at,
    })),
    page,
    page_size: PAGE_SIZE,
    total,
    has_more: start + PAGE_SIZE < total,
    range: { from, to },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminGate = await requireOpsAdminApi();
  if (adminGate instanceof NextResponse) return adminGate;

  const { id: medicId } = await params;
  if (!UUID_RE.test(medicId)) {
    return NextResponse.json({ error: "invalid_medic_id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const entryType = String(body.entry_type ?? "");
  if (!MANUAL_ENTRY_TYPES.has(entryType)) {
    return NextResponse.json(
      { error: "invalid_entry_type", allowed: Array.from(MANUAL_ENTRY_TYPES) },
      { status: 400 },
    );
  }

  const amountRupees = Number(body.amount);
  if (!Number.isFinite(amountRupees) || amountRupees === 0) {
    return NextResponse.json(
      { error: "invalid_amount" },
      { status: 400 },
    );
  }
  // Earnings must be positive; adjustments may be signed (negative debits).
  if (entryType !== "adjustment" && amountRupees < 0) {
    return NextResponse.json(
      { error: "negative_amount_not_allowed", detail: "Only adjustments may be negative." },
      { status: 400 },
    );
  }

  const entryDate = String(body.entry_date ?? "");
  if (!DATE_RE.test(entryDate)) {
    return NextResponse.json({ error: "invalid_entry_date" }, { status: 400 });
  }

  const descriptionRaw = body.description;
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw.trim().slice(0, 500)
      : null;
  // Adjustments must carry a description (they're manual corrections — an
  // unexplained signed entry is an audit hole).
  if (entryType === "adjustment" && !description) {
    return NextResponse.json(
      { error: "description_required", detail: "Adjustments need a note." },
      { status: 400 },
    );
  }

  let bookingId: string | null = null;
  if (body.booking_id != null && String(body.booking_id).length > 0) {
    bookingId = String(body.booking_id);
    if (!UUID_RE.test(bookingId)) {
      return NextResponse.json({ error: "invalid_booking_id" }, { status: 400 });
    }
  }

  // Verify medic exists (FK is ON DELETE RESTRICT but a 404 is clearer than
  // an opaque FK violation).
  const { data: medic } = await supabaseAdmin
    .from("medics")
    .select("id")
    .eq("id", medicId)
    .maybeSingle();
  if (!medic) {
    return NextResponse.json({ error: "medic_not_found" }, { status: 404 });
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("medic_ledger_entries")
    .insert({
      medic_id: medicId,
      entry_type: entryType,
      amount_paise: Math.round(amountRupees * 100),
      entry_date: entryDate,
      description,
      booking_id: bookingId,
      created_by: adminGate.id,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    console.error("[ops/medics/ledger] insert failed", insertErr);
    return NextResponse.json(
      { error: "insert_failed", detail: insertErr?.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ entry_id: inserted.id }, { status: 201 });
}
