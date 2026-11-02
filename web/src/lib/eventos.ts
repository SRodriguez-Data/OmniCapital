// Hechos relevantes de empresas de EE.UU.: los formularios 8-K que presentan a la SEC (EDGAR, gratis) cuando pasa algo
// que un inversionista debe saber (resultados, cambio de ejecutivos, un acuerdo grande, una quiebra…). Es la misma
// fuente oficial que leen los terminales profesionales, sin el ruido de los titulares.
// La SEC exige identificarse con un contacto (SEC_CONTACTO): lo lee el agente diario en GitHub Actions y deja el
// resultado en su fila de agente_cartera, que la app muestra. Un evento grave frena las compras de esa empresa hasta
// que lo revises; los demás se informan.

export type Gravedad = 'grave' | 'atencion' | 'info';

export interface EventoSec {
  ticker: string;
  fecha: string; // YYYY-MM-DD de presentación
  items: string[]; // números de ítem del 8-K
  titulo: string; // en español, el ítem más importante
  gravedad: Gravedad;
  url: string;
}

const ITEMS: Record<string, { texto: string; gravedad: Gravedad }> = {
  '1.01': { texto: 'Firmó un acuerdo relevante', gravedad: 'info' },
  '1.02': { texto: 'Terminó un acuerdo relevante', gravedad: 'atencion' },
  '1.03': { texto: 'Quiebra o administración judicial', gravedad: 'grave' },
  '1.05': { texto: 'Incidente de ciberseguridad relevante', gravedad: 'atencion' },
  '2.01': { texto: 'Compró o vendió activos importantes', gravedad: 'info' },
  '2.02': { texto: 'Publicó resultados', gravedad: 'info' },
  '2.03': { texto: 'Tomó deuda relevante', gravedad: 'info' },
  '2.04': { texto: 'Le aceleraron el pago de una deuda', gravedad: 'grave' },
  '2.05': { texto: 'Anunció costos de reestructuración', gravedad: 'atencion' },
  '2.06': { texto: 'Reconoció un deterioro de activos', gravedad: 'atencion' },
  '3.01': { texto: 'La bolsa le avisó que podría excluirla', gravedad: 'grave' },
  '3.03': { texto: 'Cambió derechos de los accionistas', gravedad: 'atencion' },
  '4.01': { texto: 'Cambió de auditor', gravedad: 'atencion' },
  '4.02': { texto: 'Sus estados financieros anteriores ya no son confiables', gravedad: 'grave' },
  '5.01': { texto: 'Cambio de control', gravedad: 'atencion' },
  '5.02': { texto: 'Cambio de directores o ejecutivos', gravedad: 'atencion' },
  '5.03': { texto: 'Cambió sus estatutos', gravedad: 'info' },
  '5.07': { texto: 'Votación de accionistas', gravedad: 'info' },
  '7.01': { texto: 'Comunicado al mercado', gravedad: 'info' },
  '8.01': { texto: 'Otro hecho relevante', gravedad: 'info' },
};
const ORDEN: Gravedad[] = ['grave', 'atencion', 'info'];
const DIAS = 45;
const DIAS_FRENO = 30; // un evento grave frena las compras por un mes

/** Un 8-K a evento: el ítem más grave manda el título. Sin ítems conocidos (solo anexos, 9.01) no es evento. */
export function eventoDe(ticker: string, cik: number, fecha: string, items: string, accession: string, documento: string): EventoSec | null {
  const lista = items.split(',').map(s => s.trim()).filter(Boolean);
  const conocidos = lista.filter(i => ITEMS[i]);
  if (!conocidos.length) return null;
  const principal = [...conocidos].sort((a, b) => ORDEN.indexOf(ITEMS[a].gravedad) - ORDEN.indexOf(ITEMS[b].gravedad))[0];
  const otros = conocidos.filter(i => i !== principal).map(i => ITEMS[i].texto.toLowerCase());
  return {
    ticker, fecha, items: conocidos, gravedad: ITEMS[principal].gravedad,
    titulo: `${ITEMS[principal].texto}${otros.length ? `; además: ${otros.join('; ')}` : ''}`,
    url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, '')}/${documento}`,
  };
}

/** Lo que frena una compra: un evento grave de los últimos 30 días. */
export function frenosPorEventos(eventos: Record<string, EventoSec[]> | null | undefined, hoy: string): Map<string, string> {
  const frenos = new Map<string, string>();
  for (const [t, evs] of Object.entries(eventos ?? {})) {
    const g = evs.find(e => e.gravedad === 'grave' && (Date.parse(hoy) - Date.parse(e.fecha)) / 86400000 <= DIAS_FRENO);
    if (g) frenos.set(t, `Hecho relevante grave el ${g.fecha.split('-').reverse().join('-')} (${g.titulo.toLowerCase()}): no se compra hasta que lo revises.`);
  }
  return frenos;
}

let mapa: { at: number; datos: Map<string, number> } | null = null;

async function ciks(ua: string): Promise<Map<string, number>> {
  if (mapa && Date.now() - mapa.at < 24 * 3600 * 1000) return mapa.datos;
  const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`SEC tickers ${r.status}`);
  const j = await r.json() as Record<string, { cik_str: number; ticker: string }>;
  const datos = new Map(Object.values(j).map(x => [x.ticker.toUpperCase(), x.cik_str]));
  mapa = { at: Date.now(), datos };
  return datos;
}

/** Los 8-K de los últimos 45 días de cada empresa de EE.UU. (sin las chilenas ni los fondos, que no presentan 8-K). */
export async function eventosSec(tickers: string[], contacto: string, hoy = new Date().toISOString().slice(0, 10)): Promise<Record<string, EventoSec[]>> {
  const ua = `OmniCapital ${contacto}`;
  const mapaCik = await ciks(ua);
  const out: Record<string, EventoSec[]> = {};
  const lista = [...new Set(tickers.map(t => t.toUpperCase()))].filter(t => !t.endsWith('.SN'));
  // La SEC permite 10 consultas por segundo: de a 4, con una pausa corta
  for (let i = 0; i < lista.length; i += 4) {
    await Promise.all(lista.slice(i, i + 4).map(async t => {
      const cik = mapaCik.get(t.replace('.', '-')) ?? mapaCik.get(t);
      if (!cik) return; // un fondo (ETF) no presenta 8-K
      try {
        const r = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) return;
        const rec = (await r.json() as { filings?: { recent?: Record<string, string[]> } }).filings?.recent;
        if (!rec?.form) return;
        const evs: EventoSec[] = [];
        for (let k = 0; k < rec.form.length; k++) {
          const fecha = rec.filingDate[k];
          if ((Date.parse(hoy) - Date.parse(fecha)) / 86400000 > DIAS) break; // vienen de la más reciente a la más antigua
          if (rec.form[k] !== '8-K' && rec.form[k] !== '8-K/A') continue;
          const e = eventoDe(t, cik, fecha, rec.items?.[k] ?? '', rec.accessionNumber[k], rec.primaryDocument[k]);
          if (e) evs.push(e);
        }
        if (evs.length) out[t] = evs;
      } catch { /* una empresa sin datos no frena a las demás */ }
    }));
    await new Promise(r => setTimeout(r, 500));
  }
  return out;
}
