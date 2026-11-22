/**
 * Bot del correo: lee el buzón dedicado (al que reenvías los comprobantes de tus corredoras), entiende cada compra o
 * venta (src/lib/comprobantes.ts: XTB, Vector Capital = Racional Portafolio y Zesty, Alpaca = Fintual Acciones), la
 * registra en mi_portafolio con las mismas reglas que el botón "Registrar" de la app y te avisa por Telegram.
 *
 * Para no confundirse ni duplicar:
 *   - Cada correo ya leído queda con la etiqueta de Gmail "omnicapital-procesado" y no se vuelve a leer. Si una
 *     operación no se pudo registrar (por ejemplo una venta de algo que no tienes guardado), el correo queda con
 *     "omnicapital-revisar", te avisa una sola vez y no se reintenta.
 *   - Una compra que ya está en tu cartera (mismo ticker y día, cantidad y precio casi iguales) no se anota de nuevo.
 *   - --linea-base=AAAA-MM-DD: los correos de esa fecha hacia atrás se marcan como ya registrados SIN tocar la cartera
 *     (para lo que anotaste a mano antes de encender el bot).
 *   - Traspasos entre corredoras (Racional → Zesty), dividendos, comisiones y cartolas mensuales no son operaciones: se ignoran.
 *
 * El repositorio y sus registros son públicos: el bot no imprime tickers, cantidades ni montos, solo cuántos hay.
 * El detalle va a tu Telegram.
 *
 * Variables: CORREO_BOT, CORREO_BOT_CLAVE (clave de aplicación de Google), CLAVE_PDF_* (claves de los PDF), SUPABASE_URL,
 * SUPABASE_SECRET_KEY, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID y AGENTE_USUARIO (el user_id de Supabase del dueño).
 * Sin CORREO_BOT_CLAVE no hace nada.
 *
 *   npx tsx scripts/leer-correo.ts --linea-base=2026-11-21     # lo que corre GitHub Actions (correo_bot.yml)
 *   npx tsx scripts/leer-correo.ts --simular                   # lee el buzón y muestra lo que haría, sin cambiar nada
 *   npx tsx scripts/leer-correo.ts --eml=../Cartolas/comprobantes --simular   # prueba con correos guardados (.eml)
 */
import fs from 'node:fs';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { textoDePdf } from '../src/lib/CartolaParser';
import { leerComprobante, juntar, yaRegistrada, type Operacion } from '../src/lib/comprobantes';
import { leerEjecucion } from '../src/lib/ejecucion';
import { registrarEjecucion } from '../src/lib/ejecucionBase';
import { abrirPdf, clavesPdf } from './claves-pdf.mjs';

const ETIQUETA_LISTO = 'omnicapital-procesado';
const ETIQUETA_REVISAR = 'omnicapital-revisar';
const VENTANA_DIAS = 60;

interface Correo {
  id: string; // uid en el buzón (o el nombre del archivo con --eml)
  de: string;
  asunto: string;
  fecha: string; // YYYY-MM-DD, hora de Chile
  adjuntos: { nombre: string; datos: Buffer }[];
  cuerpo: string;
}

const args = process.argv.slice(2);
const simular = args.includes('--simular');
const lineaBase = args.find(a => a.startsWith('--linea-base='))?.slice('--linea-base='.length);
const carpetaEml = args.find(a => a.startsWith('--eml='))?.slice('--eml='.length);

const enChile = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(d);

function claves(): string[] {
  const deEntorno = Object.entries(process.env).filter(([k, v]) => /^CLAVE_PDF_/.test(k) && v?.trim()).map(([, v]) => v!.trim());
  return [...new Set([...deEntorno, ...clavesPdf([])])];
}

async function aCorreo(id: string, fuente: Buffer | string): Promise<Correo> {
  const m = await simpleParser(fuente);
  return {
    id,
    de: m.from?.text ?? '',
    asunto: m.subject ?? '',
    fecha: enChile(m.date ?? new Date()),
    cuerpo: (m.text ?? '').slice(0, 2000),
    adjuntos: m.attachments.filter(a => /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.filename ?? '')).map(a => ({ nombre: a.filename ?? 'adjunto.pdf', datos: a.content })),
  };
}

// --- Qué dice cada correo ----------------------------------------------------------------------------------------------

interface Resultado { operaciones: Operacion[]; avisos: string[] }

