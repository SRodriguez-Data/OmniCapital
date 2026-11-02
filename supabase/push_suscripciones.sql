-- Notificaciones al celular (Web Push): una fila por cada navegador o celular donde el usuario activó los avisos de su
-- asesor (pestaña Asesor → "Activar avisos en este celular"). La escribe el propio usuario con su sesión (solo las
-- suyas); el agente diario (web/scripts/agente-cartera.ts) las lee con la clave secreta para enviar los avisos y borra
-- las que el navegador dio de baja. La suscripción no da acceso a nada: solo permite mandarle notificaciones a ese
-- navegador con la llave privada del agente. Idempotente.

CREATE TABLE IF NOT EXISTS public.push_suscripciones (
  endpoint text PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  dispositivo text,
  creado timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_suscripciones_user_id ON public.push_suscripciones (user_id);

ALTER TABLE public.push_suscripciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS propio_select ON public.push_suscripciones;
DROP POLICY IF EXISTS propio_insert ON public.push_suscripciones;
DROP POLICY IF EXISTS propio_update ON public.push_suscripciones;
DROP POLICY IF EXISTS propio_delete ON public.push_suscripciones;

CREATE POLICY propio_select ON public.push_suscripciones FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY propio_insert ON public.push_suscripciones FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY propio_update ON public.push_suscripciones FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY propio_delete ON public.push_suscripciones FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.push_suscripciones FROM anon;

-- Verificación: debe mostrar las 4 políticas, todas para {authenticated}
SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'push_suscripciones';
