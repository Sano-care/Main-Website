// Real-render smoke test — actually drives @react-pdf/renderer end to end (the
// route test mocks the renderer, so this is where we prove the receipt template
// renders: standard fonts, inline butterfly SVG, layout). Node env, no mocks.

import { describe, it, expect } from "vitest";

import { renderReceiptPdf } from "./renderReceiptPdf";
import type { ReceiptPdfData } from "./ReceiptPdf";

const base: ReceiptPdfData = {
  receipt_no: "SAN-B-00042",
  date_display: "10 Jun 2026",
  bill_to: "Asha Patel",
  service_label: "Lab Test at Home",
  amount_display: "₹1,200.50",
  status: "CAPTURED",
  payment_ref: "pay_ABCD1234WXYZ",
};

function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

describe("renderReceiptPdf", () => {
  it("renders a valid, non-trivial PDF for a CAPTURED receipt", async () => {
    const buf = await renderReceiptPdf(base);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(isPdf(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("renders for a REFUNDED receipt and one with no payment_ref", async () => {
    const refunded = await renderReceiptPdf({ ...base, status: "REFUNDED" });
    expect(isPdf(refunded)).toBe(true);
    const noRef = await renderReceiptPdf({ ...base, payment_ref: null });
    expect(isPdf(noRef)).toBe(true);
  });
});
