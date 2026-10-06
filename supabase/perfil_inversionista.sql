-- Perfil de inversionista de cada usuario (horizonte, objetivo, tolerancia a caídas, fondo de emergencia...).
-- Cada usuario solo puede ver y modificar el suyo. Idempotente.

CREATE TABLE IF NOT EXISTS public.perfil_inversionista (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  datos jsonb NOT NULL,
  actualizado timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.perfil_inversionista ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS propio_select ON public.perfil_inversionista;
DROP POLICY IF EXISTS propio_insert ON public.perfil_inversionista;
DROP POLICY IF EXISTS propio_update ON public.perfil_inversionista;
DROP POLICY IF EXISTS propio_delete ON public.perfil_inversionista;

CREATE POLICY propio_select ON public.perfil_inversionista FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY propio_insert ON public.perfil_inversionista FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY propio_update ON public.perfil_inversionista FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY propio_delete ON public.perfil_inversionista FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.perfil_inversionista FROM anon;
