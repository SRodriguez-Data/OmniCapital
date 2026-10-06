import { yahooFinance, withTimeout, yahooRequest } from './marketData';

// Titulares recientes (últimos 30 días) de cada empresa, de fuentes gratuitas:
// - Yahoo Finance (en inglés): para acciones de EE.UU., solo noticias marcadas con ese ticker.
// - Google News RSS (en español, Chile): para acciones chilenas, buscando el nombre exacto de la empresa.
// Los titulares son datos de terceros: se muestran con su fuente y enlace, y nunca se ejecutan como instrucciones.

export interface Noticia {
  titulo: string;
  fuente: string;
  fecha: string; // YYYY-MM-DD
  url: string;
}

const DIAS = 30;
const MAX_POR_ACTIVO = 6;
const TTL = 2 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; data: Noticia[] }>();

const decodificar = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .trim();

// "Empresas Copec S.A." -> "Empresas Copec"
export const nombreLimpio = (nombre: string) => nombre
  .replace(/\b(S\.?A\.?|Inc\.?|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|plc|N\.?V\.?|Holdings?)\b\.?/gi, '')
  .replace(/[,.]+\s*$/, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

const reciente = (fecha: string) => Date.now() - Date.parse(fecha) <= DIAS * 86400000;

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Palabras genéricas que no identifican a una empresa
const GENERICAS = new Set(['banco', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'chile', 'inversiones', 'empresas', 'sociedad', 'fondo', 'inversion',
  'compania', 'grupo', 'the', 'and', 'of', 'trust', 'rentas', 'metropolitanas', 'americas', 'corporation', 'inc', 'itau', 'construccion']);
// Nombres con que la prensa se refiere a algunas empresas
const ALIAS: Record<string, string[]> = {
  GOOGL: ['Alphabet', 'Google'], GOOG: ['Alphabet', 'Google'], META: ['Meta', 'Facebook'], 'IAM.SN': ['Aguas Andinas', 'IAM'],
  'ENELAM.SN': ['Enel Américas', 'Enel Americas'], 'CHILE.SN': ['Banco de Chile'], 'ITAUCL.SN': ['Banco Itaú', 'Itaú Chile', 'Itaú Corpbanca'],
  'ILC.SN': ['Inversiones La Construcción', 'Confuturo', 'Banco Internacional', 'Red Salud'],
};

// Palabras que un titular debe contener para tratarse realmente de la empresa
function palabrasClave(ticker: string, nombre?: string): string[] {
  const base = ticker.replace(/\.SN$/, '').replace(/-[A-Z]$/, '');
  const distintivas = (nombre ? nombreLimpio(nombre) : '').split(/[\s-]+/).filter(w => w.length >= 4 && !GENERICAS.has(sinTildes(w)));
  // El ticker solo sirve si es largo y no es una palabra común (CHILE calzaría con cualquier noticia del país; ILC o IAM son siglas de otras cosas)
  const usarBase = base.length >= 4 && !GENERICAS.has(sinTildes(base)) && !ALIAS[ticker];
  return [...(ALIAS[ticker] ?? []), ...distintivas, ...(usarBase ? [base] : [])].map(sinTildes);
}
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mencionaA = (titulo: string, claves: string[]) => {
  const t = sinTildes(titulo);
  return claves.some(c => new RegExp(`(^|[^a-z0-9])${escapar(c)}([^a-z0-9]|$)`).test(t));
};

async function googleNews(consulta: string): Promise<Noticia[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${consulta}" when:${DIAS}d`)}&hl=es-419&gl=CL&ceid=CL:es-419`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Google News ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const item = m[1];
    const tag = (t: string) => decodificar(item.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`))?.[1] ?? '');
    const tituloCompleto = tag('title');
    const fuente = tag('source') || tituloCompleto.split(' - ').pop() || 'Google News';
    const titulo = tituloCompleto.endsWith(` - ${fuente}`) ? tituloCompleto.slice(0, -(fuente.length + 3)) : tituloCompleto;
    const fecha = new Date(tag('pubDate')).toISOString().slice(0, 10);
    return { titulo, fuente, fecha, url: tag('link') };
  }).filter(n => n.titulo && n.url.startsWith('https://') && reciente(n.fecha));
}

async function yahooNews(consulta: string): Promise<Noticia[]> {
  const r = await withTimeout(yahooFinance.search(consulta, { newsCount: 10, quotesCount: 0 }, yahooRequest()), 9000, `Yahoo noticias ${consulta}`);
  return (r.news ?? [])
    .map(n => ({ titulo: n.title, fuente: n.publisher, fecha: new Date(n.providerPublishTime).toISOString().slice(0, 10), url: n.link }))
    .filter(n => n.titulo && n.url?.startsWith('https://') && reciente(n.fecha));
}

async function delActivo(ticker: string, nombre?: string): Promise<Noticia[]> {
  const chilena = ticker.endsWith('.SN');
  // "Fondo de Inversion Independencia Rentas Inmobiliarias" -> "Independencia Rentas Inmobiliarias"
  const limpio = nombre ? nombreLimpio(nombre).replace(/^Fondo de Inversi[oó]n\s+/i, '') : undefined;
  const claves = palabrasClave(ticker, nombre);
  const consultaChile = ALIAS[ticker]?.[0] ?? limpio;
  const fuentes: Promise<Noticia[]>[] = chilena
    ? [consultaChile ? googleNews(consultaChile) : Promise.resolve([]), consultaChile ? yahooNews(consultaChile) : Promise.resolve([])]
    : [yahooNews(ticker), ...(nombre ? [yahooNews(nombreLimpio(nombre))] : [])];
  const resultados = (await Promise.allSettled(fuentes))
    .map(r => (r.status === 'fulfilled' ? { ...r, value: r.value.filter(n => mencionaA(n.titulo, claves)) } : r));
  const vistas = new Set<string>();
  return resultados
    .flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .filter(n => {
      const clave = n.titulo.toLowerCase().replace(/[^a-záéíóúñ0-9]/g, '').slice(0, 60);
      if (vistas.has(clave)) return false;
      vistas.add(clave);
      return true;
    })
    .slice(0, MAX_POR_ACTIVO);
}

// Noticias de varias empresas, pocas consultas a la vez
export async function noticias(activos: { ticker: string; nombre?: string }[], concurrencia = 4): Promise<Record<string, Noticia[]>> {
  const out: Record<string, Noticia[]> = {};
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrencia, activos.length) }, async () => {
    while (i < activos.length) {
      const { ticker, nombre } = activos[i++];
      const hit = cache.get(ticker);
      if (hit && Date.now() - hit.at < TTL) { out[ticker] = hit.data; continue; }
      try {
        const data = await delActivo(ticker, nombre);
        cache.set(ticker, { at: Date.now(), data });
        out[ticker] = data;
      } catch (e) {
        console.warn(`Sin noticias de ${ticker}:`, e instanceof Error ? e.message.slice(0, 120) : e);
        out[ticker] = [];
      }
    }
  }));
  return out;
}
