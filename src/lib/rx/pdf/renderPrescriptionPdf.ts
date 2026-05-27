// Server-side render of a PrescriptionPdf to a PDF byte buffer.
//
// Used by sendPrescription() in src/app/doctor/_actions/prescription.ts.
// Returns a Buffer that's uploaded into the private 'prescriptions'
// Supabase storage bucket; the patient-view route (/rx/[token]) then
// mints a short-lived signed URL on read.
//
// Font registration: three families bundled as variable TTFs under
// src/lib/rx/pdf/fonts/ — Cormorant Garamond (serif headings),
// Source Serif 4 (clinical prose), Inter (tabular figures). Each
// family is registered multiple times with distinct fontWeight values
// pointing to the same variable file; @react-pdf maps fontWeight to
// the font's wght axis at render time, producing rendered glyphs at
// 500/600/700 etc. without separate static instances. Next.js's
// outputFileTracingIncludes (see next.config.ts) bundles the TTFs
// into every function reachable from doctor / ops / api / rx routes,
// so process.cwd()-relative reads work in production.
//
// Signature handling: this module also resolves the doctor's signature
// storage path into a base64 data URL (PNG / JPG) by downloading the
// object from the private 'doctor-signatures' bucket via the service
// role. We embed-as-data-url rather than passing a signed URL because
// @react-pdf/renderer fetches Image src at render time, and serverless
// functions don't always have outbound HTTPS to *.supabase.co within
// the React-PDF fetch sandbox. The same pattern is used for the
// doctor's optional rubber-stamp image (doctor-stamps bucket).

