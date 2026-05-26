// Server-side render of a PrescriptionPdf to a PDF byte buffer.
//
// Used by sendPrescription() in src/app/doctor/_actions/prescription.ts.
// Returns a Buffer that's uploaded into the private 'prescriptions'
// Supabase storage bucket; the patient-view route (/rx/[token]) then
// mints a short-lived signed URL on read.
//
// Font registration: Inter Regular + Bold from src/lib/rx/pdf/fonts/.
// Next.js's outputFileTracingIncludes (see next.config.ts) bundles the
// TTFs into every function reachable from doctor / ops / api / rx
// routes, so process.cwd()-relative reads work in production.
//
// Signature handling: this module also resolves the doctor's signature
// storage path into a base64 data URL (PNG / JPG) by downloading the
// object from the private 'doctor-signatures' bucket via the service
// role. We embed-as-data-url rather than passing a signed URL because
// @react-pdf/renderer fetches Image src at render time, and serverless
// functions don't always have outbound HTTPS to *.supabase.co within
// the React-PDF fetch sandbox.

import { renderToBuffer, Font } from "@react-pdf/renderer";
import { createElement } from "react";
import path from "path";
import { PrescriptionPdf, type PrescriptionPdfData } from "./PrescriptionPdf";
import { supabaseAdmin } from "@/lib/supabase-server";

// ---------------------------------------------------------------------
// Font registration — runs once per Node process (module-load idempotent).
//
// @react-pdf/renderer's Node target accepts an absolute file path as the
// `src` for Font.register, which it loads at render time. The TTFs live
// alongside this module under ./fonts/; Next.js's
// outputFileTracingIncludes (see next.config.ts) bundles them into every
// function that can reach this code.
// ---------------------------------------------------------------------
let fontsRegistered = false;
function registerInterOnce() {
  if (fontsRegistered) return;

  const fontsDir = path.join(process.cwd(), "src/lib/rx/pdf/fonts");
  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(fontsDir, "Inter-Regular.ttf") },
      { src: path.join(fontsDir, "Inter-Bold.ttf"), fontWeight: "bold" },
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
// The doctor.signature_image_url column stores the storage path (NOT a
// URL). At Rx send time we download the bytes via the service-role
// client and convert to a data: URL the PDF Image component can render.
// ---------------------------------------------------------------------
const SIGNATURES_BUCKET = "doctor-signatures";

function mimeForSignaturePath(storagePath: string): string {
  const ext = storagePath.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  // Conservative fallback. React-PDF accepts PNG / JPG; if a signature
  // was uploaded with a weird extension the upload guard should have
  // rejected it, but we don't want this fn to silently produce a
  // broken data URL — call it out to the caller.
  throw new Error(
    `Unsupported signature image extension on ${storagePath} — expected png/jpg/jpeg/webp.`,
  );
}

export async function resolveSignatureToDataUrl(
  storagePath: string,
): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(SIGNATURES_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new Error(
      `Could not download doctor signature from ${SIGNATURES_BUCKET}/${storagePath}: ${
        error?.message ?? "no data"
      }`,
    );
  }
  const arr = new Uint8Array(await data.arrayBuffer());
  const base64 = Buffer.from(arr).toString("base64");
  return `data:${mimeForSignaturePath(storagePath)};base64,${base64}`;
}

// ---------------------------------------------------------------------
// Main entry point
//
// signatureSource: 'placeholder' draws the underline; 'storagePath'
// downloads from the doctor-signatures bucket and embeds. We accept the
// storage path here (not a pre-resolved data URL) so all the byte
// shuffling stays inside this module, and the server action just calls
// renderPrescriptionPdf({ ..., signatureSource: { kind: 'storagePath',
// path: doctor.signature_image_url } }).
// ---------------------------------------------------------------------
export type RenderSignatureSource =
  | { kind: "placeholder" }
  | { kind: "storagePath"; path: string }
  | { kind: "dataUrl"; dataUrl: string };

export async function renderPrescriptionPdf(args: {
  data: PrescriptionPdfData;
  signature: RenderSignatureSource;
}): Promise<Buffer> {
  registerInterOnce();

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
