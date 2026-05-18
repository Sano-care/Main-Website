# Day 2 Checkpoint 8 — Refund, webhook, sitemap, robots

Layers on top of CP1 + CP2 + Social patch + CP3 + CP4 + CP5 + CP6 + CP7.
Makes the Razorpay integration production-ready and ships SEO basics.

## What this gives you

1. **`/api/razorpay/refund`** — ops endpoint to refund either a booking-fee (₹249, before medic dispatch) or a report-fee (full lab test cost after capture). Handles both flows in one endpoint based on the booking's `service_category` + status. Updates the booking's refund columns + flips `payment_status` (or `report_payment_status`) to `REFUNDED` / `PARTIAL_REFUND`.

2. **`/api/razorpay/webhook`** — server-to-server webhook handler. Razorpay calls this asynchronously on every payment + refund event. Serves as a **safety net** alongside our synchronous client callbacks: if a patient closes the browser before `/api/razorpay/verify` returns, the webhook still flips `payment_status = CAPTURED` from Razorpay's side. Idempotent — repeat events won't double-flip state.

3. **`/sitemap.xml`** — dynamic Next.js 16 sitemap covering 14 public routes (homepage, services, lab-tests, now, carehub, sanopulse, about, research, contact, portal, plus 4 legal pages). Excludes ops, cms-admin, api, reports, coming-soon. Optional `SANOCARE_BLOG_SLUGS` env var for blog post enumeration.

4. **`/robots.txt`** — Next.js 16 robots generator. Allows search engines, disallows internal surfaces (ops, cms-admin, api, reports), slows down aggressive bots, **blocks AI training crawlers** (GPTBot, ClaudeBot, CCBot, PerplexityBot) from indexing clinical content — defensible position for healthcare. Points crawlers at the sitemap.

## Files in this zip (5)

| File | Status | What |
|---|---|---|
| `src/app/api/razorpay/refund/route.ts` | NEW | Ops-authed refund endpoint with branching logic for booking-fee vs report-fee flows |
| `src/app/api/razorpay/webhook/route.ts` | NEW | Razorpay webhook handler. HMAC-SHA256 signature verification, idempotent state updates, returns 200 even on internal errors to prevent retry storms |
| `src/app/sitemap.ts` | NEW | Dynamic sitemap with 14 routes + optional blog enumeration |
| `src/app/robots.ts` | NEW | robots.txt with sensible allow/disallow + AI-bot exclusions |
| `DAY2_CP8_README.md` | NEW | This file |

## How to deploy

```bash
# 1. Apply this zip + npm install (no new deps)
unzip ~/Downloads/Sanocare_Day2_CP8_Refund_Webhook_SEO.zip
npm run dev
```

### Test sitemap + robots

Open in browser:
- `http://localhost:3000/sitemap.xml` — should return XML with all 14 routes
- `http://localhost:3000/robots.txt` — should return plain-text with the sitemap reference at the bottom

After deploy: validate the production sitemap with Google Search Console (Add a property → submit `https://sanocare.in/sitemap.xml`). Should show "Success" and start indexing the new routes within a few days.

### Configure the Razorpay webhook

1. Razorpay Dashboard → Settings → **Webhooks** → **Add New Webhook**
2. **Webhook URL:** `https://sanocare.in/api/razorpay/webhook`
3. **Secret:** click *Generate* (or paste a long random string of your choosing). Copy this — you'll need it as an env var.
4. **Active Events** to subscribe to (tick each):
   - `payment.captured`
   - `payment.failed`
   - `refund.created`
   - `refund.processed`
   - `refund.failed`
5. **Alert Email:** your ops email
6. Save.

### One new env var to add in Netlify

`RAZORPAY_WEBHOOK_SECRET` = the secret you generated/pasted in step 3 above. The webhook endpoint returns 500 if this isn't set; Razorpay then treats it as a delivery failure and retries.

### Test refund

```bash
# Ops-only endpoint — use curl with the OPS_API_TOKEN header you set in CP6.
# Replace <UUID> with a real booking id (a PENDING booking with payment_status = CAPTURED).
curl -X POST https://sanocare.in/api/razorpay/refund \
  -H "Content-Type: application/json" \
  -H "x-ops-token: <YOUR OPS_API_TOKEN>" \
  -d '{"bookingId":"<UUID>", "reason":"Patient cancelled before dispatch"}'
# Response: { ok: true, refundId: "rfnd_xxx", refundedAmountPaise: 24900, kind: "booking_fee" }
```

Refund appears in Razorpay Dashboard → Refunds within a few minutes. The booking row in Supabase gets `refund_id`, `refunded_at`, `refund_amount_paise` populated, `payment_status = REFUNDED`, `status = CANCELLED`.

### Test webhook (test mode)

1. In the Razorpay Dashboard webhook config, click **Test Webhook** for a `payment.captured` event
2. Watch the Netlify Functions logs — you should see `[razorpay/webhook] received` with the event type
3. Razorpay shows the response status (should be 200)

## Refund policy logic (re-stated for clarity)

The refund endpoint enforces the rules promised on `/refund`:

| Service category | Status when refund requested | What happens |
|---|---|---|
| Home / Nursing / Teleconsult | `PENDING` or `CONFIRMED` (before dispatch) | Full ₹249 refund. Booking → `CANCELLED`. |
| Home / Nursing / Teleconsult | `DISPATCHED` or later | Refund **rejected** — beyond the cut-off |
| Lab | `PENDING_COLLECTION` / `COLLECTED` / `AT_LAB` (no payment yet) | Booking cancelled, no refund needed (test cost never charged) |
| Lab | `REPORT_DELIVERED` with `report_payment_status = CAPTURED` | Full or partial refund of the test cost. Booking stays `REPORT_DELIVERED` (patient may already have the report); only the financial state changes. |

Partial refunds: pass `partialAmountPaise` in the request body to refund less than the full amount. Useful when Pathcore rejects only one test in a multi-test basket.

## Webhook idempotency

The webhook handler uses `.neq("payment_status", "CAPTURED")` (and similar) on the update queries — if a webhook arrives twice (Razorpay retries failed deliveries up to 24 hours), the second update is a no-op. Same for refunds.

## SEO sanity check (post-deploy)

After deploying CP8:
- [ ] `view-source:https://sanocare.in/sitemap.xml` shows all 14 routes
- [ ] `https://sanocare.in/robots.txt` allows everything except internal surfaces
- [ ] Google Search Console picks up the sitemap (24-48 hours)
- [ ] Each legal page (`/privacy`, `/terms`, `/refund`, `/emergency`) is indexable
- [ ] `/lab-tests` ranks for "lab test home collection Delhi" over time (3-6 weeks)
- [ ] `/sanopulse` is indexable but **search engines don't rank it for medical advice queries** (it's a product page, not health content)

## What's left for Day 3 / CP9+

- `/now` and `/carehub` page-copy refresh (master-brand voice alignment)
- Gallery integration when the Drive link arrives
- WhatsApp/SMS notification for the magic-link send (MSG91 or WhatsApp Cloud API)
- Per-test booking detail page (`/lab-tests/[code]`) for long-tail SEO — only if traffic justifies
- OG card image refresh (currently `/og-image.png` is from the old "Doctor at Doorstep" era)
- Final accessibility + Lighthouse pass
- Production deploy + DNS cut-over from the old build
