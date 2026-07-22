-- Aarogya reconciliation + escalation watchdog helpers, and the ops drop-rate
-- view. Column-to-column time comparisons (last_user_msg_at vs last_bot_msg_at
-- + an interval) can't be expressed through PostgREST, so the watchdogs call
-- these SECURITY DEFINER helpers. All service-role only.

-- Re-enqueue candidates: a user message unanswered > p_min_minutes, not opted
-- out, and with NO active queue row (the enqueue itself was lost). Returns the
-- latest inbound so the worker can replay it.
CREATE OR REPLACE FUNCTION public.aarogya_reconcile_candidates(
  p_min_minutes int DEFAULT 5, p_limit int DEFAULT 50
) RETURNS TABLE(
  conversation_id uuid, phone text, message_id uuid,
  content text, content_type text, raw_payload jsonb, provider_message_id text
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.whatsapp_phone, m.id, m.content, m.content_type, m.raw_payload, m.provider_message_id
  FROM public.conversations c
  JOIN LATERAL (
    SELECT id, content, content_type, raw_payload, provider_message_id
    FROM public.messages mm
    WHERE mm.conversation_id = c.id AND mm.direction = 'inbound'
    ORDER BY mm.created_at DESC LIMIT 1
  ) m ON true
  WHERE c.opt_out = false
    AND c.last_user_msg_at IS NOT NULL
    AND (c.last_bot_msg_at IS NULL OR c.last_user_msg_at > c.last_bot_msg_at)
    AND c.last_user_msg_at < now() - make_interval(mins => p_min_minutes)
    AND NOT EXISTS (
      SELECT 1 FROM public.aarogya_turn_queue q
      WHERE q.conversation_id = c.id AND q.status IN ('pending','processing')
    )
  ORDER BY c.last_user_msg_at ASC
  LIMIT p_limit;
$$;

-- Conversations that JUST crossed p_hours unanswered — fires once per crossing
-- (the reconcile cron's 5-min cadence catches the p_window_minutes band once),
-- so the 2h ops alert isn't re-sent every run.
CREATE OR REPLACE FUNCTION public.aarogya_stale_unanswered(
  p_hours int DEFAULT 2, p_window_minutes int DEFAULT 6, p_limit int DEFAULT 25
) RETURNS TABLE(conversation_id uuid, phone text, last_user_msg_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.whatsapp_phone, c.last_user_msg_at
  FROM public.conversations c
  WHERE c.opt_out = false
    AND c.last_user_msg_at IS NOT NULL
    AND (c.last_bot_msg_at IS NULL OR c.last_user_msg_at > c.last_bot_msg_at)
    AND c.last_user_msg_at <= now() - make_interval(hours => p_hours)
    AND c.last_user_msg_at >  now() - make_interval(hours => p_hours) - make_interval(mins => p_window_minutes)
  ORDER BY c.last_user_msg_at ASC
  LIMIT p_limit;
$$;

-- Escalations stuck 'requested' > p_hours (the conversation-level flag, so it's
-- deduped to one row per conversation). The daily escalation watchdog re-alerts
-- until the status flips to 'complete'.
CREATE OR REPLACE FUNCTION public.aarogya_stuck_escalations(
  p_hours int DEFAULT 24, p_limit int DEFAULT 25
) RETURNS TABLE(conversation_id uuid, phone text, updated_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.whatsapp_phone, c.updated_at
  FROM public.conversations c
  WHERE c.escalation_status = 'requested'
    AND c.updated_at < now() - make_interval(hours => p_hours)
  ORDER BY c.updated_at ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.aarogya_reconcile_candidates(int,int) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.aarogya_stale_unanswered(int,int,int) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.aarogya_stuck_escalations(int,int)     FROM anon, authenticated;

-- Ops drop-rate: inbound vs answered over the last 7 days + the live unanswered
-- backlog. security_invoker so it respects the querying role's RLS (ops reads
-- it with the service role, which bypasses RLS as intended).
CREATE OR REPLACE VIEW public.aarogya_drop_rate
WITH (security_invoker = true) AS
SELECT
  (SELECT count(*) FROM public.messages WHERE direction='inbound'  AND created_at > now() - interval '7 days') AS inbound_7d,
  (SELECT count(*) FROM public.messages WHERE direction='outbound' AND created_at > now() - interval '7 days') AS outbound_7d,
  (SELECT count(*) FROM public.conversations
     WHERE opt_out = false AND last_user_msg_at IS NOT NULL
       AND (last_bot_msg_at IS NULL OR last_user_msg_at > last_bot_msg_at)) AS currently_unanswered,
  (SELECT count(*) FROM public.conversations
     WHERE opt_out = false AND last_user_msg_at IS NOT NULL
       AND (last_bot_msg_at IS NULL OR last_user_msg_at > last_bot_msg_at)
       AND last_user_msg_at < now() - interval '5 min') AS unanswered_over_5min,
  (SELECT count(*) FROM public.messages
     WHERE direction='outbound' AND claude_model_used IS NOT NULL
       AND created_at > now() - interval '7 days') AS outbound_with_telemetry_7d;
