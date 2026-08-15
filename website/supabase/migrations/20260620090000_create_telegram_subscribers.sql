CREATE TABLE IF NOT EXISTS public.telegram_subscribers (
  id BIGSERIAL PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE,
  username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notifications_enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS telegram_subscribers_enabled_idx
  ON public.telegram_subscribers (notifications_enabled)
  WHERE notifications_enabled = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_subscribers TO anon, authenticated;
GRANT ALL ON public.telegram_subscribers TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.telegram_subscribers_id_seq TO anon, authenticated, service_role;

ALTER TABLE public.telegram_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read telegram_subscribers"
  ON public.telegram_subscribers FOR SELECT USING (true);

CREATE POLICY "public insert telegram_subscribers"
  ON public.telegram_subscribers FOR INSERT WITH CHECK (true);

CREATE POLICY "public update telegram_subscribers"
  ON public.telegram_subscribers FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "public delete telegram_subscribers"
  ON public.telegram_subscribers FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.telegram_subscribers;
