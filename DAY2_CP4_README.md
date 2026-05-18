# Day 2 Checkpoint 4 — /portal honest copy + 4 legal routes + tagline injection

Layers on top of every prior checkpoint (Day 1 v2 + CP1 + CP2 + Social Patch + CP3).

## What this gives you

1. **`/portal` stops promising a stale Q2 2026 date.** New copy reframes the page as "Coming with Sanocare Pulse" — directs portal-curious visitors to the Pulse beta waitlist.
2. **Four legal routes go live:** `/privacy`, `/terms`, `/refund`, `/emergency`. Each renders a clean long-form layout with the markdown content from the legal-pages bundle.
3. **"YOUR HEALTH, OUR PRIORITY" tagline** appears as a small coral mono-strip directly under the "Sanocare" wordmark in both the Navbar and Footer — gives the lockup a subtle dual-colour identity without breaking the single-colour wordmark decision.

## Files in this zip (9 total)

| File | Status | What |
|---|---|---|
| `src/constants/cms/system.ts` | UPDATED | `PORTAL_PAGE_CONTENT` — single-word wordmark, "Coming with Sanocare Pulse" badge, honest features description, waitlist CTA, dropped Q2 2026 date, new copyright |
| `src/constants/cms/legal.ts` | NEW | All four legal documents as TypeScript constants (markdown bodies). DPDP 2023 compliant Privacy Policy, Terms of Service, Refund & Cancellation Policy, Emergency Disclaimer. ~520 lines total. |
| `src/constants/cms-content.ts` | UPDATED | Re-exports the new `legal` module |
| `src/components/legal/LegalLayout.tsx` | NEW | Shared layout for the four legal pages — title hero with last-updated/effective dates, markdown body rendered via react-markdown with custom styling, grievance officer contact strip, cross-links to sibling docs |
| `src/app/privacy/page.tsx` | NEW | `/privacy` route — renders `LEGAL_CONTENT.privacy` via `LegalLayout` |
| `src/app/terms/page.tsx` | NEW | `/terms` route |
| `src/app/refund/page.tsx` | NEW | `/refund` route |
| `src/app/emergency/page.tsx` | NEW | `/emergency` route |
| `src/components/Navbar.tsx` | UPDATED | Wordmark restructured to a 2-line flex column: "Sanocare" in Inter Semibold brand blue + "YOUR HEALTH, OUR PRIORITY" in coral mono underneath. Tagline hidden on mobile (`sm:` breakpoint) to keep small-screen header tight. |
| `src/components/Footer.tsx` | UPDATED | Same tagline treatment in the footer brand column |

## How to apply

```bash
# from your local Main-Website root
unzip ~/Downloads/Sanocare_Day2_CP4_Legal_Tagline.zip
# overwrite when prompted (no new deps to install)
npm run dev
# open http://localhost:3000
```

## Things to verify after applying

1. **Header wordmark:** "Sanocare" in brand blue with **"YOUR HEALTH, OUR PRIORITY"** in coral mono right under it. Logo is slightly larger than before (44px → 44px md+).
2. **Footer wordmark:** Same treatment in the brand column.
3. **Visit `/portal`** — H1 now reads "Your patient portal is being **built into Sanocare Pulse**" with a "Join the Pulse beta waitlist" primary CTA. No more "Q2 2026" promise.
4. **Visit `/privacy`** — full Privacy Policy renders, with a hero block (title, subtitle, last-updated/effective dates) and 13 markdown sections. Contact strip at the bottom links to the grievance officer.
5. **Same for `/terms`, `/refund`, `/emergency`** — each gets its own page with its own content.
6. **Cross-links** — at the bottom of every legal page, you'll see three pill links to the other three legal pages. Lets users hop between docs without going back to the footer.
7. **Footer legal links** — the existing legal column in the footer (Privacy / Terms / Refund / Emergency / Grievance Officer) now points to real pages, not 404s.

## Important: legal review reminder

These pages are written to be DPDP Act 2023, Telemedicine Practice Guidelines 2020, and Indian contract-law compliant — but they're AI-generated drafts. **Before going live, have them reviewed by a healthcare-focused lawyer or Company Secretary.** Estimated cost: ₹5K–₹20K. Estimated turnaround: 3–5 working days. The cost is far smaller than the downside of unreviewed legal text on a healthcare site.

## What's NOT in this checkpoint (still queued)

- **Lab tests search widget** — file received, 1900 tests parsed to `public/lab-tests.json` (998 KB). Search component + `/lab-tests` page + `/services` embed + homepage hero search ships as CP5 next.
- **`/now` and `/carehub`** copy refresh (alignment with master brand + sub-brand model)
- **Gallery banner** integration (awaiting Drive link with real assets)
- **Day 3 deploy** — `/api/razorpay/refund`, `/api/razorpay/webhook`, dedicated `/book` route, `sitemap.xml`, `robots.txt`, new OG card image

## Quick gotcha

The legal pages render with **`react-markdown`** which is already in your `package.json` (10.1.0 from the original codebase) — no new dependencies needed for CP4.

If you see a TypeScript error about `LegalDocument` not being exported, make sure `src/constants/cms-content.ts` includes `export * from "./cms/legal";` at the bottom.
