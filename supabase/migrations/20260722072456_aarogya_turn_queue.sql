-- Aarogya message-drop P1 — decouple receive from process.
--
-- The WhatsApp webhook currently runs Claude composition + media download +
-- coalescing INLINE in one serverless invocation, then 200s and swallows
-- per-message errors. Any timeout = permanent silent drop (Meta got 200, never
-- retries). ~10.4% of inbound got no reply (live audit 2026-07-21).
--
-- This adds the durable turn queue + the atomic RPCs the worker uses, plus the
-- pg_cron drivers for the drain + the two watchdogs. All of it lands DARK:
-- the webhook only enqueues when AAROGYA_ASYNC_PROCESSING is set (default off),
-- so the inline path is unchanged until the flag flips.

-- ── Queue table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aarogya_turn_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id      uuid,                              -- the triggering inbound messages.id (traceability)
  phone           text NOT NULL,                     -- to rebuild the turn without re-reading the message
  -- 'text'  → one coalescing row per conversation (debounced; rapid msgs merge)
  -- 'media' → one row PER message (never coalesced — coalescing dropped a 2nd image)
  kind            text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','media')),
  payload         jsonb NOT NULL,                    -- the NormalizedInbound the worker replays
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  run_after       timestamptz NOT NULL DEFAULT now(),-- debounce gate; worker ignores until due
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 5,
  last_error      text,
  claimed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Drainer scan: due, still-pending rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_aarogya_turn_queue_due
  ON public.aarogya_turn_queue (run_after)
  WHERE status = 'pending';
-- Per-conversation serialization guard (is a turn already in flight for this conv?).
CREATE INDEX IF NOT EXISTS idx_aarogya_turn_queue_processing
  ON public.aarogya_turn_queue (conversation_id)
  WHERE status = 'processing';
-- Coalescing target: at most ONE active text turn per conversation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aarogya_turn_queue_active_text
  ON public.aarogya_turn_queue (conversation_id)
  WHERE kind = 'text' AND status IN ('pending','processing');

-- RLS deny-all (service-role only), matching the rest of the WhatsApp tables.
ALTER TABLE public.aarogya_turn_queue ENABLE ROW LEVEL SECURITY;

