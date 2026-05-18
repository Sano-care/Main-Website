# Day 2 Checkpoint 5 — Lab tests search (1,900 tests, /lab-tests, homepage embed)

Layers on top of CP1 + CP2 + Social patch + CP3 + CP4.

## What you get

- **`/lab-tests` page** with a prominent search hero. Visitors type any test name (e.g. "vitamin d", "CBC", "thyroid"). Autocomplete shows top 8 matches from the 1,900-test catalog. Selecting a match expands to a full detail card (sample requirement, TAT, method, instructions, clinical utility, price) with a coral **"Book this test at home →"** CTA that opens the booking modal pre-set to the lab-collection SKU.
- **Homepage search section** between the hero and the StatsBar. Same search, lighter framing, with a "See full catalog →" link to `/lab-tests`.
- **Footer link update** — "Lab sample at home" in the Services column now points to `/lab-tests` and labels itself as **"Lab sample at home (1,900+ tests)"**.
- **Quick-category chips** on `/lab-tests` (CBC · Thyroid · Vitamin D · Diabetes · Lipid Profile · LFT · Kidney · B12) that pre-fill the search.
- **Compliance band** at the bottom of `/lab-tests` — NABL-partner positioning, chain-of-custody language, DPDP 2023 alignment.

## Files in this zip (8 files)

| File | Status | What |
|---|---|---|
| `public/lab-tests.json` | **NEW** | 1,900 records, 871 KB. Parsed from your `Price List Diagnostics.pdf` (114 pages, 11 columns). Includes code, name, price, sample, TAT, method, instructions, shipping, clinical utility, normalised category (Routine / Specialty / Oncology / Genetics). |
| `src/types/lab-test.ts` | **NEW** | TypeScript type for a `LabTest` row |
| `src/hooks/useLabTestSearch.ts` | **NEW** | Lazy-loads `/lab-tests.json` on first non-empty query. Weighted in-memory search (exact-code=100, code-prefix=50, name-word-prefix=30, name-contains=10, utility-contains=3). Returns top N (default 8). |
| `src/components/lab/LabTestSearch.tsx` | **NEW** | The search input + dropdown + result-detail card. Two variants: `hero` (large, prominent) and `compact`. Hero is used on /lab-tests and the homepage section. |
| `src/components/lab/LabTestSearchSection.tsx` | **NEW** | Homepage wrapper section — coral eyebrow, "What test do you need?" headline, search + "See full catalog" link |
| `src/app/lab-tests/page.tsx` | **NEW** | The /lab-tests route — full hero search + quick-category chips + how-it-works + compliance band |
| `src/app/page.tsx` | UPDATED | Adds `<LabTestSearchSection />` between `<Hero />` and `<StatsBar />` |
| `src/constants/cms/shared.ts` | UPDATED | Footer "Lab sample at home" link now points to /lab-tests with the test-count badge |

## How to apply

```bash
# from your local Main-Website root
unzip ~/Downloads/Sanocare_Day2_CP5_Lab_Search.zip
# overwrite + add new files when prompted
npm run dev
# open http://localhost:3000 — search section now visible below hero
# open http://localhost:3000/lab-tests — dedicated page with full search hero
```

No new npm dependencies needed — the search is plain React + Tailwind 4 + `useMemo`/`useEffect`. No Fuse.js, no Algolia, no external services.

## How the search behaves

1. Page loads, search input is empty. **No catalog is loaded** — saves 871 KB of bandwidth for visitors who never interact.
2. User starts typing. On the first keystroke, the catalog is fetched once (`fetch('/lab-tests.json')`) and cached in component state. Next.js automatically serves `public/lab-tests.json` with caching headers; subsequent users hit a CDN cache.
3. Each keystroke runs a synchronous in-memory weighted match. **Sub-millisecond for 1,900 records** on any modern browser. Top 8 results show in the dropdown.
4. User clicks a result → detail card expands inline showing sample / TAT / method / instructions / utility.
5. User clicks **"Book this test at home →"** → booking modal opens with `serviceCategory = "diagnostics"` pre-set.

## Quick verification checklist

- [ ] `/` — search section appears between hero and StatsBar
- [ ] `/lab-tests` — page renders, hero search is prominent
- [ ] Type "vitamin d" — dropdown shows Vitamin D tests within a second
- [ ] Click a result — detail card expands with all fields populated
- [ ] Click "Book this test at home" — booking modal opens
- [ ] Footer "Services" column shows "Lab sample at home (1,900+ tests)" pointing to /lab-tests
- [ ] Open `/lab-tests` in incognito and view-source — the page should be SEO-indexable (titles, descriptions, structured content)

## What I noticed about your data

- **1,900 tests total** (you'd said ~1,000 — turned out to be almost double)
- **Categories** normalised from the PDF's "Category R/N/O/S/T/G" coding into 4 user-facing buckets: **Routine, Specialty, Oncology, Genetics**. The PDF had ~10 typo'd entries (e.g. "Catergory G", "Catergoty O", "0", "eCsa: tAeLgKor, yB ORA") that I mapped to sensible defaults; you may want to review and refine those in a future update.
- **Price range:** ₹2 minimum (a basic strip test) to ₹3,85,000 maximum (specialised genetics). Median is around ₹1,200.
- **All 1,900 have a price** — no nulls in the parsed data.

## What's NOT in this checkpoint

- **`/services` deep embed** — the search isn't yet embedded into the existing `/services` page (it's only on `/` and `/lab-tests`). Adds in CP6 with the `/now`+`/carehub` copy refresh.
- **Individual test pages** — each test could have its own `/lab-tests/[code]` route for SEO. Worth doing if Google starts ranking lab-test pages well; 1,900 routes is a lot of pages to generate, so we'd use ISR or build-time generation.
- **Booking integration of the selected test into Razorpay order** — currently the booking modal opens with `serviceCategory = "diagnostics"` set, but the selected test name/code/price isn't yet passed through to the Razorpay order. Plumbing for that is a 1-hour follow-on.
- **Lab packages** — bundled health-check packages (e.g. "Full Body Basic ₹1,499") aren't in this catalog. If the partner lab offers packages, send the package list and I'll add a Packages tab.

## Data refresh process

When the partner lab updates prices:

1. Replace `public/lab-tests.json` with the new parsed file
2. Rerun the parse script (the Python in CP5 build notes) on the updated PDF/XLSX
3. Trigger a Netlify rebuild

No code change required. Eventually we'll move the catalog into Supabase so you can edit prices via `/cms-admin`, but for v1 the static JSON is simpler and faster.