async function entender(c: Correo, claveS: string[]): Promise<Resultado> {
  const lecturas = [];
  const avisos: string[] = [];
  for (const a of c.adjuntos) {
    try {
      const doc = await abrirPdf(a.datos, claveS);
      lecturas.push(leerComprobante(await textoDePdf(doc)));
    } catch (e) {
      const conClave = (e as { name?: string })?.name === 'PasswordException';
      avisos.push(conClave ? `No pude abrir el PDF "${a.nombre}": falta o no sirve su clave (CLAVE_PDF_*).` : `No pude leer el PDF "${a.nombre}".`);
    }
  }
  const l = juntar(lecturas);
  // Un comprobante de operaciones que no se reconoce no se ignora en silencio
  if (!l.fuente && !avisos.length && /(confirmaci[oó]n de (transacciones|ejecuci[oó]n|[oó]rdenes?)|comprobante de tus)/i.test(c.asunto)) {
    avisos.push(`Parece un comprobante de operaciones, pero no reconozco su formato: "${c.asunto}".`);
  }
  // Racional avisa cada venta del Portafolio en el cuerpo y la detalla en la factura de Vector, que es la que se lee.
  // Las de Stocks (dólares) llegan sin detalle: no hay de dónde sacar el precio.
  if (!c.adjuntos.length && /racional/i.test(c.de) && /^(compraste|vendiste)/i.test(c.asunto) && !/portafolio/i.test(c.asunto + c.cuerpo)) {
    avisos.push(`Racional avisó una operación en Stocks sin detalle ("${c.asunto}"): regístrala a mano en la app.`);
  }
  return { operaciones: l.operaciones, avisos: [...avisos, ...l.avisos] };
}

// --- Registro ----------------------------------------------------------------------------------------------------------

async function dueno(db: SupabaseClient): Promise<string> {
  const fijo = (process.env.AGENTE_USUARIO ?? '').trim();
  if (fijo) return fijo;
  const { data, error } = await db.from('mi_portafolio').select('user_id').not('user_id', 'is', null).limit(1000);
  if (error) throw new Error(`No se pudo leer la cartera: ${error.message}`);
  const ids = [...new Set((data ?? []).map(r => r.user_id as string))];
  if (ids.length !== 1) throw new Error(ids.length ? 'Hay carteras de varios usuarios: define AGENTE_USUARIO.' : 'No hay ninguna cartera guardada.');
  return ids[0];
}

type Destino = 'registrada' | 'repetida' | 'revisar' | 'reintentar';

async function aplicar(db: SupabaseClient, usuario: string, o: Operacion): Promise<{ destino: Destino; texto: string }> {
  const nombre = `${o.lado === 'COMPRAR' ? 'Compra' : 'Venta'} de ${o.cantidad} ${o.ticker}${o.lado === 'COMPRAR' ? ` a ${o.precio} ${o.moneda}` : ''} (${o.fecha}, ${o.fuente})`;
  const e = leerEjecucion(o.lado === 'COMPRAR'
    ? { ticker: o.ticker, lado: 'COMPRAR', cantidad: o.cantidad, precio: o.precio, moneda: o.moneda, fecha: o.fecha }
    : { ticker: o.ticker, lado: 'VENDER', cantidad: o.cantidad });
  if ('error' in e) return { destino: 'revisar', texto: `${nombre}: ${e.error}` };
  if (o.lado === 'COMPRAR') {
    const { data, error } = await db.from('mi_portafolio').select('ticker, cantidad, precio_compra, purchase_date').eq('user_id', usuario).eq('ticker', o.ticker);
    if (error) return { destino: 'reintentar', texto: `${nombre}: no se pudo leer la cartera.` };
    const lotes = (data ?? []).map(l => ({ ...l, cantidad: Number(l.cantidad), precio_compra: Number(l.precio_compra) }));
    if (yaRegistrada(o, lotes)) return { destino: 'repetida', texto: `${nombre}: ya estaba en tu cartera.` };
  }
  if (simular) return { destino: 'registrada', texto: `${nombre}: la registraría.` };
  const r = await registrarEjecucion(db, usuario, e);
  if (r.ok) return { destino: 'registrada', texto: `${nombre}: registrada.` };
  if (r.estado === 409) return { destino: 'repetida', texto: `${nombre}: ya estaba en tu cartera.` };
  return { destino: r.estado >= 500 ? 'reintentar' : 'revisar', texto: `${nombre}: ${r.error}` };
}

async function telegram(texto: string) {
  const token = (process.env.TELEGRAM_TOKEN ?? '').trim();
  const chat = (process.env.TELEGRAM_CHAT_ID ?? '').trim();
  if (!token || !chat) { console.log('Sin Telegram configurado: el aviso no se envió.'); return; }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: texto.slice(0, 4000), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) console.log(`Telegram respondió ${r.status}.`);
}

// --- Fuentes de correos ------------------------------------------------------------------------------------------------

