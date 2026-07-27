-- WhatsApp → Google Ads offline-conversion pipeline.
--
-- `whatsapp_click_paid` is an offline-conversion-import (UPLOAD_CLICKS) action
-- that has never received an upload, so the bidder is blind to the ~70% of
-- bookings that close over WhatsApp. This migration adds the storage that lets a
-- Google Ads click id survive the WhatsApp handoff:
--
--   ad click (?gclid=)  →  wa_click_tokens (SC-XXXXXX)
--                       →  [ref: SC-XXXXXX] in the WhatsApp prefill
--                       →  conversations.gclid  (stamped by Aarogya inbound)
--                       →  bookings.gclid       (stamped at Razorpay verify)
--                       →  offline conversion upload
--
-- Applied to prod via the Supabase MCP (version 20260723100934); this file's
-- prefix matches the recorded version so the CLI treats it as already-applied.

-- Token → click-id map for the WhatsApp offline-conversion pipeline.
create table if not exists public.wa_click_tokens (
  token       text primary key,
  gclid       text,
  wbraid      text,
  created_at  timestamptz not null default now()
);

comment on table public.wa_click_tokens is
  'Short SC-XXXXXX handles minted at a paid click and carried inside the WhatsApp prefill as [ref: SC-XXXXXX]. Resolved by the Aarogya inbound handler to stamp conversations.gclid. Service-role only.';

-- Cleanup helper: tokens older than ~90 days are past the Ads attribution window.
create index if not exists wa_click_tokens_created_at_idx
  on public.wa_click_tokens (created_at);

-- Deny-all RLS (A1 posture) — only the service role touches this table.
alter table public.wa_click_tokens enable row level security;

-- Click ids on the WhatsApp lead thread (stamped at inbound) …
alter table public.conversations
  add column if not exists gclid  text,
  add column if not exists wbraid text;

-- … and on the booking itself (stamped at payment verify, used for the upload).
alter table public.bookings
  add column if not exists gclid  text,
  add column if not exists wbraid text;

comment on column public.conversations.gclid is
  'Google Ads click id resolved from the [ref: SC-XXXXXX] token in the first inbound WhatsApp message. First click wins.';
comment on column public.bookings.gclid is
  'Google Ads click id copied from the WhatsApp conversation at payment verify; drives the whatsapp_click_paid offline conversion upload.';
