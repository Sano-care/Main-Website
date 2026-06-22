# CareHub Slice 5b — founder smoke-test runbook

Both outbound sweeps ship **OFF**. Nothing goes out until you (a) confirm Q2 for
the offer, (b) confirm the reminder template is APPROVED, and (c) flip the flags
after this smoke test. The endpoints are also gated by `CRON_SECRET`, so an
unauthenticated call does nothing.

## 0. Prereqs (one-time)
- Set `CRON_SECRET` (a long random string) in Netlify env.
- Confirm Meta status: `aarogya_carehub_offer` = APPROVED (MARKETING);
  `aarogya_carehub_monthly_visit_reminder` = APPROVED before enabling it.
- **Q2 (compliance):** confirm in-chat `register_carehub_interest` is an
  acceptable marketing opt-in under DPDP before enabling the offer.

## 1. Dry run — prove a flags-OFF call sends NOTHING
With both flags unset/OFF:
```bash
curl -s -X POST https://<site>/api/cron/carehub-offer \
  -H "x-cron-secret: $CRON_SECRET" | jq
# → { ok: true, sweep:"carehub-offer", ran:false, sent:0, ... }
```
Check `audit_log` for `carehub_skipped_flag_off` (sweep:"offer"). Repeat for
`/api/cron/carehub-reminder`. **No WhatsApp message should arrive.**

## 2. Offer — single-recipient live test (founder number)
1. Seed exactly ONE `carehub_leads` row for the founder number
   (`+91 9711977782`), `contacted_at`/`converted_subscription_id`/`offer_sent_at`
   all NULL.
2. Set `WHATSAPP_CAREHUB_OFFER_ENABLED=true` (and only the founder lead is
   pending — keep the test set to one).
3. `POST /api/cron/carehub-offer` with the secret.
4. Expect: one `aarogya_carehub_offer` WhatsApp to the founder; the lead row now
   has `offer_sent_at` + `offer_send_count=1` + `offer_last_wamid`; audit
   `carehub_offer_sent`.
5. Run it again → `sent:0` (already offered; the row is excluded). Confirms
   one-offer-per-lead.
6. Opt-out check: reply STOP, re-seed a fresh lead for the same number, run →
   `blocked:1`, audit `carehub_offer_blocked_optout`, **no message**.
7. Set `WHATSAPP_CAREHUB_OFFER_ENABLED` back to OFF until launch.

## 3. Reminder — single-recipient live test (after template APPROVED)
1. Ensure one active `carehub_subscriptions` row maps (via `customer_id` →
   `customers.phone`) to the founder number.
2. Set `WHATSAPP_CAREHUB_VISIT_REMINDER_ENABLED=true`.
3. `POST /api/cron/carehub-reminder` with the secret.
4. Expect: one `aarogya_carehub_monthly_visit_reminder`; a `carehub_reminder_log`
   row for `(subscription_id, <YYYYMM>, 'monthly_visit')` with `wamid`; audit
   `carehub_reminder_sent`.
5. Run again → `skippedAlreadySent:1`, **no second message** (the UNIQUE ledger).
6. Set the flag back to OFF until launch.

## 4. Go-live
- Pick the scheduler (decision pending): point it at the two endpoints with the
  `x-cron-secret` header. Offer = sweep of pending leads (cadence your call);
  reminder = early each month (it self-dedupes per IST month).
- Flip the flags ON only after 1–3 pass and Q2 + template approval are confirmed.

## Rollback
- Flip either flag OFF — sends stop immediately.
- Rotate `CRON_SECRET` to disable the endpoints entirely.
- DB: see the `Reversibility` headers in `064_carehub_leads_offer.sql` /
  `065_carehub_reminder_log.sql`.