async function correosDeArchivos(dir: string): Promise<Correo[]> {
  const archivos = fs.readdirSync(dir, { recursive: true }).map(String).filter(f => f.toLowerCase().endsWith('.eml')).sort();
  return Promise.all(archivos.map(f => aCorreo(f, fs.readFileSync(path.join(dir, f)))));
}

async function main() {
  const claveS = claves();
  const db = (() => {
    const url = (process.env.SUPABASE_URL ?? '').trim();
    const key = (process.env.SUPABASE_SECRET_KEY ?? '').trim();
    if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY.');
    return createClient(url, key, { auth: { persistSession: false } });
  })();

  let imap: ImapFlow | null = null;
  let correos: Correo[];
  if (carpetaEml) {
    correos = await correosDeArchivos(path.resolve(carpetaEml));
  } else {
    const usuario = (process.env.CORREO_BOT ?? '').trim();
    const clave = (process.env.CORREO_BOT_CLAVE ?? '').replace(/\s+/g, '');
    if (!usuario || !clave) {
      console.log('Falta CORREO_BOT o CORREO_BOT_CLAVE (la clave de aplicación de Google): el bot del correo todavía no puede leer el buzón.');
      return;
    }
    imap = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: usuario, pass: clave }, logger: false });
    await imap.connect();
    await imap.mailboxOpen('INBOX');
    const uids = (await imap.search({ gmailraw: `newer_than:${VENTANA_DIAS}d -label:${ETIQUETA_LISTO} -label:${ETIQUETA_REVISAR}` }, { uid: true })) || [];
    correos = [];
    for (const uid of uids) {
      const m = await imap.fetchOne(String(uid), { source: true }, { uid: true });
      if (m && m.source) correos.push(await aCorreo(String(uid), m.source));
    }
  }
  correos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  console.log(`Correos por revisar: ${correos.length}${simular ? ' (simulación: no se cambia nada)' : ''}.`);

  const usuarioDb = correos.length ? await dueno(db) : '';
  const lineas: string[] = [];
  const problemas: string[] = [];
  const cuenta = { registradas: 0, repetidas: 0, base: 0, revisar: 0, reintentar: 0, ignorados: 0 };

  for (const c of correos) {
    const marcar = async (etiqueta: string) => {
      if (simular || !imap) return;
      await imap.messageFlagsAdd(c.id, [etiqueta], { uid: true, useLabels: true });
    };
    if (lineaBase && c.fecha <= lineaBase) {
      cuenta.base++;
      await marcar(ETIQUETA_LISTO);
      continue;
    }
    const { operaciones, avisos } = await entender(c, claveS);
    let destinoCorreo: 'listo' | 'revisar' | 'reintentar' = 'listo';
    for (const o of operaciones) {
      const { destino, texto } = await aplicar(db, usuarioDb, o);
      if (destino === 'registrada') { cuenta.registradas++; lineas.push(`✅ ${texto}`); }
      else if (destino === 'repetida') { cuenta.repetidas++; lineas.push(`↩️ ${texto}`); }
      else if (destino === 'revisar') { cuenta.revisar++; problemas.push(`⚠️ ${texto}`); destinoCorreo = 'revisar'; }
      else { cuenta.reintentar++; destinoCorreo = destinoCorreo === 'revisar' ? 'revisar' : 'reintentar'; }
    }
    if (avisos.length) { problemas.push(...avisos.map(a => `⚠️ ${a} (correo del ${c.fecha})`)); destinoCorreo = 'revisar'; }
    if (!operaciones.length && !avisos.length) cuenta.ignorados++;
    if (destinoCorreo === 'listo') await marcar(ETIQUETA_LISTO);
    else if (destinoCorreo === 'revisar') await marcar(ETIQUETA_REVISAR);
  }
  if (imap) await imap.logout();

  console.log(`Registradas ${cuenta.registradas}, repetidas ${cuenta.repetidas}, de la línea base ${cuenta.base}, sin operaciones ${cuenta.ignorados}, para revisar ${cuenta.revisar}, por reintentar ${cuenta.reintentar}.`);
  if (simular) {
    for (const l of [...lineas, ...problemas]) console.log(`  ${l}`);
    return;
  }
  const partes: string[] = [];
  if (lineas.length) partes.push(`📬 Registré desde tu correo:\n${lineas.join('\n')}`);
  if (problemas.length) partes.push(`Necesito que mires esto (no lo registré):\n${problemas.join('\n')}`);
  if (partes.length) await telegram(partes.join('\n\n'));
}

main().catch(e => {
  console.error(`El bot del correo falló: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
