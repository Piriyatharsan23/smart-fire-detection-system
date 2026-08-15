
-- Sensor readings
CREATE TABLE public.sensor_readings (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  temp NUMERIC NOT NULL,
  smoke INTEGER NOT NULL,
  flame SMALLINT NOT NULL CHECK (flame IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('normal','warning','danger'))
);
CREATE INDEX sensor_readings_ts_idx ON public.sensor_readings (ts DESC);

-- Device state (single row id = 1)
CREATE TABLE public.device_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  buzzer BOOLEAN NOT NULL DEFAULT false,
  fan BOOLEAN NOT NULL DEFAULT false,
  suppression BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.device_state (id) VALUES (1);

-- Thresholds (single row id = 1)
CREATE TABLE public.thresholds (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  temp INTEGER NOT NULL DEFAULT 50,
  smoke INTEGER NOT NULL DEFAULT 400,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.thresholds (id) VALUES (1);

-- Connection log
CREATE TABLE public.connection_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','rx','tx','error')),
  message TEXT NOT NULL
);
CREATE INDEX connection_log_ts_idx ON public.connection_log (ts DESC);

-- RLS
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_log ENABLE ROW LEVEL SECURITY;

-- Public demo: allow all operations (anon + authenticated)
CREATE POLICY "public read sensor_readings" ON public.sensor_readings FOR SELECT USING (true);
CREATE POLICY "public insert sensor_readings" ON public.sensor_readings FOR INSERT WITH CHECK (true);
CREATE POLICY "public delete sensor_readings" ON public.sensor_readings FOR DELETE USING (true);

CREATE POLICY "public read device_state" ON public.device_state FOR SELECT USING (true);
CREATE POLICY "public update device_state" ON public.device_state FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "public read thresholds" ON public.thresholds FOR SELECT USING (true);
CREATE POLICY "public update thresholds" ON public.thresholds FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "public read connection_log" ON public.connection_log FOR SELECT USING (true);
CREATE POLICY "public insert connection_log" ON public.connection_log FOR INSERT WITH CHECK (true);
CREATE POLICY "public delete connection_log" ON public.connection_log FOR DELETE USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_readings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_state;
ALTER PUBLICATION supabase_realtime ADD TABLE public.thresholds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.connection_log;
