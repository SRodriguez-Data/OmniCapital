import { yahooFinance, withTimeout, yahooRequest } from './marketData';
import { supabase } from './supabase';

// Datos fundamentales de Yahoo Finance (gratis): valoración, calidad, crecimiento, dividendos y consenso de
// analistas para acciones; costo, sectores y principales posiciones para ETFs. Yahoo mezcla monedas en algunas
// acciones chilenas (estados financieros en dólares y precio en pesos) y entrega ratios absurdos, por ejemplo
// un P/VL de 500: todo valor fuera de un rango razonable se descarta en vez de mostrarse.

export type TipoActivo = 'accion' | 'etf' | 'fondo';

export interface Fundamentales {
  ticker: string;
  tipo: TipoActivo;
  nombre?: string;
  sector?: string;       // en español
  industria?: string;
  pais?: string;         // país de la empresa según Yahoo (en inglés)
  per?: number;          // precio / utilidad de los últimos 12 meses
  perForward?: number;   // precio / utilidad esperada
  pvl?: number;          // precio / valor libro
  evEbitda?: number;
  dividendYield?: number;
  payout?: number;       // dividendos / utilidad
  roe?: number;
  margen?: number;       // margen neto
  deudaPatrimonio?: number; // veces
  crecimientoVentas?: number;
  crecimientoUtilidad?: number;
  analistas?: { n: number; recomendacion: string; objetivo: number; potencial: number };
  gastoAnual?: number;   // costo anual del ETF (expense ratio)
  categoria?: string;
  sectores?: Record<string, number>; // composición sectorial del ETF
  principales?: { ticker: string; nombre?: string; peso: number }[];
  marketCap?: number;
}

// Sectores de Yahoo (claves de ETFs y nombres de empresas) en español
const SECTORES: Record<string, string> = {
  realestate: 'Inmobiliario', 'Real Estate': 'Inmobiliario',
  consumer_cyclical: 'Consumo discrecional', 'Consumer Cyclical': 'Consumo discrecional',
  basic_materials: 'Materiales', 'Basic Materials': 'Materiales',
  consumer_defensive: 'Consumo básico', 'Consumer Defensive': 'Consumo básico',
  technology: 'Tecnología', Technology: 'Tecnología',
  communication_services: 'Comunicaciones', 'Communication Services': 'Comunicaciones',
  financial_services: 'Financiero', 'Financial Services': 'Financiero',
  utilities: 'Servicios básicos', Utilities: 'Servicios básicos',
  industrials: 'Industrial', Industrials: 'Industrial',
  energy: 'Energía', Energy: 'Energía',
  healthcare: 'Salud', Healthcare: 'Salud',
};
export const sectorEnEspanol = (s?: string) => (s ? SECTORES[s] ?? s : undefined);

// ETFs y fondos que Yahoo a veces no marca como tales (o cuando su cotización falla)
export const ETF_CONOCIDOS = new Set([
  'VOO', 'VT', 'VTI', 'SPY', 'IVV', 'QQQ', 'QQQM', 'SCHD', 'HDV', 'VYM', 'DGRO', 'FTEC', 'VGT', 'XLK', 'VNQ', 'BOTZ',
  'ACWI', 'VXUS', 'VEA', 'VWO', 'IEMG', 'EEM', 'EFA', 'IEFA', 'AGG', 'BND', 'TLT', 'IEF', 'SHY', 'BIL', 'SGOV', 'TIP',
  'GLD', 'IAU', 'SLV', 'ECH', 'ARKK', 'SMH', 'SOXX', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLU', 'XLI', 'XLB', 'IWM', 'DIA', 'VUG', 'VTV',
]);
// Fondos chilenos (Yahoo los marca como EQUITY): índice amplio o fondo de inversión
export const FONDOS_CHILE: Record<string, { tipo: TipoActivo; sector?: string; indice?: boolean }> = {
  'CFMITNIPSA.SN': { tipo: 'etf', indice: true },
  'CFIETFIPSA1.SN': { tipo: 'etf', indice: true },
  'CFINRENTAS.SN': { tipo: 'fondo', sector: 'Inmobiliario' },
};

