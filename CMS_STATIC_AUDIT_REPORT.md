# CMS Static Content Audit Report

Last updated: 2026-04-11
Scope: Marketing + informational surfaces and supporting content data

## 1) Validation and Test Results

1. Lint validation on refactored set: PASS.
- Command run: `npm run lint -- src/constants/cms-content.ts ... src/app/about/page.tsx`
- Status: success, no lint errors/warnings in the audited refactor set.

2. Production build validation: BLOCKED by external font fetch, not by local refactor logic.
- Command run: `npm run build`
- Status: failed.
- Cause: `next/font` could not fetch Google fonts (`Manrope`, `Playfair Display`) from `fonts.googleapis.com` due to connection issue.
- Affected import path: `src/app/layout.tsx`

3. Static-array sweep in app/components:
- Regex check: `const <name> = [` in `src/app/**/*.tsx` + `src/components/**/*.tsx`
- Result: only Ops dashboard arrays remain; no marketing arrays left.

## 2) What Is Already Centralized

All major marketing arrays have been moved to:
- `src/constants/cms-content.ts`

Refactored consumers include:
- Shared components: Hero, Features, StatsBar, Journey, Testimonials, Insights, Accreditations, TopBanner, Navbar, Footer, FloatingSidebar, MobileStickyBar, BookingModal, SanocareAdvantage.
- Page surfaces: Services, NOW, CareHub, Contact, Research, About.

## 3) Remaining Static Datapoints (Cross-Check)

These values are still hardcoded in TSX/TS and are candidates for final extraction into constants/CMS payloads.

### A. Homepage + Shared Components

1. Hero copy and booking UI microcopy in `src/components/Hero.tsx`
- Static badge/title/description/stats/trust text and several form labels/placeholders/button/helper strings remain inline.
- Representative lines: 137, 147, 156, 163, 170, 177, 233, 237, 245, 247, 257, 268, 282, 297, 302, 357, 368.

2. Feature/section headings in section components
- `src/components/Features.tsx`: section labels/headings still inline.
- `src/components/StatsBar.tsx`: heading + explanatory paragraph inline.
- `src/components/Journey.tsx`: section heading/subheading inline.
- `src/components/Testimonials.tsx`: heading labels inline.
- `src/components/Insights.tsx`: heading labels inline.
- `src/components/Accreditations.tsx`: heading line inline.

3. Booking modal UI text in `src/components/BookingModal.tsx`
- Modal heading, process copy, labels/placeholders, CTA strings, helper text remain inline.
- Representative lines: 149, 161, 167, 235, 237, 243, 246, 268, 270, 323, 335, 349, 359.

### B. Services, NOW, CareHub, Contact, Research, About Pages

1. `src/app/services/page.tsx`
- Hero/subsection headings, CTA labels, trust/cta copy remain inline.
- Hero/process images are hardcoded Unsplash URLs.
- Representative URL lines: 94, 235.

2. `src/app/now/page.tsx`
- Hero and section headers, CTA/button strings, trust block copy remain inline.
- Multiple hardcoded image URLs and tel links.
- Representative URL lines: 97, 227, 417, 79, 449.

3. `src/app/carehub/page.tsx`
- Hero and inquiry section copy, labels/placeholders, CTA strings remain inline.
- Hardcoded image URLs and tel links remain inline.
- Representative URL lines: 176, 334, 158, 390, 556.
- Representative form literal lines: 426, 428, 434, 437, 445, 448, 455, 457, 465, 467, 473, 476, 489.

4. `src/app/contact/page.tsx`
- Contact form labels/placeholders/success+error copy and map card copy remain inline.
- Embedded map URL remains inline.
- Representative map line: 277.
- Representative CTA/tel line: 320.

5. `src/app/research/page.tsx`
- Hero/section headings, quote block, CTA strings remain inline.
- Hero image URL remains inline at line 97.

6. `src/app/about/page.tsx`
- Section framing text and CTA labels remain inline.
- Placeholder comments and image placeholders still present.
- Example line with inline CTA text: 376.

### C. Blog Surface (High Priority for CMS)

1. Blog data source is fully code-static in `src/data/blog-posts.ts`
- Post metadata + markdown content are hardcoded.
- This is expected pre-CMS but still a major static data surface.

2. Blog detail template copy in `src/app/blog/[slug]/page.tsx`
- Template microcopy remains inline: breadcrumb labels, share/profile labels, key takeaway text, newsletter copy.
- Newsletter form placeholder/button text inline.

### D. Other Informational Pages Outside Main Refactor Slice

1. `src/app/coming-soon/[slug]/page.tsx`
- Contains static descriptions and TODO marker for notification flow.

2. `src/app/not-found.tsx`
- Contains hardcoded contact/tel copy.

### E. Ops (Intentionally Out of CMS Marketing Scope)

Remaining arrays in Ops dashboard:
- `src/app/ops/dashboard/components/CompleteVisitModal.tsx`
- `src/app/ops/dashboard/components/FieldForce.tsx`
- `src/app/ops/dashboard/components/LivePulseMonitor.tsx`

These should remain separate unless you explicitly want Ops CMS-managed too.

## 4) Placeholder and Incomplete Datapoints

Found in `src/constants/cms-content.ts` (About block):
- `city: "[City]"` line 846
- `state: "[State]"` line 847
- `founderName: "[Founder Name]"` line 851
- milestone years with `[Year]` lines 904, 911, 918

These are centralized but still placeholder content, not production-ready.

## 5) What Can Be Converted Next (Concrete Backlog)

### Priority 1 (fast, high-impact)

1. Form microcopy constants
- Extract all labels/placeholders/helper/success/error strings from:
  - Hero booking form
  - Booking modal
  - CareHub inquiry form
  - Contact form

2. CTA and section heading constants
- Extract all `h1/h2/h3`, badge labels, CTA button labels from:
  - Features, StatsBar, Journey, Testimonials, Insights, Accreditations
  - Services, NOW, CareHub, Contact, Research, About

3. URL constants
- Move all remaining `tel:`, `mailto:`, maps embed URL, and image URLs into centralized constants fields.

### Priority 2 (CMS-shape alignment)

1. Add explicit content keys in constants matching CMS entities:
- `siteConfig`
- `navigation`
- `pageCopy.<slug>.hero`
- `pageCopy.<slug>.sections`
- `forms.booking`
- `forms.contact`
- `forms.carehub`
- `assets.<page/section>`

2. Move blog template literals into constants
- Keep article body in data source for now, but extract template copy to constants.

### Priority 3 (direct CMS-read readiness)

1. Introduce `CmsService` adapters with read-through fallback:
- Try CMS value first.
- Fallback to `cms-content.ts` constants.

2. Add a deterministic content map file:
- field-to-component prop mapping for all sections.

## 6) Migration Risk Notes

1. Build blocker currently depends on network access to Google Fonts.
- To make CI/staging deterministic, consider self-hosting fonts or using local fallback in `src/app/layout.tsx`.

2. Content drift risk remains until single-value strings are centralized.
- Arrays are centralized now, but inline literals still create drift vectors.

## 7) Completion Metric (Current Status)

1. Array-level centralization in marketing surface: ~90% complete.
2. Single-string/microcopy centralization: ~45-55% complete.
3. CMS-read abstraction (`CmsService`) wiring: not started.
4. Blog CMS migration: not started.
