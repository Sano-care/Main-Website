/**
 * T90 Slice 2 Step 13 — Phase 3 documents placeholder (Profile tab).
 *
 * Static, non-interactive card. Brief Surface 8:
 *   Headline: "📄  Reports & prescriptions"
 *   Subtext:  "Coming soon — upload your old records to keep them
 *              in one place."
 *
 * Phase 3 brief will land the actual implementation
 * (`pulse-documents` Storage bucket with per-member RLS).
 */
export default function PlaceholderDocumentsCard() {
  return (
    <section
      aria-disabled="true"
      className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
    >
      <p className="text-sm font-semibold text-text-secondary">
        <span aria-hidden="true">📄</span> Reports &amp; prescriptions
      </p>
      <p className="mt-1 text-xs text-text-secondary">
        Coming soon — upload your old records to keep them in one place.
      </p>
    </section>
  );
}
