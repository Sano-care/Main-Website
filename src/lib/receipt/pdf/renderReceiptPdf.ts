// Server-side render of a ReceiptPdf to a PDF byte buffer.
//
// Same stack as renderPrescriptionPdf.ts (@react-pdf/renderer renderToBuffer) —
// no second PDF library. Simpler than the Rx path: a receipt has no signature /
// image bytes to resolve, so this is just hyphenation-disable + renderToBuffer.
// Standard PDF fonts only (Helvetica / Courier) → no Font.register, no TTF
// bundling, no outputFileTracingIncludes.

import { renderToBuffer, Font } from "@react-pdf/renderer";
import { createElement } from "react";

import { ReceiptPdf, type ReceiptPdfData } from "./ReceiptPdf";

// One-time hyphenation disable — same reason as the Rx renderer: @react-pdf's
// default callback would otherwise reach for a hyphenation dictionary over the
// network on long-word wrap. Idempotent.
let hyphenationDisabled = false;
function disableHyphenationOnce() {
  if (hyphenationDisabled) return;
  Font.registerHyphenationCallback((word) => [word]);
  hyphenationDisabled = true;
}

export async function renderReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  disableHyphenationOnce();
  const element = createElement(ReceiptPdf, { data });
  // renderToBuffer expects a ReactElement<DocumentProps>; ReceiptPdf returns a
  // <Document> at the top level, so the cast just shrugs past the wrapper type.
  return await renderToBuffer(
    element as unknown as Parameters<typeof renderToBuffer>[0],
  );
}
