-- Agente de cartera (web/scripts/agente-cartera.ts): una fila por usuario con lo último que revisó y avisó por Telegram
-- (el plan de rebalanceo, los niveles de precio vigilados y la fecha del último aviso), para avisar solo cuando algo
-- cambia. La escribe solo el job de GitHub Actions con la clave secreta (salta RLS). Tiene la cartera real, así que NO
-- es pública: cada fila la ve solo su dueño. Idempotente.

CREATE TABLE IF NOT EXISTS public.agente_cartera (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  datos jsonb NOT NULL,
  actualizado timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agente_cartera ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solo_su_dueno ON public.agente_cartera;
CREATE POLICY solo_su_dueno ON public.agente_cartera FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.agente_cartera FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.agente_cartera FROM authenticated;

-- Verificación: debe mostrar solo "solo_su_dueno" con cmd = SELECT y roles = {authenticated}
SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'agente_cartera';
