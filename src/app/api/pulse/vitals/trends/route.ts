import { NextResponse, type NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { isVitalKind } from "../../_lib/validation";
import { windowToMs } from "../../_lib/window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/pulse/vitals/trends?kind=&window=
//
// Returns the ascending series for one vital kind over a rolling window plus
// a light summary (count / first / latest / min / max / average of the
// primary value). Charting itself lands in B2 — this is the data feed.
//
// NOTE: this STATIC segment ("trends") wins over the sibling dynamic
// segment ("[id]") in the App Router, so /api/pulse/vitals/trends never
// resolves to the :id handler.

export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind");
  if (!isVitalKind(kind)) {
    return NextResponse.json(
      { error: "kind is required and must be a known vital type." },
      { status: 400 },
    );
  }

  const windowParam = sp.get("window") ?? "30d";
  const ms = windowToMs(windowParam);
  if (ms === null) {
    return NextResponse.json(
      { error: "window must be one of 7d, 30d, 90d, 180d, 1y." },
      { status: 400 },
    );
  }
  const fromIso = new Date(Date.now() - ms).toISOString();

  const { data, error } = await supabaseAdmin
    .from("vital_readings")
    .select("id, value_numeric, value_secondary, taken_at")
    .eq("customer_id", customer.id)
    .eq("kind", kind)
    .gte("taken_at", fromIso)
    .order("taken_at", { ascending: true });

  if (error) {
    console.error("[pulse/vitals/trends] failed:", error);
    return NextResponse.json(
      { error: "Could not load trend." },
      { status: 500 },
    );
  }

  const series = data ?? [];
  const values = series
    .map((r) => r.value_numeric as number)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n));

  const summary =
    values.length > 0
      ? {
          count: series.length,
          first: series[0]?.taken_at ?? null,
          latest: series[series.length - 1]?.taken_at ?? null,
          min: Math.min(...values),
          max: Math.max(...values),
          average:
            Math.round(
              (values.reduce((a, b) => a + b, 0) / values.length) * 100,
            ) / 100,
        }
      : { count: 0, first: null, latest: null, min: null, max: null, average: null };

  return NextResponse.json({ kind, window: windowParam, series, summary });
}
