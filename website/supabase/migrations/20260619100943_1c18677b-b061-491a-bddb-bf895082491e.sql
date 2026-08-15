
ALTER TABLE public.sensor_readings
  ADD COLUMN IF NOT EXISTS current_amps numeric,
  ADD COLUMN IF NOT EXISTS system_state smallint;

ALTER TABLE public.thresholds
  ADD COLUMN IF NOT EXISTS rated_current numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS current_warning_pct numeric NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS current_critical_pct numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS temp_delta_warning numeric NOT NULL DEFAULT 15;
