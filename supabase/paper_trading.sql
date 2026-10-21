-- Simulación del Top v2 en Alpaca paper trading (trading/main.py): una fila por día con el estado de la cartera
-- ficticia, sus órdenes y la curva frente al S&P 500. La escribe solo el job de GitHub Actions con la clave secreta
-- (salta RLS); la web la lee, también en modo demo, porque es dinero ficticio. Idempotente.

CREATE TABLE IF NOT EXISTS public.paper_trading (
  fecha date PRIMARY KEY,
  datos jsonb NOT NULL,
  actualizado timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paper_trading ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solo_lectura ON public.paper_trading;
CREATE POLICY solo_lectura ON public.paper_trading FOR SELECT TO anon, authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.paper_trading FROM anon, authenticated;

-- Verificación: debe mostrar solo "solo_lectura" con cmd = SELECT
SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'paper_trading';