const enRango = (x: unknown, min: number, max: number): number | undefined =>
  typeof x === 'number' && Number.isFinite(x) && x > min && x < max ? x : undefined;

const RECOMENDACION: Record<string, string> = {
  strong_buy: 'compra fuerte', buy: 'compra', hold: 'mantener', underperform: 'bajo el mercado', sell: 'venta', strong_sell: 'venta fuerte',
};

const MODULOS = ['summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile', 'fundProfile', 'topHoldings', 'price'] as const;

// Lo que se usa del quoteSummary de Yahoo. El minero diario guarda ese mismo objeto en la tabla fundamentales
interface Resumen {
  price?: { quoteType?: string; longName?: string | null; shortName?: string | null; regularMarketPrice?: number };
  summaryDetail?: { trailingPE?: number; forwardPE?: number; dividendYield?: number; yield?: number; marketCap?: number; payoutRatio?: number };
  defaultKeyStatistics?: { forwardPE?: number; priceToBook?: number; enterpriseToEbitda?: number; annualReportExpenseRatio?: number };
  financialData?: {
    currentPrice?: number; returnOnEquity?: number; profitMargins?: number; debtToEquity?: number; revenueGrowth?: number;
    earningsGrowth?: number; numberOfAnalystOpinions?: number; targetMeanPrice?: number; recommendationKey?: string;
  };
  assetProfile?: { sector?: string; industry?: string; country?: string };
  fundProfile?: { categoryName?: string | null; feesExpensesInvestment?: { annualReportExpenseRatio?: number } };
  topHoldings?: { sectorWeightings?: object[]; holdings?: { symbol: string; holdingName?: string; holdingPercent: number }[] };
}

async function cargar(ticker: string): Promise<Fundamentales | null> {
  const s = await withTimeout(
    yahooFinance.quoteSummary(ticker, { modules: [...MODULOS] }, yahooRequest()),
    10000, `Yahoo fundamentales ${ticker}`,
  );
  return desdeResumen(ticker, s as Resumen);
}

function desdeResumen(ticker: string, s: Resumen): Fundamentales {
  const sd = s.summaryDetail, ks = s.defaultKeyStatistics, fd = s.financialData, ap = s.assetProfile, fp = s.fundProfile, th = s.topHoldings;
  const quoteType = s.price?.quoteType;
  const chile = FONDOS_CHILE[ticker];
  const tipo: TipoActivo = chile?.tipo ?? (quoteType === 'ETF' || quoteType === 'MUTUALFUND' || ETF_CONOCIDOS.has(ticker) ? 'etf' : 'accion');
  const precio = s.price?.regularMarketPrice ?? fd?.currentPrice;

  const f: Fundamentales = {
    ticker, tipo,
    nombre: s.price?.longName ?? s.price?.shortName ?? undefined,
    sector: chile?.sector ?? sectorEnEspanol(ap?.sector || undefined),
    industria: ap?.industry || undefined,
    pais: ap?.country || undefined,
    per: enRango(sd?.trailingPE, 0, 150),
    perForward: enRango(sd?.forwardPE ?? ks?.forwardPE, 0, 150),
    dividendYield: enRango(sd?.dividendYield ?? sd?.yield, -0.0001, 0.25),
    marketCap: enRango(sd?.marketCap, 0, 1e16),
  };
  if (tipo === 'accion') {
    f.pvl = enRango(ks?.priceToBook, 0, 40);
    f.evEbitda = enRango(ks?.enterpriseToEbitda, 0, 60);
    f.payout = enRango(sd?.payoutRatio, -0.0001, 3);
    f.roe = enRango(fd?.returnOnEquity, -1, 1.5);
    f.margen = enRango(fd?.profitMargins, -1, 1);
    const dte = enRango(fd?.debtToEquity, -0.0001, 1000); // Yahoo lo informa en %
    f.deudaPatrimonio = dte !== undefined ? dte / 100 : undefined;
    f.crecimientoVentas = enRango(fd?.revenueGrowth, -0.9, 5);
    f.crecimientoUtilidad = enRango(fd?.earningsGrowth, -0.95, 10);
    const n = fd?.numberOfAnalystOpinions ?? 0;
    const objetivo = fd?.targetMeanPrice;
    if (n >= 3 && objetivo && precio && precio > 0) {
      const potencial = objetivo / precio - 1;
      if (potencial > -0.8 && potencial < 2) {
        f.analistas = { n, recomendacion: RECOMENDACION[fd?.recommendationKey ?? ''] ?? fd?.recommendationKey ?? 'sin consenso', objetivo, potencial };
      }
    }
  } else {
    f.gastoAnual = enRango(fp?.feesExpensesInvestment?.annualReportExpenseRatio ?? ks?.annualReportExpenseRatio, -0.0001, 0.05);
    f.categoria = fp?.categoryName || undefined;
    const sectores: Record<string, number> = {};
    for (const w of th?.sectorWeightings ?? []) {
      for (const [k, v] of Object.entries(w) as [string, unknown][]) if (typeof v === 'number' && v > 0) sectores[sectorEnEspanol(k) ?? k] = (sectores[sectorEnEspanol(k) ?? k] ?? 0) + v;
    }
    if (Object.keys(sectores).length) f.sectores = sectores;
    const principales = (th?.holdings ?? [])
      .filter(h => h.symbol && typeof h.holdingPercent === 'number')
      .map(h => ({ ticker: h.symbol.toUpperCase(), nombre: h.holdingName, peso: h.holdingPercent }));
    if (principales.length) f.principales = principales;
  }
  return f;
}

