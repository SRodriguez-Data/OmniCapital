// Validación de los portafolios que llegan a las rutas de la API.
// Las rutas públicas (IA, precios) no deben aceptar payloads arbitrarios ni gigantes.

export const MAX_ITEMS = 60;
export const TICKER_RE = /^[A-Z0-9.^=\-]{1,20}$/;

export interface PortfolioInput {
  ticker: string;
  cantidad: number;
  precio_compra: number;
  moneda: 'USD' | 'CLP';
  precio_actual?: number;
}

export function parsePortfolioItems(raw: unknown): { items: PortfolioInput[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'El portafolio está vacío.' };
  if (raw.length > MAX_ITEMS) return { error: `Máximo ${MAX_ITEMS} activos por consulta.` };

  const items: PortfolioInput[] = [];
  for (const r of raw) {
    const ticker = typeof r?.ticker === 'string' ? r.ticker.trim().toUpperCase() : '';
    const cantidad = Number(r?.cantidad);
    const precio_compra = Number(r?.precio_compra);
    const precio_actual = r?.precio_actual === undefined || r?.precio_actual === null ? undefined : Number(r.precio_actual);

    if (!TICKER_RE.test(ticker)) return { error: `Ticker inválido: ${String(r?.ticker).slice(0, 20)}` };
    if (!Number.isFinite(cantidad) || cantidad <= 0) return { error: `Cantidad inválida para ${ticker}` };
    if (!Number.isFinite(precio_compra) || precio_compra < 0) return { error: `Precio de compra inválido para ${ticker}` };

    items.push({
      ticker,
      cantidad,
      precio_compra,
      moneda: r?.moneda === 'CLP' ? 'CLP' : 'USD',
      precio_actual: precio_actual !== undefined && Number.isFinite(precio_actual) && precio_actual > 0 ? precio_actual : undefined,
    });
  }
  return { items };
}
