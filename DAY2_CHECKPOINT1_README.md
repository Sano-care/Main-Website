# Day 2 Checkpoint 1 — Sanocare Pulse landing page

Apply on top of the Day 1 v2 (ANM/DNM) zip. Three files:

| File | Status | Purpose |
|---|---|---|
| `src/constants/cms/sanopulse.ts` | **NEW** | All copy/content for the Pulse landing page |
| `src/constants/cms-content.ts` | UPDATED (1 line added) | Re-exports the new `sanopulse` module |
| `src/app/sanopulse/page.tsx` | **NEW** | The route — renders the whole page |

## What you'll see at /sanopulse

- **Hero** — closed-beta framing, ANM/DNM + MBBS + MoHFW 2020 compliant trust bullets, primary CTA "Request beta access" anchoring to the waitlist section, secondary CTA "See what's coming". Live pulse-dot eyebrow.
- **Phone mockup placeholder** — branded placeholder where a real screenshot goes when the Pulse Android UI is built. Replace with `<Image src="/sanopulse-mockup.png" />` when ready.
- **Features grid (6 cards)** — Book in 60s, Track medic, Doctor on video, e-Rx on the spot, Family profiles, Records in one place.
- **"How Pulse fits into your care"** band — short explainer.
- **Roadmap** — Phase 1 (In development · Cohort rollout), Phase 2 (Planned), Phase 3 (Roadmap). Each lists items.
- **Waitlist form** — Netlify-Forms-ready. Form name: `pulse-waitlist`. Honeypot field included. DPDP consent checkbox required. Posts to the homepage (Netlify auto-detects the form) and shows a success/error message in-place. **You must add a form notification in your Netlify dashboard to receive submissions by email.**
- **FAQ** — 6 questions with native `<details>` accordion.
- **DPDP privacy strip** — 4 cards covering encryption, consent, data sale stance, portability, plus the grievance officer line.
- **Final CTA band** — gradient brand-blue panel with both CTAs.

## How to test

```bash
unzip the changeset over your repo
npm run dev
# open http://localhost:3000/sanopulse
```

What to verify:
1. Page renders without TypeScript errors
2. All sections appear in the order above
3. The hero's "Closed beta" badge has the animating pulse dot (defined in globals.css)
4. The waitlist form has 6 inputs + 1 textarea + 1 required consent checkbox
5. Submitting the form (with consent ticked) shows the success message
6. On Netlify (after deploy): a `pulse-waitlist` form appears in Site → Forms

## What this enables

The `Sanocare Pulse is in closed beta` banner in the top bar (already correct as of Day 1 v2) now links to a working page. No more broken promises.

## Known gaps to close in remaining Day 2 work

- `/portal` still says "Coming Q2 2026" — Checkpoint 2 fixes that
- `/privacy`, `/terms`, `/refund`, `/emergency` don't exist yet — Checkpoint 3 adds them
- The Netlify form needs to be configured in your dashboard for notifications. (Form auto-detected on first deploy; you add the email-notification rule manually.)
- The phone mockup is a placeholder; swap when Pulse Android UI is built.