import { renderToBuffer, Font } from "@react-pdf/renderer";
import { createElement } from "react";
import path from "path";
import QRCode from "qrcode";
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
//
// All three families are variable fonts. Registering the same `src`
// multiple times with different `fontWeight` values tells @react-pdf to
// map each style request to the correct point on the wght variation
// axis. Source Serif 4 and Inter also expose an opsz (optical-size)
// axis; @react-pdf doesn't pass an optical-size hint, so the renderer
// gets the default optical size — fine for our use at 9–11 pt.
// ---------------------------------------------------------------------
let fontsRegistered = false;
function registerFontsOnce() {
  if (fontsRegistered) return;

  const fontsDir = path.join(process.cwd(), "src/lib/rx/pdf/fonts");
  // Upright (wght-axis) variable TTFs.
  const cormorant = path.join(fontsDir, "CormorantGaramond-Variable.ttf");
  const sourceSerif = path.join(fontsDir, "SourceSerif4-Variable.ttf");
  const inter = path.join(fontsDir, "Inter-Variable.ttf");
  // Italic VFs — separate files on Google Fonts because each family
  // ships upright and italic as distinct variable axes. @react-pdf
  // resolves `fontStyle: 'italic'` against entries that explicitly
  // declare fontStyle: 'italic'; without them the renderer throws
  // "Could not resolve font for <family>, fontWeight X, fontStyle italic"
  // when the template uses italic anywhere. (The v3 template uses
  // italic on the Rx ℞ symbol, drug-composition lines, advice list
  // sub-labels, auth-note copy, NMC compliance footnote, etc.)
  const cormorantItalic = path.join(
    fontsDir,
    "CormorantGaramond-Italic-Variable.ttf",
  );
  const sourceSerifItalic = path.join(
    fontsDir,
    "SourceSerif4-Italic-Variable.ttf",
  );
  const interItalic = path.join(fontsDir, "Inter-Italic-Variable.ttf");

  Font.register({
    family: "CormorantGaramond",
    fonts: [
      { src: cormorant, fontWeight: 500 },
      { src: cormorant, fontWeight: 600 },
      { src: cormorant, fontWeight: 700 },
      { src: cormorantItalic, fontWeight: 500, fontStyle: "italic" },
      { src: cormorantItalic, fontWeight: 600, fontStyle: "italic" },
      { src: cormorantItalic, fontWeight: 700, fontStyle: "italic" },
    ],
  });

  Font.register({
    family: "SourceSerif4",
    fonts: [
      { src: sourceSerif, fontWeight: 400 },
      { src: sourceSerif, fontWeight: 500 },
      { src: sourceSerif, fontWeight: 600 },
      { src: sourceSerif, fontWeight: 700 },
      { src: sourceSerifItalic, fontWeight: 400, fontStyle: "italic" },
      { src: sourceSerifItalic, fontWeight: 500, fontStyle: "italic" },
      { src: sourceSerifItalic, fontWeight: 600, fontStyle: "italic" },
      { src: sourceSerifItalic, fontWeight: 700, fontStyle: "italic" },
    ],
  });

  Font.register({
    family: "Inter",
    fonts: [
      { src: inter, fontWeight: 400 },
      { src: inter, fontWeight: 500 },
      { src: inter, fontWeight: 600 },
      { src: inter, fontWeight: 700 },
      { src: interItalic, fontWeight: 400, fontStyle: "italic" },
      { src: interItalic, fontWeight: 500, fontStyle: "italic" },
      { src: interItalic, fontWeight: 600, fontStyle: "italic" },
      { src: interItalic, fontWeight: 700, fontStyle: "italic" },
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
// Signature + stamp resolution
//
// The doctor.signature_image_url and doctor.stamp_image_url columns
// each store a storage path (NOT a URL). At Rx send time we download
// the bytes via the service-role client and convert to a data: URL the
// PDF Image component can render directly without an outbound HTTPS
// fetch at PDF-render time.
//
// The signature bucket and the stamp bucket are distinct because they
// have different RLS/upload guards and different size caps (signatures
// ~500 KB; stamps may end up larger if they include circular borders).
// ---------------------------------------------------------------------
const SIGNATURES_BUCKET = "doctor-signatures";
const STAMPS_BUCKET = "doctor-stamps";

function mimeForImagePath(storagePath: string, what: string): string {
  const ext = storagePath.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  // Conservative fallback. React-PDF accepts PNG / JPG / WebP; if a
  // file was uploaded with a weird extension the upload guard should
  // have rejected it, but we don't want this fn to silently produce a
  // broken data URL — call it out to the caller.
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

export async function resolveStampToDataUrl(
  storagePath: string,
): Promise<string> {
  return resolveBucketPathToDataUrl(STAMPS_BUCKET, storagePath, "stamp");
}

// ---------------------------------------------------------------------
// QR generation
//
// The footer carries a verification QR. For v3 the QR points at the
// Sanocare homepage; later phases may switch to a per-Rx verification
// page. We generate the QR as a PNG data URL at render time so the
// PDF stays fully self-contained (no outbound fetch at render time).
//
// Tuning notes:
//   - errorCorrectionLevel 'M' (15% recovery) is the right balance for
//     a printed/photographed prescription scan.
//   - 240px is large enough to scan from a phone photo; the PDF box
//     resizes it down to ~58pt anyway.
//   - Dark colour matches the navy ink; light is paper-white so the
//     QR reads cleanly on the cream background.
// ---------------------------------------------------------------------
async function generateVerificationQrDataUrl(): Promise<string> {
  return QRCode.toDataURL("https://sanocare.in", {
    errorCorrectionLevel: "M",
    color: { dark: "#0A2670", light: "#FFFFFF" },
    margin: 0,
    width: 240,
  });
}

// ---------------------------------------------------------------------
// Brand lockup PNG
//
// v4 replaced the text wordmark + tagline on page 1 with the horizontal
// Sanocare lockup (icon-left + "SANOCARE" wordmark). The PNG lives in
// src/lib/rx/pdf/assets/ alongside the fonts (both included via the
// outputFileTracingIncludes glob in next.config.ts) and is read once
// per Node process — the asset doesn't change between renders so a
// module-scoped lazy cache is cheap and correct.
//
// We hand the renderer a base64 data URL rather than a filesystem
// path because @react-pdf's <Image src> fetches non-data sources at
// render time, and serverless workers don't always have outbound
// access to the local filesystem under all routing configurations.
// Data URL = bytes embedded in the document, no fetch needed.
// ---------------------------------------------------------------------
let cachedLockupDataUrl: string | null = null;

function loadLockupDataUrl(): string {
  if (cachedLockupDataUrl) return cachedLockupDataUrl;
  const lockupPath = path.join(
    process.cwd(),
    "src/lib/rx/pdf/assets/Sanocare_Lockup_HD_transparent.png",
  );
  // Sync read at first render — ~77 KB file, microsecond-scale on any
  // disk. Reads on every subsequent render return the cached string.
  // If the file is missing (deploy misconfig) we want the failure to
  // surface loudly here, not silently render a missing-asset box.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  const bytes = fs.readFileSync(lockupPath);
  cachedLockupDataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  return cachedLockupDataUrl;
}

// ---------------------------------------------------------------------
// Main entry point
//
// signature / stamp: 'placeholder' draws the v3 dashed-ring (stamp)
// or simple underline (signature); 'storagePath' downloads from the
// respective bucket and embeds. We accept the storage path here (not
// a pre-resolved data URL) so all the byte shuffling stays inside
// this module, and the server action just calls
// renderPrescriptionPdf({
//   data, signature: { kind: 'storagePath', path: doctor.signature_image_url },
//   stamp: doctor.stamp_image_url
//     ? { kind: 'storagePath', path: doctor.stamp_image_url }
//     : { kind: 'placeholder' },
// }).
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
  /** Optional stamp source. If omitted, the renderer assumes
   *  'placeholder' (dashed clinic-seal ring per v3 F2). */
  stamp?: RenderImageSource;
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

  let stampMode: "placeholder" | "embedded" = "placeholder";
  let stampDataUrl: string | null = null;
  const stampSource = args.stamp ?? { kind: "placeholder" as const };

  if (stampSource.kind === "storagePath") {
    stampDataUrl = await resolveStampToDataUrl(stampSource.path);
    stampMode = "embedded";
  } else if (stampSource.kind === "dataUrl") {
    stampDataUrl = stampSource.dataUrl;
    stampMode = "embedded";
  }

  // QR is always generated (used on both draft previews and sent
  // documents). Cheap: ~1 ms in Node for a sub-300px PNG data URL.
  const qrDataUrl = args.data.qr_data_url ?? (await generateVerificationQrDataUrl());

  // Horizontal brand lockup — passed through as a data URL so the
  // template can <Image src={lockupDataUrl}> without a filesystem path.
  // Cached after first read; ~77 KB asset, read once per Node process.
  const lockupDataUrl = loadLockupDataUrl();

  const element = createElement(PrescriptionPdf, {
    data: { ...args.data, qr_data_url: qrDataUrl },
    signatureMode,
    signatureDataUrl,
    stampMode,
    stampDataUrl,
    lockupDataUrl,
  });

  // renderToBuffer expects a ReactElement<DocumentProps>. PrescriptionPdf
  // returns a <Document>...</Document> at the top level, so this is safe
  // at runtime — the cast just shrugs past the wrapper component type.
  return await renderToBuffer(
    element as unknown as Parameters<typeof renderToBuffer>[0],
  );
}
