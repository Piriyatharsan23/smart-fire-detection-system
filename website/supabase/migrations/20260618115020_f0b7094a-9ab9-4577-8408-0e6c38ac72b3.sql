
ALTER TABLE public.sensor_readings
  ADD COLUMN IF NOT EXISTS smoke_voltage numeric,
  ADD COLUMN IF NOT EXISTS smoke_baseline numeric,
  ADD COLUMN IF NOT EXISTS smoke_percentage numeric,
  ADD COLUMN IF NOT EXISTS indoor_temp_voltage numeric,
  ADD COLUMN IF NOT EXISTS outdoor_temp_voltage numeric,
  ADD COLUMN IF NOT EXISTS flame_voltage numeric;

ALTER TABLE public.thresholds
  ADD COLUMN IF NOT EXISTS smoke_baseline_voltage numeric NOT NULL DEFAULT 4.8,
  ADD COLUMN IF NOT EXISTS smoke_tolerance numeric NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS smoke_max_drop numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS smoke_detection_threshold numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS temperature_scale_factor numeric NOT NULL DEFAULT 0.01,
  ADD COLUMN IF NOT EXISTS fan_auto_mode boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.alerts (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  alert_type text NOT NULL,
  alert_message text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  sensor_value numeric,
  status text NOT NULL DEFAULT 'active'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO anon, authenticated;
GRANT ALL ON public.alerts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.alerts_id_seq TO anon, authenticated, service_role;

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read alerts" ON public.alerts FOR SELECT USING (true);
CREATE POLICY "public insert alerts" ON public.alerts FOR INSERT WITH CHECK (true);
CREATE POLICY "public update alerts" ON public.alerts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public delete alerts" ON public.alerts FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
