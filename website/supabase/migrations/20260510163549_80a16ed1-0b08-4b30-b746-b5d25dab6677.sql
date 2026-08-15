
CREATE TABLE public.alert_settings (
  id integer PRIMARY KEY DEFAULT 1,
  whatsapp_to text,
  whatsapp_from text,
  enabled boolean NOT NULL DEFAULT true,
  cooldown_seconds integer NOT NULL DEFAULT 120,
  last_alert_at timestamptz,
  last_alert_status text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_settings_singleton CHECK (id = 1)
);

INSERT INTO public.alert_settings (id) VALUES (1);

ALTER TABLE public.alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read alert_settings" ON public.alert_settings FOR SELECT USING (true);
CREATE POLICY "public update alert_settings" ON public.alert_settings FOR UPDATE USING (true) WITH CHECK (true);
