/**
 * Agente de cartera: cada mañana hábil revisa la cartera real guardada en la app (mi_portafolio), calcula el
 * rebalanceo y los precios que cambian la decisión con las mismas reglas de la web (src/lib/rebalanceo.ts) y avisa
 * por Telegram solo cuando hay algo que hacer o mirar:
 *   - cambió el plan (aparece o desaparece una venta o una compra),
 *   - un precio quedó a menos de 3% de un nivel que cambia la decisión,
 *   - el primer día hábil de la semana (o si pasó una semana sin avisos), con el resumen,
 *   - con --forzar, siempre.
 * Lo avisado se recuerda en la tabla agente_cartera (supabase/agente_cartera.sql), que solo ve su dueño.
 *
 * El repositorio es público y los registros de GitHub Actions también: el agente no imprime nada de la cartera,
 * solo cuántas órdenes hay y si avisó.
 *
 *   npx tsx scripts/agente-cartera.ts            # lo que corre GitHub Actions (agente_cartera.yml)
 *   npx tsx scripts/agente-cartera.ts --forzar   # avisa aunque nada haya cambiado
 *   npx tsx scripts/agente-cartera.ts --prueba   # no envía ni guarda: muestra el mensaje (solo en tu computador)
 *
 * Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, TELEGRAM_TOKEN y TELEGRAM_CHAT_ID; si hay carteras de más de un
 * usuario, AGENTE_USUARIO (el user_id de Supabase del dueño). En tu computador las toma del .env de la raíz.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PlanRebalanceo } from '../src/lib/rebalanceo';

const APP = 'https://quantum-trader-app.vercel.app';
const CERCA = 0.03;
const MAX_MENSAJE = 4000; // Telegram acepta 4096 caracteres
const args = new Set(process.argv.slice(2));
const prueba = args.has('--prueba');
const forzar = args.has('--forzar');

// Solo lo que imprime el agente llega al registro: las librerías avisan con el ticker cuando falla un dato
const decir = console.log.bind(console);
for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) console[k] = () => {};

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
  ultimoAviso: string | null;
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
    estado: d?.fecha ? { fecha: d.fecha, firma: d.firma ?? [], cerca: d.cerca ?? [], ultimoAviso: d.ultimoAviso ?? null } : null,
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

function mensaje(plan: PlanRebalanceo, motivos: string[], hoy: string, fmtPrecio: (n: number, m: 'USD' | 'CLP') => string): string {
  const cantidad = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 4 });
  const [a, m, d] = hoy.split('-');
  const l: string[] = [`<b>🧭 Tu cartera · ${d}-${m}-${a}</b>`];
  const sector = plan.antes.sector;
  l.push(`Valor ${pesos(plan.valorCLP)} · Chile ${pct0(plan.antes.chile)} (meta hasta ${pct0(plan.metaChile)})${sector ? ` · ${esc(sector.nombre)} ${pct0(sector.peso)} (máx. 35%)` : ''}`);

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
      l.push(`   <i>${esc(o.motivo.replace(/^Señal AUMENTAR\.\s*/, '').split(/[:.]/)[0])} · peso ${pct1(o.pesoAntes)} → ${pct1(o.pesoDespues)}</i>`);
    }
  }
  if (plan.ventas.length || plan.compras.length) {
    l.push('', `Después: Chile ${pct0(plan.despues.chile)}${plan.despues.sector ? ` · ${esc(plan.despues.sector.nombre)} ${pct0(plan.despues.sector.peso)}` : ''}. Primero vende y después compra, con órdenes límite.`);
  } else {
    l.push('', '✅ Nada que vender ni comprar: tu cartera está dentro de sus límites y nada tiene una señal de venta con evidencia.');
  }
  const mantener = plan.posturas.filter(p => p.accion === 'MANTENER').length;
  if (mantener) l.push(`⚪ Mantener: ${mantener} posiciones.`);

  if (plan.niveles.length) {
    l.push('', '<b>🎯 Precios que vigilo</b>');
    for (const n of plan.niveles.slice(0, 6)) l.push(`• <b>${sinSufijo(n.ticker)}</b>: ${esc(corto(n.texto, 200))}`);
  }
  l.push('', `<i>Te aviso porque: ${motivos.join(', ')}.</i>`, `Detalle: ${APP} → Calculadora → Rebalancear`);

  let texto = l.join('\n');
  if (texto.length > MAX_MENSAJE) texto = `${texto.slice(0, texto.lastIndexOf('\n', MAX_MENSAJE - 60))}\n…\nDetalle completo: ${APP}`;
  return texto;
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
  const [{ buildAdvisorReport }, { fmtPrecio, oportunidadesDelBot, planRebalanceo }, { metaChileDe, parsePerfil }, { parsePortfolioItems }] = await Promise.all([
    import('../src/lib/advisor'), import('../src/lib/rebalanceo'), import('../src/lib/perfil'), import('../src/lib/validation'),
  ]);
  const db = createClient(url, clave, { auth: { persistSession: false } });

  const usuario = await dueno(db);
  const [cartera, perfilFila, { estado, hayTabla }] = await Promise.all([
    db.from('mi_portafolio').select('ticker, cantidad, precio_compra, moneda, purchase_date').eq('user_id', usuario),
    db.from('perfil_inversionista').select('datos').eq('user_id', usuario).maybeSingle(),
    leerEstado(db, usuario),
  ]);
  if (cartera.error) throw new Error(`No se pudo leer la cartera: ${cartera.error.message}`);
  const parsed = parsePortfolioItems(cartera.data);
  if ('error' in parsed) throw new Error(`La cartera guardada no es válida (${parsed.error.split(':')[0]}).`);
  const perfil = parsePerfil(perfilFila.data?.datos);

  const oportunidades = await oportunidadesDelBot().catch(() => []);
  const { modelo, ...report } = await buildAdvisorReport(parsed.items, oportunidades, perfil);
  const plan = planRebalanceo(report, modelo, { metaChile: metaChileDe(perfil), fraccionar: true });

  // ¿Hay algo que avisar?
  const hoy = hoyEnChile();
  const firma = [...plan.ventas, ...plan.compras].map(o => `${o.lado} ${o.ticker}`).sort();
  const cerca = plan.niveles.filter(n => Math.abs(n.distancia) <= CERCA).map(n => `${n.tipo} ${n.ticker}`).sort();
  const motivos: string[] = [];
  if (forzar) motivos.push('lo pediste');
  if (!estado) motivos.push('es la primera revisión');
  else {
    if (firma.join('|') !== estado.firma.join('|')) motivos.push('cambió el plan');
    if (cerca.some(c => !estado.cerca.includes(c))) motivos.push('un precio se acercó a un nivel que cambia la decisión');
    const primeraDeLaSemana = !estado.ultimoAviso || diasEntre(estado.ultimoAviso, hoy) >= 7
      || (new Date(`${hoy}T12:00:00Z`).getUTCDay() < new Date(`${estado.ultimoAviso}T12:00:00Z`).getUTCDay() && diasEntre(estado.ultimoAviso, hoy) > 0);
    if (primeraDeLaSemana) motivos.push('es el resumen de la semana');
  }
  const avisar = motivos.length > 0;
  const texto = mensaje(plan, motivos.length ? motivos : ['sin novedades'], hoy, fmtPrecio);

  if (prueba) {
    decir(texto.replace(/<\/?[bi]>/g, ''));
    decir(`\n[prueba] ${avisar ? `Avisaría (${motivos.join(', ')})` : 'No avisaría'}; no se envió ni guardó nada.`);
    return;
  }
  if (avisar) await enviarTelegram(texto);
  if (hayTabla) {
    const datos = {
      fecha: hoy, firma, cerca, ultimoAviso: avisar ? hoy : estado?.ultimoAviso ?? null,
      plan: {
        valorCLP: plan.valorCLP, metaChile: plan.metaChile, antes: plan.antes, despues: plan.despues,
        ventas: plan.ventas, compras: plan.compras, niveles: plan.niveles,
      },
    };
    const { error } = await db.from('agente_cartera').upsert({ user_id: usuario, datos, actualizado: new Date().toISOString() });
    if (error) throw new Error(`No se pudo guardar el estado del agente: ${error.message}`);
  }
  decir(`Agente de cartera: ${plan.ventas.length} ventas, ${plan.compras.length} compras, ${plan.niveles.length} niveles vigilados. `
    + (avisar ? `Aviso enviado por Telegram (${motivos.join(', ')}).` : 'Sin novedades: no se avisó.')
    + (hayTabla ? '' : ' Falta la tabla agente_cartera (supabase/agente_cartera.sql): sin ella avisa en cada corrida.'));
}

main().catch(e => {
  decir(`El agente falló: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
