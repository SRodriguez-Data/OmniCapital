-- Deja alertas_mercado, analisis_ia y precios_historicos en SOLO LECTURA para la app web.
-- Las escribe únicamente el bot (GitHub Actions) con la clave secreta (sb_secret_ / service role),
-- que salta RLS, así que el bot sigue funcionando igual.
-- Idempotente: se puede ejecutar más de una vez.

DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['alertas_mercado', 'analisis_ia', 'precios_historicos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Borra las políticas existentes (alguna podría permitir escribir)
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    -- Lectura para visitantes (modo demo) y usuarios con sesión
    EXECUTE format('CREATE POLICY solo_lectura ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);

    -- Defensa extra: sin permisos de escritura a nivel de tabla
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- Verificación: debe mostrar solo "solo_lectura" con cmd = SELECT en las 3 tablas
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('alertas_mercado', 'analisis_ia', 'precios_historicos');
