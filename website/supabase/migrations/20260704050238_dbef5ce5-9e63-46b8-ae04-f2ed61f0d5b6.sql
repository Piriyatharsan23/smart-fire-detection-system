
CREATE TABLE public.reset_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'OFF' CHECK (state IN ('ON','OFF')),
  last_reset_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reset_state_singleton CHECK (id = 1)
);

GRANT SELECT ON public.reset_state TO anon;
GRANT SELECT, INSERT, UPDATE ON public.reset_state TO authenticated;
GRANT ALL ON public.reset_state TO service_role;

ALTER TABLE public.reset_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read reset state"
  ON public.reset_state FOR SELECT
  USING (true);

CREATE POLICY "Authenticated can update reset state"
  ON public.reset_state FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can insert reset state"
  ON public.reset_state FOR INSERT
  TO authenticated
  WITH CHECK (true);

INSERT INTO public.reset_state (id, state) VALUES (1, 'OFF')
  ON CONFLICT (id) DO NOTHING;
