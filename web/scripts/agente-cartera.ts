/**
 * Agente de cartera: cada mañana hábil revisa la cartera real guardada en la app (mi_portafolio), calcula con las mismas
 * reglas de la web (src/lib/asesor.ts) qué comprar con el aporte del mes, el rebalanceo y los precios que cambian la
 * decisión, y avisa por Telegram solo cuando hay algo que hacer o mirar:
 *   - empezó un mes: qué comprar con tu aporte (núcleo + Top medido, según tu perfil),
 *   - cambió el plan (aparece o desaparece una venta o una compra),
 *   - un precio quedó a menos de 3% de un nivel que cambia la decisión,
 *   - una de tus empresas de EE.UU. presentó a la SEC un hecho relevante que conviene mirar (src/lib/eventos.ts),
 *   - hay un aviso nuevo (src/lib/avisos.ts): un mercado pasó a rojo, se acercó a la zona roja o volvió a verde, o una
 *     posición devolvió la mitad o más de su mejor ganancia,
 *   - el primer día hábil de la semana (o si pasó una semana sin avisos), con el resumen,
 *   - con --forzar, siempre.
 * Revisa una vez por día: si GitHub dispara también el horario de respaldo, esa corrida no hace nada. Lo avisado se
 * recuerda en la tabla agente_cartera (supabase/agente_cartera.sql), que solo ve su dueño. Si una corrida falla, el
 * workflow avisa por Telegram.
 *
 * El repositorio es público y los registros de GitHub Actions también: el agente no imprime nada de la cartera,
 * solo cuántas órdenes hay y si avisó.
 *
 *   npx tsx scripts/agente-cartera.ts            # lo que corre GitHub Actions (agente_cartera.yml)
 *   npx tsx scripts/agente-cartera.ts --forzar   # avisa aunque nada haya cambiado
 *   npx tsx scripts/agente-cartera.ts --prueba   # no envía ni guarda: muestra el mensaje (solo en tu computador)
 *
 * Cada aviso llega como notificación al celular si activaste los avisos en la app (pestaña Asesor). Telegram queda de
 * respaldo: se usa solo si el aviso no llegó a ningún celular (o siempre, con la variable AGENTE_TELEGRAM=siempre).
 *
 * Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, TELEGRAM_TOKEN y TELEGRAM_CHAT_ID; VAPID_PRIVATE_KEY para las
 * notificaciones al celular (sin ella solo Telegram); si hay carteras de más de un
 * usuario, AGENTE_USUARIO (el user_id de Supabase del dueño); SEC_CONTACTO para leer los hechos relevantes (sin ella se
 * omiten). En tu computador las toma del .env de la raíz.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AsesorDelDia } from '../src/lib/asesor';
import type { EventoSec } from '../src/lib/eventos';
import type { Semaforo } from '../src/lib/proteccion';

const APP = 'https://quantum-trader-app.vercel.app';
const CERCA = 0.03;
const MAX_MENSAJE = 4000; // Telegram acepta 4096 caracteres
const args = new Set(process.argv.slice(2));
const prueba = args.has('--prueba');
const forzar = args.has('--forzar');

// Solo lo que imprime el agente llega al registro: las librerías avisan con el ticker cuando falla un dato
const decir = console.log.bind(console);
for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) console[k] = () => {};
// Si algo falla, el error se imprime sin los tickers de la cartera
let privados: string[] = [];
const sinPrivados = (texto: string) => privados.reduce((t, x) => t.split(x).join('***'), texto);

function cargarEnv() {
  const archivo = resolve(__dirname, '../../.env');
  if (!existsSync(archivo)) return;
  for (const linea of readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function requerida(nombre: string): string {
  const v = (process.env[nombre] ?? '').trim();
  if (!v) throw new Error(`Falta la variable ${nombre}.`);
  return v;
}

interface Estado {
  fecha: string;
  firma: string[];
  cerca: string[];
  avisos: string[]; // ids de los avisos vigentes (lib/avisos.ts)
  rojos: string[]; // mercados con el semáforo en rojo
  ultimoAviso: string | null;
  mesAporte: string | null; // YYYY-MM del último aviso del aporte del mes
  eventosVistos: string[]; // hechos relevantes ya avisados (su enlace)
}

const hoyEnChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

async function dueno(db: SupabaseClient): Promise<string> {
  const fijo = (process.env.AGENTE_USUARIO ?? '').trim();
  if (fijo) return fijo;
  const { data, error } = await db.from('mi_portafolio').select('user_id').not('user_id', 'is', null).limit(1000);
  if (error) throw new Error(`No se pudo leer la cartera: ${error.message}`);
  const ids = [...new Set((data ?? []).map(r => r.user_id as string))];
  if (ids.length !== 1) throw new Error(ids.length ? 'Hay carteras de varios usuarios: define AGENTE_USUARIO.' : 'No hay ninguna cartera guardada.');
  return ids[0];
}

async function leerEstado(db: SupabaseClient, usuario: string): Promise<{ estado: Estado | null; hayTabla: boolean }> {
  const { data, error } = await db.from('agente_cartera').select('datos').eq('user_id', usuario).maybeSingle();
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') return { estado: null, hayTabla: false };
    throw new Error(`No se pudo leer el estado del agente: ${error.message}`);
  }
  const d = data?.datos as Partial<Estado> | undefined;
  return {
    estado: d?.fecha
      ? { fecha: d.fecha, firma: d.firma ?? [], cerca: d.cerca ?? [], avisos: d.avisos ?? [], rojos: d.rojos ?? [], ultimoAviso: d.ultimoAviso ?? null, mesAporte: d.mesAporte ?? null, eventosVistos: d.eventosVistos ?? [] }
      : null,
    hayTabla: true,
  };
}

// --- Mensaje ---------------------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sinSufijo = (t: string) => esc(t.replace(/\.SN$/, ''));
const pct0 = (x: number) => `${Math.round(x * 100)}%`;
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const corto = (s: string, max = 150) => (s.length <= max ? s : `${s.slice(0, s.lastIndexOf(' ', max))}…`);

const signo1 = (x: number) => `${x >= 0 ? '+' : '−'}${pct1(Math.abs(x)).replace('.', ',')}`;

// Una línea por mercado: color, distancia a su media de 200 días y el cierre que lo cambiaría
function lineaSemaforo(s: Semaforo, fmtNivel: (s: Semaforo, x: number) => string): string {
  const nombre = s.nombre.replace(/^.*\((.*)\)$/, '$1');
  const rojo = s.estado === 'rojo';
  return `${rojo ? '🔴' : '🟢'} <b>${esc(nombre)}</b> ${signo1(s.distancia)} vs. su media · ${rojo ? 'verde si cierra sobre' : 'rojo si cierra bajo'} ${esc(fmtNivel(s, s.cambiaEn))} (${signo1(s.distanciaCambio)})`;
}

const VERBO: Record<AsesorDelDia['veredicto']['accion'], string> = { COMPRAR: '🟢 COMPRA', 'VENDER Y COMPRAR': '🔁 VENDE Y COMPRA', VENDER: '🔴 VENDE', MANTENER: '⚪ MANTÉN' };

function mensaje(asesor: AsesorDelDia, motivos: string[], avisos: string[], verdes: Semaforo[], hoy: string,
  fmtPrecio: (n: number, m: 'USD' | 'CLP') => string, fmtNivel: (s: Semaforo, x: number) => string, hechos: EventoSec[]): string {
  const plan = asesor.rebalanceo;
  const cantidad = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 4 });
  const [a, m, d] = hoy.split('-');
  const l: string[] = [`<b>🧭 Tu asesor · ${d}-${m}-${a}</b>`];
  const sector = plan.antes.sector;
  l.push(`Valor ${pesos(plan.valorCLP)} · Chile ${pct0(plan.antes.chile)} (meta hasta ${pct0(plan.metaChile)})${sector ? ` · ${esc(sector.nombre)} ${pct0(sector.peso)} (máx. 35%)` : ''}`);
  l.push('', `<b>${VERBO[asesor.veredicto.accion]}: ${esc(asesor.veredicto.titulo)}</b>`);

  const ap = asesor.aporte;
  if (ap?.ordenes.length) {
    l.push('', `<b>💰 Tu aporte del mes (${pesos(ap.montoCLP)})</b>`);
    for (const o of ap.ordenes) {
      l.push(`• <b>${sinSufijo(o.ticker)}</b> ${cantidad(o.cantidad)} · hasta ${fmtPrecio(o.limite, o.moneda)} · ≈${pesos(o.montoCLP)}${o.papel === 'nucleo' ? ' · núcleo' : ` · Top #${o.puesto}`}`);
    }
    const ev = ap.evidencia.top['EE.UU.'];
    if (ap.ordenes.some(o => o.papel === 'top' && o.mercado === 'EE.UU.') && ev) l.push(`<i>${esc(corto(ev, 260))}</i>`);
    for (const n of ap.notas.slice(0, 2)) l.push(`<i>${esc(corto(n, 220))}</i>`);
  }

  if (hechos.length) {
    l.push('', '<b>📰 Hechos relevantes de tus empresas (SEC)</b>');
    for (const e of hechos.slice(0, 5)) l.push(`${e.gravedad === 'grave' ? '🔴' : '🟡'} <b>${esc(e.ticker)}</b> ${e.fecha.slice(8, 10)}-${e.fecha.slice(5, 7)}: ${esc(corto(e.titulo, 160))} · <a href="${esc(e.url)}">ver</a>`);
    if (hechos.some(e => e.gravedad === 'grave')) l.push('<i>Un hecho grave frena las compras de esa empresa por un mes, hasta que lo revises.</i>');
  }
  for (const f of asesor.frenos.filter(f => !hechos.some(e => e.ticker === f.ticker && e.gravedad === 'grave')).slice(0, 2)) {
    l.push(`🔴 <b>${esc(f.ticker)}</b>: ${esc(corto(f.motivo, 200))}`);
  }

  if (plan.semaforos.length) {
    l.push('', '<b>🚦 Mercados</b>');
    for (const s of plan.semaforos) l.push(lineaSemaforo(s, fmtNivel));
  }
  for (const s of verdes) {
    l.push(`✅ <b>${esc(s.nombre)}</b> volvió a verde: si dejaste plata en refugio por la protección, ingrésala como aporte en el Optimizador para volver a invertirla.`);
  }
  const importantes = plan.avisos.filter(x => x.nivel !== 'info');
  if (importantes.length) {
    l.push('', '<b>⚠️ Avisos</b>');
    for (const x of importantes.slice(0, 4)) {
      l.push(`${x.nivel === 'alerta' ? '🔴' : '🟡'} <b>${esc(x.titulo)}</b>`, esc(corto(x.detalle, 320)), `→ ${esc(corto(x.queHacer, 340))}`);
    }
  }

  if (plan.ventas.length) {
    l.push('', '<b>🔴 Vender</b>');
    for (const o of plan.ventas) {
      l.push(`• <b>${sinSufijo(o.ticker)}</b> ${cantidad(o.cantidad)}${o.todo ? ' (todo)' : ''} · límite ${fmtPrecio(o.limite, o.moneda)} · ≈${pesos(o.montoCLP)}`);
      l.push(`   <i>${esc(corto(o.motivo))} Peso ${pct1(o.pesoAntes)} → ${pct1(o.pesoDespues)}.</i>`);
    }
  }
  if (plan.compras.length) {
    l.push('', `<b>🟢 Comprar</b> con ${pesos(plan.comprasCLP)}${plan.ventas.length ? ' de las ventas' : ''}`);
    for (const o of plan.compras) {
      l.push(`• <b>${sinSufijo(o.ticker)}</b> ${cantidad(o.cantidad)} · hasta ${fmtPrecio(o.limite, o.moneda)} · ≈${pesos(o.montoCLP)}`);
      if (plan.reinversion === 'paridad') l.push(`   <i>${esc(o.motivo.replace(/^Señal AUMENTAR\.\s*/, '').split(/[:.]/)[0])} · peso ${pct1(o.pesoAntes)} → ${pct1(o.pesoDespues)}</i>`);
    }
  }
  if (plan.ventas.length || plan.compras.length) {
    l.push('', `Después: Chile ${pct0(plan.despues.chile)}${plan.despues.sector ? ` · ${esc(plan.despues.sector.nombre)} ${pct0(plan.despues.sector.peso)}` : ''}. Primero vende y después compra, con órdenes límite.`);
  } else {
    l.push('', '✅ Nada que vender: tu cartera está dentro de sus límites y nada tiene una señal de venta con evidencia.');
  }
  const mantener = plan.posturas.filter(p => p.accion === 'MANTENER').length;
  if (mantener) l.push(`⚪ Mantener: ${mantener} posiciones.`);

  if (plan.refugioCLP > 0) l.push('', `🛟 ${pesos(plan.refugioCLP)} de las ventas van a refugio (depósito o money market), no a bolsa, hasta que su mercado vuelva a verde.`);
  if (plan.niveles.length) {
    l.push('', '<b>🎯 Precios que vigilo</b>');
    for (const n of plan.niveles.slice(0, 6)) l.push(`• <b>${sinSufijo(n.ticker)}</b>: ${esc(corto(n.texto, 200))}`);
  }
  // Lo que no se pudo verificar hoy (cotizaciones, dólar): para no ejecutar a ciegas
  if (avisos.length) {
    l.push('', '<b>⚠️ Datos de hoy</b>');
    for (const a of avisos.slice(0, 3)) l.push(`• ${esc(corto(a, 200))}`);
  }
  l.push('', `<i>Te aviso porque: ${motivos.join(', ')}.</i>`,
    `Tu asesor, con el botón para registrar lo que compres: ${APP}/?vista=asesor`);

  let texto = l.join('\n');
  if (texto.length > MAX_MENSAJE) texto = `${texto.slice(0, texto.lastIndexOf('\n', MAX_MENSAJE - 60))}\n…\nDetalle completo: ${APP}`;
  return texto;
}

// Notificación al celular: el veredicto y por qué aviso, con el enlace a la pestaña Asesor. Una suscripción que el
// navegador dio de baja se borra
async function enviarCelular(db: SupabaseClient, usuario: string, asesor: AsesorDelDia, motivos: string[], hechos: EventoSec[]): Promise<{ enviados: number; detalle: string }> {
  const nada = (detalle: string) => ({ enviados: 0, detalle });
  const privada = (process.env.VAPID_PRIVATE_KEY ?? '').trim();
  if (!privada) return nada('sin llave de notificaciones');
  const { data, error } = await db.from('push_suscripciones').select('endpoint, p256dh, auth').eq('user_id', usuario);
  if (error) return nada(error.code === 'PGRST205' || error.code === '42P01' ? 'falta la tabla push_suscripciones' : 'no se pudieron leer las suscripciones');
  if (!data?.length) return nada('ningún celular suscrito');
  const { enviarPush } = await import('../src/lib/push');
  const v = asesor.veredicto;
  const partes = [v.detalle.split(' Además:')[0]];
  if (hechos.length) partes.push(`SEC: ${hechos.slice(0, 2).map(e => `${e.ticker} ${e.titulo.toLowerCase()}`).join('; ')}.`);
  partes.push(`Te aviso porque ${motivos.join(', ')}.`);
  const r = await enviarPush(data, { titulo: `${VERBO[v.accion].replace(/^\S+\s/, '')}: ${v.titulo}`, cuerpo: partes.join(' '), url: '/?vista=asesor', etiqueta: 'asesor' },
    privada, (process.env.SEC_CONTACTO ?? '').trim() || 'avisos@omnicapital.app');
  if (r.vencidas.length) await db.from('push_suscripciones').delete().in('endpoint', r.vencidas);
  return { enviados: r.enviados, detalle: `${r.enviados} de ${data.length} celulares` };
}

async function enviarTelegram(texto: string) {
  const token = requerida('TELEGRAM_TOKEN');
  const chat = requerida('TELEGRAM_CHAT_ID');
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  // El error nunca lleva la URL: el token va en ella
  const j = await r.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!j?.ok) throw new Error(`Telegram no aceptó el mensaje: ${j?.description ?? `HTTP ${r.status}`}`);
}

// --- Corrida ---------------------------------------------------------------------------------------------------------

async function main() {
  cargarEnv();
  // Las librerías de la web leen Supabase con estas variables; aquí, con la clave secreta del job
  const url = requerida('SUPABASE_URL');
  const clave = requerida('SUPABASE_SECRET_KEY');
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = clave;
  const [{ asesorDelDia }, { fmtPrecio }, { parsePerfil }, { parsePortfolioItems }, { fmtNivel }] = await Promise.all([
    import('../src/lib/asesor'), import('../src/lib/rebalanceo'), import('../src/lib/perfil'), import('../src/lib/validation'), import('../src/lib/avisos'),
  ]);
  const db = createClient(url, clave, { auth: { persistSession: false } });

  const usuario = await dueno(db);
  const [cartera, perfilFila, { estado, hayTabla }] = await Promise.all([
    db.from('mi_portafolio').select('ticker, cantidad, precio_compra, moneda, purchase_date').eq('user_id', usuario),
    db.from('perfil_inversionista').select('datos').eq('user_id', usuario).maybeSingle(),
    leerEstado(db, usuario),
  ]);
  if (cartera.error) throw new Error(`No se pudo leer la cartera: ${cartera.error.message}`);
  privados = [...new Set((cartera.data ?? []).flatMap(r => [String(r.ticker), String(r.ticker).replace(/\.SN$/, '')]))]
    .filter(t => t.length >= 2).sort((a, b) => b.length - a.length);
  const hoy = hoyEnChile();
  if (estado?.fecha === hoy && !forzar && !prueba) {
    decir('Agente de cartera: ya revisó la cartera hoy; esta corrida (horario de respaldo) no hace nada.');
    return;
  }
  const parsed = parsePortfolioItems(cartera.data);
  if ('error' in parsed) throw new Error(`La cartera guardada no es válida (${parsed.error.split(':')[0]}).`);
  const perfil = parsePerfil(perfilFila.data?.datos);

  // Hechos relevantes (SEC) de tus empresas de EE.UU. y de las ideas del Top: los graves frenan sus compras
  const contacto = (process.env.SEC_CONTACTO ?? '').trim();
  let eventos: Record<string, EventoSec[]> | null = null;
  if (contacto) {
    const [{ eventosSec }, { ideasDelBot }] = await Promise.all([import('../src/lib/eventos'), import('../src/lib/ideas')]);
    const ideas = await ideasDelBot().catch(() => null);
    eventos = await eventosSec([...parsed.items.map(i => i.ticker), ...(ideas?.us ?? []).map(i => i.ticker)], contacto, hoy)
      .catch(e => { decir(`Sin hechos relevantes de la SEC hoy (${e instanceof Error ? e.message.slice(0, 80) : 'error'}).`); return null; });
  }
  const { asesor, report } = await asesorDelDia(parsed.items, perfil, { eventos });
  const mias = new Set(parsed.items.map(i => i.ticker.toUpperCase()));
  const hechos = Object.values(eventos ?? {}).flat()
    .filter(e => mias.has(e.ticker) && e.gravedad !== 'info' && !(estado?.eventosVistos ?? []).includes(e.url))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const plan = asesor.rebalanceo;
  const mes = hoy.slice(0, 7);
  const aporteNuevo = !!asesor.aporte?.ordenes.length && estado?.mesAporte !== mes;

  // ¿Hay algo que avisar?
  const firma = [...plan.ventas, ...plan.compras].map(o => `${o.lado} ${o.ticker}`).sort();
  const cerca = plan.niveles.filter(n => Math.abs(n.distancia) <= CERCA).map(n => `${n.tipo} ${n.ticker}`).sort();
  const vigentes = plan.avisos.filter(x => x.nivel !== 'info').map(x => x.id).sort();
  const rojos = plan.semaforos.filter(s => s.estado === 'rojo').map(s => s.clave);
  // Volvió a verde: estaba en rojo en la revisión anterior y hoy hay dato (sin dato no se concluye nada)
  const verdes = plan.semaforos.filter(s => s.estado === 'verde' && estado?.rojos.includes(s.clave));
  const motivos: string[] = [];
  if (forzar) motivos.push('lo pediste');
  if (!estado) motivos.push('es la primera revisión');
  if (aporteNuevo) motivos.push('empezó el mes: esto compras con tu aporte');
  if (hechos.length) motivos.push('una de tus empresas presentó un hecho relevante');
  if (estado) {
    if (firma.join('|') !== estado.firma.join('|')) motivos.push('cambió el plan');
    if (cerca.some(c => !estado.cerca.includes(c))) motivos.push('un precio se acercó a un nivel que cambia la decisión');
    const nuevos = plan.avisos.filter(x => x.nivel !== 'info' && !estado.avisos.includes(x.id));
    if (nuevos.some(x => x.id.startsWith('rojo:'))) motivos.push('un mercado pasó a zona roja');
    if (nuevos.some(x => x.id.startsWith('cerca:'))) motivos.push('un mercado se acercó a la zona roja');
    if (nuevos.some(x => x.tipo === 'ganancia')) motivos.push('una posición devolvió buena parte de su ganancia');
    if (verdes.length) motivos.push('un mercado volvió a verde');
    const primeraDeLaSemana = !estado.ultimoAviso || diasEntre(estado.ultimoAviso, hoy) >= 7
      || (new Date(`${hoy}T12:00:00Z`).getUTCDay() < new Date(`${estado.ultimoAviso}T12:00:00Z`).getUTCDay() && diasEntre(estado.ultimoAviso, hoy) > 0);
    if (primeraDeLaSemana) motivos.push('es el resumen de la semana');
  }
  const avisar = motivos.length > 0;
  // Sin el dólar observado se usa el del mercado (Yahoo), que basta para pesar la cartera: no vale un aviso diario
  const avisos = report.avisosDatos.filter(a => !/dólar observado/i.test(a));
  const texto = mensaje(asesor, motivos.length ? motivos : ['sin novedades'], avisos, verdes, hoy, fmtPrecio, fmtNivel, hechos);

  if (prueba) {
    decir(texto.replace(/<\/?[bi]>/g, ''));
    decir(`\n[prueba] ${avisar ? `Avisaría (${motivos.join(', ')})` : 'No avisaría'}; no se envió ni guardó nada.`);
    return;
  }
  // Primero el celular; Telegram solo si no llegó a ninguno (o si pediste ambos con AGENTE_TELEGRAM=siempre)
  let celular = { enviados: 0, detalle: '' };
  let porTelegram = false;
  if (avisar) {
    celular = await enviarCelular(db, usuario, asesor, motivos, hechos).catch(() => ({ enviados: 0, detalle: 'falló el envío' }));
    porTelegram = celular.enviados === 0 || (process.env.AGENTE_TELEGRAM ?? '').trim() === 'siempre';
    if (porTelegram) await enviarTelegram(texto);
  }
  if (hayTabla) {
    const datos = {
      fecha: hoy, firma, cerca, avisos: vigentes, ultimoAviso: avisar ? hoy : estado?.ultimoAviso ?? null,
      mesAporte: avisar && asesor.aporte?.ordenes.length ? mes : estado?.mesAporte ?? null,
      // Los enlaces avisados (los de más de 60 días ya no vuelven en la consulta de 45)
      eventosVistos: [...new Set([...(avisar ? hechos.map(e => e.url) : []), ...(estado?.eventosVistos ?? [])])].slice(0, 300),
      eventos: eventos ? { fecha: hoy, porTicker: eventos } : null,
      // Un mercado sin dato hoy conserva el color de ayer: así no parece que "volvió a verde" por un dato que faltó
      rojos: [...new Set([...rojos, ...(estado?.rojos ?? []).filter(c => !plan.semaforos.some(s => s.clave === c))])].sort(),
      plan: {
        valorCLP: plan.valorCLP, metaChile: plan.metaChile, antes: plan.antes, despues: plan.despues,
        ventas: plan.ventas, compras: plan.compras, niveles: plan.niveles, semaforos: plan.semaforos, refugioCLP: plan.refugioCLP,
      },
      veredicto: asesor.veredicto,
      aporte: asesor.aporte ? { montoCLP: asesor.aporte.montoCLP, ordenes: asesor.aporte.ordenes } : null,
    };
    const { error } = await db.from('agente_cartera').upsert({ user_id: usuario, datos, actualizado: new Date().toISOString() });
    if (error) throw new Error(`No se pudo guardar el estado del agente: ${error.message}`);
  }
  decir(`Agente de cartera: ${asesor.aporte?.ordenes.length ?? 0} compras del aporte, ${plan.ventas.length} ventas, ${plan.compras.length} compras, ${plan.niveles.length} niveles vigilados. `
    + (avisar ? `Aviso enviado (${motivos.join(', ')}): al celular ${celular.detalle}${porTelegram ? '; también por Telegram' : ''}.` : 'Sin novedades: no se avisó.')
    + (hayTabla ? '' : ' Falta la tabla agente_cartera (supabase/agente_cartera.sql): sin ella avisa en cada corrida.'));
}

main().catch(e => {
  decir(`El agente falló: ${sinPrivados(e instanceof Error ? e.message : String(e))}`);
  process.exit(1);
});
