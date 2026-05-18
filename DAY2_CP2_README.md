# Day 2 Checkpoint 2 — Approved v3 + phone update + GNM revert

This zip layers cleanly on top of **Day 1 v2** AND **Day 2 CP1 (`/sanopulse`)**.

If you've already applied Day 1 v2 and Day 2 CP1, just unpack this zip over the same repo and the v3 preview decisions become the live Next.js content.

## What's in this zip

| File | Change |
|---|---|
| `src/app/layout.tsx` | New `<title>` and OG/Twitter titles: **"Sanocare — Trusted Healthcare at Home in 30 mins. South Delhi."** Reverted to "GNM / B.Sc Nursing-qualified medics" everywhere. |
| `src/constants/pricing.ts` | "GNM / B.Sc Nursing-qualified medic" in SKU descriptions (reverted from ANM/DNM). |
| `src/constants/cms/home.ts` | Hero `headingPrefix` = **"Trusted Healthcare at Home in"**, `headingHighlight` = **"30 mins."** Sub-copy says GNM / B.Sc Nursing. |
| `src/constants/cms/shared.ts` | New phone `+91-9711977782` in floatingSidebar (Call + WhatsApp) and mobileStickyBar. GNM revert in footer description + trust badge. Grammar fix "An GNM" → "A GNM". |
| `src/constants/cms/sanopulse.ts` | Phone updated in the FAQ answer. |
| `src/constants/cms/pages.ts` | Phone updated everywhere it appears (services, contact, advantage CTAs, etc. — 10 instances). |
| `src/constants/cms/system.ts` | Phone updated in `helpPhone` and `contactPhone`. |
| `src/constants/content.ts` + `src/constants/content.tsx` | Phone updated in legacy content constants. |
| `src/hooks/useBookingSubmit.ts` | Phone updated in three error messages (NETWORK / SERVER / UNKNOWN). |

## How to apply

```bash
# from your local Main-Website root
unzip ~/Downloads/Sanocare_Day2_CP2_v3_Approved.zip
# overwrite when prompted
npm run dev
# open http://localhost:3000
```

What to verify:
1. Header wordmark: **Sanocare** in Inter Semibold blue, with **"YOUR HEALTH, OUR PRIORITY"** coral mono tag underneath.
2. Hero H1: **"Trusted Healthcare at Home in 30 mins."** (the previous "A nurse / A doctor on video" split is gone).
3. Booking form sub: **"₹249 to confirm. Balance auto-charged on case close."**
4. Footer + sticky bar + WhatsApp link + Call link all show **+91-97119 77782**.
5. `view-source:` confirms `<meta name="theme-color" content="#2B81FF">` and the new title.
6. Visiting `/sanopulse` lands on the new page (from CP1) — closed-beta hero, waitlist form, the works.

## Not in this zip — still pending for Day 2 CP3

- `/portal` honest copy update (the existing "Coming Q2 2026" content still shows)
- The four legal pages: `/privacy`, `/terms`, `/refund`, `/emergency` (will be created from the `sanocare_legal_pages.md` bundle)
- The gallery banner from the preview v3 — needs a new component + section added to `src/app/page.tsx` + content in `home.ts`. This is moderate effort; I'll do it as CP4.
- `/now` and `/carehub` page-copy refresh in `pages.ts` to align with the new model.

## ANM/DNM ↔ GNM/B.Sc Nursing — open question for you separately

Your **Sanocare Legality Framework** mandates ANM/DNM. The website now uses GNM/B.Sc Nursing per your direction. The framework document and the website are saying different things about who can administer injections. Worth raising with whoever drafted the framework so they stay in sync. The framework wins if a regulator ever audits — so either the framework needs updating (to allow GNM/B.Sc as acceptable higher qualification) or the website does.
