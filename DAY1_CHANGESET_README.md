# Sanocare Rebuild — Day 1 Changeset

> **Drop this on top of your existing repo** — overwrite the five files below in place, run `npm install`, then `npm run dev`. Nothing else changes.

## Files changed (5)

| File | What changed |
|---|---|
| `src/app/layout.tsx` | Replaced Playfair + Manrope fonts with **Inter + IBM Plex Mono**. Fixed `theme-color` from `#2563eb` → **`#2B81FF`** (brand). Rewrote `<title>`, description, OG, Twitter meta to the medic + virtual-doctor model. Added a full **JSON-LD structured-data block** (`MedicalBusiness` + `LocalBusiness` + `AggregateRating` 4.7/75 reviews + `PostalAddress` with the registered office + `identifier` with the CIN). |
| `src/app/globals.css` | Corrected primary blue `#2b8cee` → **`#2B81FF`** everywhere. Added a single-saturation blue ramp (`primary-50/100/300/700/900`). Added **coral accent** tokens (`#F4845A`). Switched font tokens from Manrope/Playfair to Inter. Added `.btn-accent` utility and `.sano-pulse-dot` (with `@keyframes sano-pulse`) for the live-status eyebrow. |
| `src/constants/pricing.ts` | Rewrote the SKU catalog to the locked pricing: home visit ₹499, nursing-only ₹199, teleconsult ₹399, lab free + pay-per-test, night surge ₹799. Added `BOOKING_FEE = 249` (the partial-prepay amount per the Pulse spec), `NIGHT_SURGE_PRICE`, a `pricingMode` discriminator on each SKU, and a `formatDisplayPrice()` helper that emits "Starting from ₹X" / "Free home collection · pay per test" / etc. depending on mode. Legacy mappings preserved. |
| `src/constants/cms/home.ts` | Updated hero copy to the new clinical-precise voice: headline *"A nurse at home in 30 minutes. A doctor on live video."*, sub describing the GNM + MBBS + e-prescription + MoHFW 2020 model, three stats (median time-to-medic, 1,000+ visits delivered, ★ 4.7 from 75 reviews). Updated `bookingForm.title` / `subtitle` to reflect the ₹249 partial-prepay. Rewrote `serviceOptions` to the four locked SKUs with prefix labels. |
| `src/constants/cms/shared.ts` | Top banner: three rotating announcements — **Sanocare Pulse closed beta**, *Now serving Kalkaji & Govindpuri Extension in under 30 minutes*, and the emergency-boundary disclaimer pointing to **112**. Navbar wordmark: dropped the `Sano` + italic `care` colour split, now a **single-word minimalist** "Sanocare" (matches your decision). Added `/sanopulse` to nav. Footer: brand description rewritten, trust badges, real service links with prices, real legal links (`/privacy`, `/terms`, `/refund`, `/emergency`) replacing the `/coming-soon/*` stubs, **CIN + registered office + grievance officer in the legal strip**, copyright updated. |

## Files NOT changed in Day 1 (in your repo but will need updates on Day 2 / Day 3)

- The individual `.tsx` components (Hero, StatsBar, TopBanner, Footer, Navbar, etc.) — **no edits needed** because they read from the CMS constants we just rewrote. Layout, typography, palette will pick up automatically via Tailwind 4 tokens.
- `src/app/page.tsx` — already orchestrates the homepage correctly; no edits.
- The `BookingModal`, `Hero`'s booking-form section — the form still works; Day 3 will swap the submission target to Razorpay test mode + add the `/book` route.
- `/sanopulse`, `/book`, `/privacy`, `/terms`, `/refund`, `/emergency` routes — **need to be created in Day 2 / Day 3** (the constants now link to them but the pages don't exist yet).

## How to test locally

```bash
# from inside Main-Website
npm install
npm run dev
# open http://localhost:3000
```

What to verify:
1. The header wordmark now says "Sanocare" in plain Inter Semibold (no italic split).
2. The top banner rotates through three announcements; the first one is **Sanocare Pulse is in closed beta**.
3. The hero headline reads *"A nurse at home in 30 minutes. A doctor on live video."*
4. The booking-form card shows "Book a visit in 60 seconds" with "₹249 to confirm…" sub.
5. The service dropdown lists four SKUs with **Starting from** prefixed pricing.
6. View page source — confirm the `<meta name="theme-color">` is `#2B81FF` and the JSON-LD structured data block is present.
7. Open browser devtools → Network → Fonts — confirm Inter is loading.

## If something breaks

The most likely failure mode is a `.tsx` component referencing an old constant key (e.g., a wordmark `<span>` that expected the italic split). Symptoms: header looks weird, missing text, or a TypeScript build error.

If you see a build error:
- Send me the error message and the failing file path; I'll fix it in the next iteration.
- If urgent, you can revert just `src/constants/cms/shared.ts` back to the original and the wordmark will return to its old split style while the rest of the brand updates stand.

## What's coming on Day 2

- `/sanopulse` landing page (waitlist form via Netlify Forms initially)
- `/portal` honest "Coming with Pulse" copy update
- Four legal pages: `/privacy`, `/terms`, `/refund`, `/emergency` (using the legal-pages bundle copy we already wrote)
- `/services` page upgraded with the four SKUs and their detail sections
- `/about` refresh with the real 1,000+ visits and 4.7★ rating

## What's coming on Day 3

- `/book` dedicated route (the hash-anchored modal becomes a real page)
- Razorpay test-mode integration (₹249 partial-prepay)
- Refund-before-dispatch logic in the booking flow
- `sitemap.xml` and `robots.txt`
- OG card image update (the existing `/og-image.png` references the old voice)
- Deploy