// Caché por instancia: los fundamentales cambian una vez por trimestre
const TTL = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; data: Fundamentales | null }>();
const AL_DIA_BASE = 3 * 24 * 60 * 60 * 1000;

// Los que guardó el minero: los de los últimos días se usan tal cual; los más antiguos quedan de respaldo por si
// Yahoo no responde (los fundamentales cambian poco de una semana a otra)
async function desdeBase(tickers: string[]): Promise<{ alDia: Map<string, Fundamentales>; antiguos: Map<string, Fundamentales> }> {
  const alDia = new Map<string, Fundamentales>(), antiguos = new Map<string, Fundamentales>();
  if (tickers.length === 0) return { alDia, antiguos };
  try {
    const { data, error } = await supabase.from('fundamentales').select('ticker, actualizado, datos').in('ticker', tickers);
    if (error) throw error;
    for (const r of data ?? []) {
      const f = desdeResumen(r.ticker, r.datos as Resumen);
      (Date.now() - new Date(r.actualizado).getTime() < AL_DIA_BASE ? alDia : antiguos).set(r.ticker, f);
    }
  } catch (e) {
    console.warn('Sin fundamentales guardados:', e instanceof Error ? e.message.slice(0, 120) : e);
  }
  return { alDia, antiguos };
}

export async function fundamentales(tickers: string[], concurrencia = 6): Promise<Map<string, Fundamentales>> {
  const out = new Map<string, Fundamentales>();
  let pendientes = tickers.filter(t => {
    const hit = cache.get(t);
    if (hit && Date.now() - hit.at < TTL) {
      if (hit.data) out.set(t, hit.data);
      return false;
    }
    return !t.startsWith('^') && !t.includes('=');
  });
  const { alDia, antiguos } = await desdeBase(pendientes);
  for (const [t, f] of alDia) {
    cache.set(t, { at: Date.now(), data: f });
    out.set(t, f);
  }
  pendientes = pendientes.filter(t => !alDia.has(t));
  // Pocas consultas a la vez: Yahoo limita (HTTP 429) cuando llegan muchas juntas
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrencia, pendientes.length) }, async () => {
    while (i < pendientes.length) {
      const t = pendientes[i++];
      // Un reintento tras una pausa: Yahoo rechaza de forma intermitente cuando llegan muchas consultas seguidas
      for (let intento = 0; intento < 2; intento++) {
        try {
          const f = await cargar(t);
          cache.set(t, { at: Date.now(), data: f });
          if (f) out.set(t, f);
          break;
        } catch (e) {
          if (intento === 0) {
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          console.warn(`Sin fundamentales de ${t} en Yahoo:`, e instanceof Error ? e.message.slice(0, 120) : e);
          const respaldo = antiguos.get(t);
          if (respaldo) out.set(t, respaldo);
        }
      }
    }
  }));
  return out;
}
