// Streams the prescription PDF bytes through our domain so the
// browser sees /rx/<token>/pdf, not a raw signed-URL on
// *.supabase.co. The token is re-validated on every fetch (so a
// voided Rx stops serving immediately) and the bytes come via a
// service-role download from the private 'prescriptions' bucket.
//
// Cache control: no-store. PDF objects are immutable per (code,
// version), but the gate is the token's still-valid status — caching
// would defeat post-void revocation. The PDFs are also small (a few
// KB each); a per-request fetch is cheap.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isValidRxPatientViewTokenFormat } from "@/lib/rx/tokens";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const PRESCRIPTIONS_BUCKET = "prescriptions";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!isValidRxPatientViewTokenFormat(token)) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const { data: rxData, error: rxErr } = await supabaseAdmin
    .from("prescriptions")
    .select("status, pdf_storage_path, prescription_code, version")
    .eq("patient_view_token", token)
    .maybeSingle();
  if (rxErr || !rxData) {
    return new NextResponse("Not found.", { status: 404 });
  }
  const rx = rxData as {
    status: "draft" | "sent" | "superseded" | "voided";
    pdf_storage_path: string | null;
    prescription_code: string;
    version: number;
  };

  // Only 'sent' Rx are servable. Voided / superseded / draft fall to
  // 410 Gone, so the page renderer can display the appropriate
  // explainer surface and search engines won't index. (The page wraps
  // this — if a patient navigates straight to /pdf, we still want a
  // consistent response.)
  if (rx.status !== "sent") {
    return new NextResponse("This prescription is no longer available.", {
      status: 410,
    });
  }
  if (!rx.pdf_storage_path) {
    return new NextResponse("Prescription PDF is missing.", { status: 500 });
  }

  const { data: file, error: fileErr } = await supabaseAdmin.storage
    .from(PRESCRIPTIONS_BUCKET)
    .download(rx.pdf_storage_path);
  if (fileErr || !file) {
    return new NextResponse(
      `Could not load prescription PDF: ${fileErr?.message ?? "unknown"}.`,
      { status: 502 },
    );
  }

  const buf = new Uint8Array(await file.arrayBuffer());

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      // 'inline' so phone browsers preview it; the page wrapper has a
      // Download button that uses ?download — but inline is the right
      // default for the in-iframe preview.
      "Content-Disposition": `inline; filename="${rx.prescription_code}${
        rx.version > 1 ? `-v${rx.version}` : ""
      }.pdf"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
