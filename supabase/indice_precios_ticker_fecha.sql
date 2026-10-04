-- Índice compuesto para las consultas por ticker y rango de fechas sobre precios_historicos (~800 mil filas).
-- Antes solo había índices separados por ticker y por fecha: una consulta de 10 tickers recorría y descartaba
-- ~65 mil filas. Aplicado en producción el 2026-10-04. No es único: el minero inserta por fecha y un índice
-- único lo haría fallar ante cualquier duplicado.
CREATE INDEX IF NOT EXISTS idx_precios_ticker_date ON public.precios_historicos (ticker, date DESC) INCLUDE (close);
