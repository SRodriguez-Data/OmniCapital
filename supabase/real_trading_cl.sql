-- Cuenta real de Chile operada a mano con el Top v2 (trading/main.py --mercado chile --real): una fila por día con el
-- estado de la cartera, las órdenes avisadas por Telegram y confirmadas por su dueño, la curva frente al IPSA y el
-- libro de la cuenta (efectivo, acciones, órdenes pendientes y aportes). La escribe solo el job de GitHub Actions con
-- la clave secreta (salta RLS). Como real_trading, NO es pública: cada fila la ve solo su dueño (user_id, que el job
-- toma del secret TRADING_REAL_USUARIO). Idempotente.

CREATE TABLE IF NOT EXISTS public.real_trading_cl (
  fecha date PRIMARY KEY,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  datos jsonb NOT NULL,
  actualizado timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.real_trading_cl ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solo_su_dueno ON public.real_trading_cl;
CREATE POLICY solo_su_dueno ON public.real_trading_cl FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.real_trading_cl FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.real_trading_cl FROM authenticated;

-- Verificación: debe mostrar solo "solo_su_dueno" con cmd = SELECT y roles = {authenticated}
SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'real_trading_cl';