-- ── enqueue ────────────────────────────────────────────────────────────────
-- text  : upsert the single active row, pushing run_after out by the debounce
--         window so a rapid burst coalesces into one turn.
-- media : always a fresh row (each image/doc processed individually), due now.
CREATE OR REPLACE FUNCTION public.enqueue_aarogya_turn(
  p_conversation_id uuid,
  p_message_id      uuid,
  p_phone           text,
  p_kind            text,
  p_payload         jsonb,
  p_debounce_ms     int DEFAULT 6000
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id      uuid;
  v_delay   interval := make_interval(secs => GREATEST(p_debounce_ms, 0) / 1000.0);
BEGIN
  IF p_kind = 'media' THEN
    INSERT INTO public.aarogya_turn_queue (conversation_id, message_id, phone, kind, payload, run_after)
    VALUES (p_conversation_id, p_message_id, p_phone, 'media', p_payload, now())
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  -- text: coalesce onto the active row if one exists, else insert.
  UPDATE public.aarogya_turn_queue
     SET run_after = now() + v_delay,
         payload    = p_payload,
         message_id = p_message_id,
         updated_at = now()
   WHERE conversation_id = p_conversation_id
     AND kind = 'text'
     AND status IN ('pending','processing')
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.aarogya_turn_queue (conversation_id, message_id, phone, kind, payload, run_after)
    VALUES (p_conversation_id, p_message_id, p_phone, 'text', p_payload, now() + v_delay)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- ── claim ──────────────────────────────────────────────────────────────────
-- Atomically claim ONE due turn whose conversation has no turn already in
-- flight (per-conversation serialization). SKIP LOCKED lets multiple drainers
-- run without grabbing the same row.
CREATE OR REPLACE FUNCTION public.claim_next_aarogya_turn()
RETURNS public.aarogya_turn_queue
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.aarogya_turn_queue;
BEGIN
  WITH due AS (
    SELECT q.id
      FROM public.aarogya_turn_queue q
     WHERE q.status = 'pending'
       AND q.run_after <= now()
       AND NOT EXISTS (
         SELECT 1 FROM public.aarogya_turn_queue p
          WHERE p.conversation_id = q.conversation_id
            AND p.status = 'processing'
       )
     ORDER BY q.run_after ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.aarogya_turn_queue t
     SET status = 'processing', claimed_at = now(),
         attempts = t.attempts + 1, updated_at = now()
    FROM due
   WHERE t.id = due.id
  RETURNING t.* INTO v_row;

  RETURN v_row;  -- NULL row when nothing claimable
END;
$$;

-- ── complete ───────────────────────────────────────────────────────────────
-- Mark the claimed row done. For a text turn also collapse any sibling pending
-- text rows (they were coalesced into this turn) so the burst is one reply.
CREATE OR REPLACE FUNCTION public.complete_aarogya_turn(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv uuid;
  v_kind text;
BEGIN
  UPDATE public.aarogya_turn_queue
     SET status = 'done', updated_at = now()
   WHERE id = p_id
  RETURNING conversation_id, kind INTO v_conv, v_kind;

  IF v_kind = 'text' AND v_conv IS NOT NULL THEN
    UPDATE public.aarogya_turn_queue
       SET status = 'done', last_error = 'coalesced', updated_at = now()
     WHERE conversation_id = v_conv AND kind = 'text'
       AND status = 'pending' AND id <> p_id;
  END IF;
END;
$$;

-- ── fail / retry ───────────────────────────────────────────────────────────
-- Return the row to 'pending' for the drain to retry; mark 'failed' once it has
-- exhausted its attempts (the reconciliation watchdog is the last backstop).
CREATE OR REPLACE FUNCTION public.fail_aarogya_turn(p_id uuid, p_error text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new text;
BEGIN
  UPDATE public.aarogya_turn_queue
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         last_error = left(coalesce(p_error,'error'), 500),
         run_after = now() + interval '30 seconds',   -- small backoff before retry
         updated_at = now()
   WHERE id = p_id
  RETURNING status INTO v_new;
  RETURN v_new;
END;
$$;

-- ── re-claim stuck 'processing' rows ───────────────────────────────────────
-- A worker that died mid-turn leaves a row stuck 'processing'. The reconcile
-- cron calls this to hand them back to the drain.
CREATE OR REPLACE FUNCTION public.requeue_stuck_aarogya_turns(p_older_than_seconds int DEFAULT 180)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.aarogya_turn_queue
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         last_error = 'requeued: stuck in processing',
         run_after = now(), updated_at = now()
   WHERE status = 'processing'
     AND claimed_at < now() - make_interval(secs => p_older_than_seconds);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_aarogya_turn(uuid,uuid,text,text,jsonb,int)      FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_next_aarogya_turn()                                 FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_aarogya_turn(uuid)                               FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_aarogya_turn(uuid,text)                              FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_stuck_aarogya_turns(int)                          FROM anon, authenticated;

-- ── pg_cron drivers (INERT until Vault has project_url + cron_secret) ───────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN PERFORM cron.unschedule('aarogya-turn-drain');          EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('aarogya-reconcile');           EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('aarogya-escalation-watchdog'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Helper inline block is repeated per job (vault read → POST secret-gated route).
SELECT cron.schedule('aarogya-turn-drain', '* * * * *', $cron$
  DO $body$ DECLARE v_url text; v_secret text; BEGIN
    SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name='project_url' LIMIT 1;
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='cron_secret' LIMIT 1;
    IF v_url IS NULL OR v_secret IS NULL THEN RAISE NOTICE 'aarogya-turn-drain: vault not set — skip'; RETURN; END IF;
    PERFORM net.http_post(url := v_url || '/api/cron/aarogya-turn-drain',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  END $body$;
$cron$);

SELECT cron.schedule('aarogya-reconcile', '*/5 * * * *', $cron$
  DO $body$ DECLARE v_url text; v_secret text; BEGIN
    SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name='project_url' LIMIT 1;
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='cron_secret' LIMIT 1;
    IF v_url IS NULL OR v_secret IS NULL THEN RAISE NOTICE 'aarogya-reconcile: vault not set — skip'; RETURN; END IF;
    PERFORM net.http_post(url := v_url || '/api/cron/aarogya-reconcile',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  END $body$;
$cron$);

SELECT cron.schedule('aarogya-escalation-watchdog', '30 4 * * *', $cron$
  DO $body$ DECLARE v_url text; v_secret text; BEGIN
    SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name='project_url' LIMIT 1;
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='cron_secret' LIMIT 1;
    IF v_url IS NULL OR v_secret IS NULL THEN RAISE NOTICE 'aarogya-escalation-watchdog: vault not set — skip'; RETURN; END IF;
    PERFORM net.http_post(url := v_url || '/api/cron/aarogya-escalation-watchdog',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  END $body$;
$cron$);
