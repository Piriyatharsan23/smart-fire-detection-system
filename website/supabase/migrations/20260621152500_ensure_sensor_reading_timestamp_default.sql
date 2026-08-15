ALTER TABLE public.sensor_readings
  ALTER COLUMN ts SET DEFAULT now(),
  ALTER COLUMN ts SET NOT NULL;
