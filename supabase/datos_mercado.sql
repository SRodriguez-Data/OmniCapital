-- Dividendos y fundamentales que guarda el minero diario (GitHub Actions), para que la web los lea de la
-- base en vez de descargarlos de Yahoo cada vez que parte una instancia nueva.
-- Las escribe únicamente el minero con la clave secreta (salta RLS); la web solo lee.
-- Idempotente: se puede ejecutar más de una vez.

CREATE TABLE IF NOT EXISTS public.dividendos (
  ticker text NOT NULL,
  fecha date NOT NULL,              -- fecha ex-dividendo
  monto double precision NOT NULL,  -- por acción, en la moneda del activo
  PRIMARY KEY (ticker, fecha)
);

-- Una tabla de dividendos vacía no significa "no paga dividendos": puede ser que aún no se haya revisado.
-- Aquí el minero anota cuándo revisó los dividendos de cada ticker.
CREATE TABLE IF NOT EXISTS public.series_meta (
  ticker text PRIMARY KEY,
  dividendos_revisados timestamptz
);

CREATE TABLE IF NOT EXISTS public.fundamentales (
  ticker text PRIMARY KEY,
  actualizado timestamptz NOT NULL DEFAULT now(),
  datos jsonb NOT NULL              -- valoración, rentabilidad, analistas, composición de ETFs (fracciones, no %)
);

DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['dividendos', 'series_meta', 'fundamentales'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('CREATE POLICY solo_lectura ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
