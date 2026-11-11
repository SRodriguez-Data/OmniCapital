-- Cartera guardada de cada usuario (mi_portafolio): cada uno ve y cambia solo sus filas.
-- El registro en la app está abierto, así que esto es lo único que separa tu cartera de la de otra cuenta.
-- Reemplaza las políticas que haya por las cuatro de abajo. Idempotente: se puede ejecutar más de una vez.
-- El agente y el bot usan la clave secreta, que salta estas reglas: siguen funcionando igual.

ALTER TABLE public.mi_portafolio ENABLE ROW LEVEL SECURITY;
-- La app guarda sin indicar el dueño: la fila queda a nombre de quien tiene la sesión
ALTER TABLE public.mi_portafolio ALTER COLUMN user_id SET DEFAULT auth.uid();

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'mi_portafolio' LOOP
    EXECUTE format('DROP POLICY %I ON public.mi_portafolio', p.policyname);
  END LOOP;
END $$;

CREATE POLICY propio_select ON public.mi_portafolio FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY propio_insert ON public.mi_portafolio FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY propio_update ON public.mi_portafolio FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY propio_delete ON public.mi_portafolio FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- Un visitante sin sesión no escribe (leer ya no puede: ninguna política lo incluye)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.mi_portafolio FROM anon;

-- Verificación: deben quedar solo las cuatro "propio_*", todas para authenticated y con user_id = auth.uid()
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'mi_portafolio';
