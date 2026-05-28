// Server-side render of a PrescriptionPdf to a PDF byte buffer.
//
// Used by sendPrescription() in src/app/doctor/_actions/prescription.ts.
// Returns a Buffer that's uploaded into the private 'prescriptions'
// Supabase storage bucket; the patient-view route (/rx/[token]) then
// mints a short-lived signed URL on read.
//
// v5 renderer scope (post-v3/v4 rewrite — clean tabular sans-serif):
//
//   - Font registration: Inter only (variable TTF; weights 400/500/
//     600/700/800). No italics. Cormorant Garamond + Source Serif 4
//     were dropped in v5 — the layout is sans-serif throughout.
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
// v5 dropped from v3/v4 (deliberate):
//
//   - Cormorant Garamond + Source Serif 4 font bundles + italic VFs
//   - QR generation (qrcode npm package uninstalled)
//   - Stamp resolution (doctor.stamp_image_url column kept in DB for
//     future v6 but not rendered by v5)
//   - Watermark SVG component
//   - Cream paper background, inset double-rule frame, doc-meta strip

import { renderToBuffer, Font } from "@react-pdf/renderer";
import { createElement } from "react";
import path from "path";
import { PrescriptionPdf, type PrescriptionPdfData } from "./PrescriptionPdf";
import { supabaseAdmin } from "@/lib/supabase-server";

// ---------------------------------------------------------------------
// Font registration — runs once per Node process (module-load idempotent).
//
// Single family: Inter, variable TTF (wght axis). We register five
// weight buckets — @react-pdf maps fontWeight on a Text/View style
// to the corresponding axis position at render time, producing
// rendered glyphs at 400/500/600/700/800 from a single file.
//
// The TTF lives alongside this module under ./fonts/; Next.js's
// outputFileTracingIncludes (see next.config.ts) bundles it into
// every function that can reach this code, so process.cwd()-relative
// reads work in production.
// ---------------------------------------------------------------------
let fontsRegistered = false;
function registerFontsOnce() {
  if (fontsRegistered) return;

  const fontsDir = path.join(process.cwd(), "src/lib/rx/pdf/fonts");
  const inter = path.join(fontsDir, "Inter-Variable.ttf");

  Font.register({
    family: "Inter",
    fonts: [
      { src: inter, fontWeight: 400 },
      { src: inter, fontWeight: 500 },
      { src: inter, fontWeight: 600 },
      { src: inter, fontWeight: 700 },
      { src: inter, fontWeight: 800 },
    ],
  });

  // @react-pdf/renderer tries hyphenation when wrapping long words and
  // calls out to a hyphenation engine that fetches dictionaries over
  // the network — disable it; we don't need it and don't want runtime
  // outbound calls from the renderer.
  Font.registerHyphenationCallback((word) => [word]);

  fontsRegistered = true;
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
  registerFontsOnce();

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
