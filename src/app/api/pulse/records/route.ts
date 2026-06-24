import { NextResponse, type NextRequest } from "next/server";

import { requirePulseCustomer } from "@/app/pulse/_lib/requireCustomer";
import { fetchPulseRecords } from "@/lib/pulse/recordsFetch";
import { parseMemberParam } from "@/app/pulse/(authed)/records/recordsDisplay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/pulse/records?member=<self|all|uuid>
//
// The read behind the Pulse "Your records" surface (Slice B). The customer is
// resolved from the session cookie via requirePulseCustomer — NEVER from input.
// The optional `member` param only NARROWS within that customer's own rows
// (fetchPulseRecords always scopes by customer_id), so a forged member id from
// another account simply matches nothing. Slice A writes the DPDP audit row.

export async function GET(req: NextRequest) {
  const auth = await requirePulseCustomer(req);
  if ("response" in auth) return auth.response;
  const { customer } = auth;

  const parsed = parseMemberParam(req.nextUrl.searchParams.get("member"));
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const records = await fetchPulseRecords(
    customer.id,
    { memberId: parsed.memberId },
    {
      identity: { role: "customer", identifiers: { customer_id: customer.id } },
      accessor: "pulse",
      conversationId: null,
    },
  );

  return NextResponse.json({ records });
}
