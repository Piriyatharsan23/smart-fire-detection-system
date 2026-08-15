ALTER TABLE public.sensor_readings
  ADD COLUMN IF NOT EXISTS fan_voltage numeric;
