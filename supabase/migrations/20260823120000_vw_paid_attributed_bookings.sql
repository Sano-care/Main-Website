-- Paid-attribution reporting view — "what did Google Ads actually produce".
--
-- Exposes every booking that carries a Google Ads click id (gclid), joined to
-- the WhatsApp conversation it was attributed from. The gclid lands on the
-- booking via the attribution pipeline (conversation.gclid, copied by phone at
-- booking creation); this view re-derives the SOURCE conversation for auditing
-- and to later drive the offline-conversion upload to Google Ads.
--
-- Join key is the phone number, normalised to its last 10 digits so
-- +91 / 91 / bare-10-digit formats all match (conversations.whatsapp_phone ↔
-- bookings.phone). The most-recent conversation carrying the SAME gclid wins.
--
-- security_invoker = on: the view runs with the querying role's RLS (matches
-- the repo's view posture), so it never becomes a privilege-escalation surface.
-- Read by service-role analytics / ops.

CREATE OR REPLACE VIEW public.vw_paid_attributed_bookings
WITH (security_invoker = on) AS
SELECT
  b.id,
  b.booking_code,
  b.created_at,
  b.service_category,
  b.phone,
  b.final_amount_paise,
  b.payment_status,
  b.gclid,
  b.wbraid,
  c.id AS source_conversation_id
FROM public.bookings b
LEFT JOIN LATERAL (
  SELECT conv.id
  FROM public.conversations conv
  WHERE conv.gclid IS NOT NULL
    AND conv.gclid = b.gclid
    AND right(regexp_replace(conv.whatsapp_phone, '\D', '', 'g'), 10)
        = right(regexp_replace(b.phone, '\D', '', 'g'), 10)
  ORDER BY conv.created_at DESC
  LIMIT 1
) c ON true
WHERE b.gclid IS NOT NULL;

COMMENT ON VIEW public.vw_paid_attributed_bookings IS
  'Bookings carrying a Google Ads gclid + their source WhatsApp conversation (by phone). Drives paid-attribution reporting and the offline-conversion upload.';
