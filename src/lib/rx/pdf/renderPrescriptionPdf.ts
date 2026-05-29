// Server-side render of a PrescriptionPdf to a PDF byte buffer.
//
// Used by sendPrescription() in src/app/doctor/_actions/prescription.ts.
// Returns a Buffer that's uploaded into the private 'prescriptions'
// Supabase storage bucket; the patient-view route (/rx/[token]) then
// mints a short-lived signed URL on read.
//
// v5.1 renderer scope (post-v5 typography flip — Times Roman serif):
//
//   - Font registration: NONE. v5.1 uses @react-pdf's built-in PDF
//     standard fonts (Times-Roman, Times-Bold, Times-Italic,
//     Times-BoldItalic) — no Font.register call, no TTF bundling,
//     no outputFileTracingIncludes needed for fonts. Net effect:
//     ~600 KB drop in the function bundle. Standard PDF fonts are
//     embedded in every PDF viewer, so the output renders identically
//     everywhere without us shipping the glyphs.
//
//   - Per @react-pdf's design, each weight is a separate family name:
//     bold text uses `fontFamily: "Times-Bold"` (NOT
//     `fontWeight: 700`). The PrescriptionPdf StyleSheet sets the
//     default fontFamily on the Page and overrides per-style for bold.
//
//   - Signature handling: download the doctor's signature image bytes
//     from the private doctor-signatures bucket via the service role
//     and convert to a base64 data URL. We embed-as-data-url rather
//     than passing a signed URL because @react-pdf/renderer fetches
//     Image src at render time and serverless functions don't always
//     have outbound HTTPS to *.supabase.co within the React-PDF fetch
//     sandbox.
//
//   - Brand butterfly: rendered inline via @react-pdf's <Svg><Path/>
//     in PrescriptionPdf.tsx. The kidney-shape paths are tiny (sub-1KB
//     of source), embedded directly in the component — no asset
//     bundle, no fs read at render time.
//
// v5/v5.1 dropped from v3/v4 (deliberate):
//
//   - Inter-Variable.ttf bundle + Font.register (v5.1)
//   - Cormorant Garamond + Source Serif 4 font bundles + italic VFs (v5)
//   - QR generation (qrcode npm package uninstalled — v5)
//   - Stamp resolution (doctor.stamp_image_url column kept in DB for
//     future v6 but not rendered) (v5)
//   - Watermark SVG component (v5)
//   - Cream paper background, inset double-rule frame, doc-meta strip (v5)

import { renderToBuffer, Font } from "@react-pdf/renderer";
import { createElement } from "react";
import { PrescriptionPdf, type PrescriptionPdfData } from "./PrescriptionPdf";
import { supabaseAdmin } from "@/lib/supabase-server";

// ---------------------------------------------------------------------
// One-time hyphenation disable.
//
// v5.1 doesn't register any TTF fonts — Times Roman family ships as a
// PDF standard font, available in every viewer. But we still need to
// disable @react-pdf's default hyphenation callback, which would
// otherwise reach for a hyphenation dictionary over the network on
// long-word wrap. Idempotent on the @react-pdf side: setting the
// callback again is a no-op.
// ---------------------------------------------------------------------
let hyphenationDisabled = false;
function disableHyphenationOnce() {
  if (hyphenationDisabled) return;
  Font.registerHyphenationCallback((word) => [word]);
  hyphenationDisabled = true;
}

// ---------------------------------------------------------------------
// Signature resolution
//
// doctor.signature_image_url stores a storage path (NOT a URL). At Rx
// send time we download the bytes via the service-role client and
// convert to a data: URL the PDF Image component can render directly
// without an outbound HTTPS fetch at PDF-render time.
// ---------------------------------------------------------------------
const SIGNATURES_BUCKET = "doctor-signatures";

function mimeForImagePath(storagePath: string, what: string): string {
  const ext = storagePath.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  throw new Error(
    `Unsupported ${what} image extension on ${storagePath} — expected png/jpg/jpeg/webp.`,
  );
}

async function resolveBucketPathToDataUrl(
  bucket: string,
  storagePath: string,
  label: string,
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .download(storagePath);
  if (error || !data) {
    throw new Error(
      `Could not download doctor ${label} from ${bucket}/${storagePath}: ${
        error?.message ?? "no data"
      }`,
    );
  }
  const arr = new Uint8Array(await data.arrayBuffer());
  const base64 = Buffer.from(arr).toString("base64");
  return `data:${mimeForImagePath(storagePath, label)};base64,${base64}`;
}

export async function resolveSignatureToDataUrl(
  storagePath: string,
): Promise<string> {
  return resolveBucketPathToDataUrl(SIGNATURES_BUCKET, storagePath, "signature");
}

// ---------------------------------------------------------------------
// Main entry point
//
// signature: 'placeholder' draws an underline (composer preview path);
// 'storagePath' downloads from doctor-signatures bucket and embeds;
// 'dataUrl' uses a pre-resolved data URL. The byte shuffling stays
// inside this module so the server action just calls
// renderPrescriptionPdf({ data, signature: { kind: 'storagePath',
// path: doctor.signature_image_url } }).
// ---------------------------------------------------------------------
export type RenderImageSource =
  | { kind: "placeholder" }
  | { kind: "storagePath"; path: string }
  | { kind: "dataUrl"; dataUrl: string };

/** @deprecated kept for backwards compatibility; prefer RenderImageSource. */
export type RenderSignatureSource = RenderImageSource;

export async function renderPrescriptionPdf(args: {
  data: PrescriptionPdfData;
  signature: RenderImageSource;
}): Promise<Buffer> {
  disableHyphenationOnce();

  let signatureMode: "placeholder" | "embedded" = "placeholder";
  let signatureDataUrl: string | null = null;

  if (args.signature.kind === "storagePath") {
    signatureDataUrl = await resolveSignatureToDataUrl(args.signature.path);
    signatureMode = "embedded";
  } else if (args.signature.kind === "dataUrl") {
    signatureDataUrl = args.signature.dataUrl;
    signatureMode = "embedded";
  }

  const element = createElement(PrescriptionPdf, {
    data: args.data,
    signatureMode,
    signatureDataUrl,
  });

  // renderToBuffer expects a ReactElement<DocumentProps>. PrescriptionPdf
  // returns a <Document>...</Document> at the top level, so this is safe
  // at runtime — the cast just shrugs past the wrapper component type.
  return await renderToBuffer(
    element as unknown as Parameters<typeof renderToBuffer>[0],
  );
}
