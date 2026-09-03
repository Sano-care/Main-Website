-- Aarogya (WhatsApp) Medic-at-Home create-on-capture support.
--
-- A Razorpay payment link's `notes` can't carry the full cart, and the webhook
-- has no client body, so the cart the patient paid for is stored here at
-- link-creation time (server-priced, immutable) and reconstructed by the
-- `payment_link.paid` webhook to build the booking + booking_items. The LLM
-- supplies intent (which procedures) only; the amount/quote are server-computed
-- from home_care_procedures and frozen here — the link is a fixed amount, so
-- the stored quote IS the price-lock.
CREATE TABLE IF NOT EXISTS public.medic_cart_intents (
  cart_ref                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id          uuid,
  customer_id              uuid,
  phone                    text NOT NULL,
  items                    jsonb NOT NULL,        -- [{code, qty, units?, hours?}]
  payment_mode             text NOT NULL DEFAULT 'full' CHECK (payment_mode IN ('booking_fee','full')),
  charge_paise             int  NOT NULL,         -- what the link charges now (server-computed)
  quote_snapshot           jsonb NOT NULL,        -- the full CartQuote (line_items snapshot for booking_items)
  flow                     text NOT NULL DEFAULT 'aarogya_medic_cart',
  razorpay_payment_link_id text,
  razorpay_order_id        text,                  -- set on capture; booking idempotency key
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consumed')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  consumed_at              timestamptz
);
CREATE INDEX IF NOT EXISTS idx_medic_cart_intents_order
  ON public.medic_cart_intents (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_medic_cart_intents_link
  ON public.medic_cart_intents (razorpay_payment_link_id) WHERE razorpay_payment_link_id IS NOT NULL;
-- Deny-all RLS: service-role only (no policies), like booking_items.
ALTER TABLE public.medic_cart_intents ENABLE ROW LEVEL SECURITY;
