-- Simulación del Top v2 de Chile (trading/main.py --mercado chile): una fila por día con el estado de la cartera
-- ficticia de la Bolsa de Santiago, sus órdenes, la curva frente al IPSA y el libro de la cuenta simulada (efectivo,
-- acciones y patrimonio de cada día), porque Alpaca no opera acciones chilenas. La escribe solo el job de GitHub
-- Actions con la clave secreta (salta RLS); la web la lee, también en modo demo, porque es dinero ficticio. Idempotente.

CREATE TABLE IF NOT EXISTS public.paper_trading_cl (
  fecha date PRIMARY KEY,
  datos jsonb NOT NULL,
  actualizado timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paper_trading_cl ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solo_lectura ON public.paper_trading_cl;
CREATE POLICY solo_lectura ON public.paper_trading_cl FOR SELECT TO anon, authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.paper_trading_cl FROM anon, authenticated;

-- Verificación: debe mostrar solo "solo_lectura" con cmd = SELECT
SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'paper_trading_cl';
