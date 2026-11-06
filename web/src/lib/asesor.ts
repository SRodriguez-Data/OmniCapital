import { buildAdvisorReport, fmtMoney, type Accion, type AdvisorReport, type HoldingInput } from './advisor';
import { NUCLEO, planAporte, type PlanAporte } from './aporte';
import { frenosPorEventos, type EventoSec } from './eventos';
import { ideasDelBot, type IdeasDelBot } from './ideas';
import { liveQuotes } from './marketData';
import { metaChileDe, nivelDe, proteccionDe, type NivelRiesgo, type PerfilInversionista } from './perfil';
import { oportunidadesDelBot, plataNuevaDe, planRebalanceo, type PlanRebalanceo } from './rebalanceo';

// El asesor del día: lo que conviene hacer hoy con tu cartera, en un solo cálculo que comparten la pestaña Asesor
// (api/asesor), el agente que avisa al celular (scripts/agente-cartera.ts) y el chat. Junta:
//   - las ventas (lib/rebalanceo.ts): solo por evidencia o por un límite que tu plata nueva no corrige sola,
//   - las compras (lib/aporte.ts): tu aporte y lo vendido, juntos, en núcleo + Top medido según tu perfil,
//   - un veredicto: una sola decisión con sus pasos numerados, como la daría un profesional. Sin alternativas.

export interface Paso {
  lado: 'VENDER' | 'COMPRAR';
  ticker: string;
  nombre?: string;
  moneda: 'USD' | 'CLP';
  cantidad: number;
  todo: boolean;
  precio: number;
  limite: number;
  montoCLP: number;
  motivo: string;
}

export interface Veredicto {
  accion: 'COMPRAR' | 'VENDER Y COMPRAR' | 'VENDER' | 'MANTENER';
  titulo: string;
  detalle: string; // por qué, en pocas frases
  pasos: Paso[]; // en el orden en que se ejecutan
}

export interface AsesorDelDia {
  generado: string;
  nivel: NivelRiesgo | null;
  aporteMensual: number | null;
  veredicto: Veredicto;
  aporte: PlanAporte | null;
  rebalanceo: PlanRebalanceo;
  ideas: IdeasDelBot | null;
  frenos: { ticker: string; motivo: string }[]; // empresas que no se compran por un hecho relevante grave
}

const sinSufijo = (t: string) => t.replace(/\.SN$/, '');
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);
const nombres = (os: { ticker: string }[]) => lista([...new Set(os.map(o => sinSufijo(o.ticker)))]);
const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function veredictoDe(aporte: PlanAporte | null, plan: PlanRebalanceo): Veredicto {
  const ventas = plan.ventas;
  const compras = aporte?.ordenes.length ? aporte.ordenes : plan.compras;
  const invierteCLP = compras.reduce((s, o) => s + o.montoCLP, 0);
  const pasos: Paso[] = [
    ...ventas.map(o => ({ lado: 'VENDER' as const, ticker: o.ticker, nombre: o.nombre, moneda: o.moneda, cantidad: o.cantidad, todo: o.todo, precio: o.precio, limite: o.limite, montoCLP: o.montoCLP, motivo: o.motivo })),
    ...compras.map(o => ({ lado: 'COMPRAR' as const, ticker: o.ticker, nombre: o.nombre, moneda: o.moneda, cantidad: o.cantidad, todo: false, precio: o.precio, limite: o.limite, montoCLP: o.montoCLP, motivo: o.motivo })),
  ];
  if (!pasos.length) {
    return {
      accion: 'MANTENER', titulo: 'No hagas nada hoy', pasos,
      detalle: `${plan.sinVender ?? 'Nada pasa un límite ni tiene una señal de venta con evidencia.'} Indica tu aporte mensual en tu perfil y cada mes te digo exactamente qué comprar.`,
    };
  }

  const nucleo = aporte?.ordenes.filter(o => o.papel === 'nucleo') ?? [];
  const top = aporte?.ordenes.filter(o => o.papel === 'top') ?? [];
  const porque: string[] = [];
  if (nucleo.length && top.length) porque.push(`${nombres(nucleo)} es el mercado completo; ${nombres(top)} ${top.length > 1 ? 'son las primeras' : 'es la primera'} del Top que menos tienes.`);
  else if (nucleo.length) porque.push(`${nombres(nucleo)} es el mercado completo: con este monto es la mejor compra.`);
  else if (top.length) porque.push(`${nombres(top)} ${top.length > 1 ? 'son las primeras' : 'es la primera'} del Top que menos tienes.`);
  for (const o of ventas) porque.push(`${sinSufijo(o.ticker)} se vende: ${minuscula(o.motivo.replace(/^Con evidencia en contra:\s*/i, ''))}`);
  if (plan.sinVender) porque.push(plan.sinVender);
  if (aporte?.ordenes.some(o => o.enRojo)) porque.push('Su mercado está en rojo: se compra igual, más barato.');
  if (ventas.length && compras.length) porque.push('Si la plata de la venta demora, parte con lo que te alcance.');

  const monto = fmtMoney(invierteCLP, 'CLP');
  if (ventas.length && compras.length) return { accion: 'VENDER Y COMPRAR', titulo: `Vende ${nombres(ventas)} y compra ${nombres(compras)} con ${monto}`, detalle: porque.join(' '), pasos };
  if (ventas.length) return { accion: 'VENDER', titulo: `Vende ${nombres(ventas)}`, detalle: porque.join(' '), pasos };
  return { accion: 'COMPRAR', titulo: `Compra ${nombres(compras)} con ${monto}`, detalle: porque.join(' '), pasos };
}

/** Precios al día de las ideas del Top y de los índices núcleo que no están en la cartera (los de la cartera ya los
 *  trae el informe). */
export async function preciosIdeas(ideas: IdeasDelBot | null, report: AdvisorReport) {
  const precios = new Map<string, { price: number; name?: string; time?: string }>();
  const hoy = report.generado.slice(0, 10);
  for (const a of [...report.posiciones, ...report.candidatos]) {
    if (a.conDatos && a.precio > 0) precios.set(a.ticker, { price: a.precio, name: a.nombre, time: hoy });
  }
  const faltan = [...new Set([...(ideas?.us ?? []), ...(ideas?.cl ?? [])].map(i => i.ticker)
    .concat(Object.values(NUCLEO).map(n => n.ticker)))].filter(t => !precios.has(t));
  const q = await liveQuotes(faltan);
  for (const [t, v] of q) precios.set(t, { price: v.price, name: v.name, time: v.time });
  return precios;
}

export async function asesorDelDia(
  items: HoldingInput[],
  perfil: PerfilInversionista | null,
  { montoCLP, fraccionar = true, eventos = null }: { montoCLP?: number | null; fraccionar?: boolean; eventos?: Record<string, EventoSec[]> | null } = {},
): Promise<{ asesor: AsesorDelDia; report: AdvisorReport }> {
  const nivel = nivelDe(perfil);
  const [ideas, oportunidades] = await Promise.all([
    ideasDelBot().catch(() => null),
    oportunidadesDelBot().catch(() => [] as string[]),
  ]);
  const { modelo, ...report } = await buildAdvisorReport(items, oportunidades, perfil);
  const precios = await preciosIdeas(ideas, report);
  const metaChile = metaChileDe(perfil);
  const proteccion = proteccionDe(perfil);
  const semaforos = report.mercado?.semaforos ?? [];
  const frenos = frenosPorEventos(eventos, report.generado.slice(0, 10));
  const monto = montoCLP ?? perfil?.aporteMensual ?? 0;
  // Sin perfil no hay aporte: lo vendido lo reinvierte el rebalanceo. Con perfil se invierte junto con el aporte, en una
  // sola lista de compras, sobre la cartera que queda después de vender (no compra en Chile mientras se está reduciendo)
  const rebalanceo = planRebalanceo(report, modelo, {
    metaChile, fraccionar, proteccion, nivel, ideas, precios, frenos, plataNueva: plataNuevaDe(perfil?.aporteMensual, monto), reinvertir: !nivel,
  });
  const disponible = monto + (nivel ? rebalanceo.ventasCLP - rebalanceo.refugioCLP : 0);
  const V = report.resumen.valorCLP;
  type Tenencia = { ticker: string; valorCLP: number; accion?: Accion; pesoEfectivo?: number };
  const tras = new Map<string, Tenencia>(report.posiciones.map(a => [a.ticker, { ticker: a.ticker, valorCLP: a.valorCLP, accion: a.accion, pesoEfectivo: a.pesoEfectivo }]));
  for (const o of rebalanceo.ventas) {
    const x = tras.get(o.ticker);
    if (x) x.valorCLP = Math.max(0, x.valorCLP - o.montoCLP);
  }
  for (const o of rebalanceo.compras) {
    const x = tras.get(o.ticker) ?? { ticker: o.ticker, valorCLP: 0 };
    x.valorCLP += o.montoCLP;
    tras.set(o.ticker, x);
  }
  const enCLP = (os: { moneda: 'USD' | 'CLP'; montoCLP: number }[]) => os.filter(o => o.moneda === 'CLP').reduce((s, o) => s + o.montoCLP, 0);
  const chileCLP = (report.exposicion.regiones.find(r => r.nombre === 'Chile')?.peso ?? 0) * V - enCLP(rebalanceo.ventas) + enCLP(rebalanceo.compras);
  const aporte = disponible > 0 && nivel ? planAporte({
    montoCLP: disponible, usdClp: report.usdClp, valorCLP: V + rebalanceo.comprasCLP - rebalanceo.ventasCLP,
    chileCLP: Math.max(0, chileCLP), posiciones: [...tras.values()],
    sectores: report.exposicion.sectores, ideas, precios, nivel, metaChile, semaforos, proteccion, fraccionar,
    // Lo que el rebalanceo vende no se recompra con el aporte
    bloqueados: new Map([...frenos, ...rebalanceo.ventas.map(o => [o.ticker, 'Se vende en el rebalanceo de hoy.'] as [string, string])]),
    sinChile: rebalanceo.ventas.some(o => o.moneda === 'CLP') && rebalanceo.antes.chile > metaChile
      ? `Chile es ${Math.round(rebalanceo.antes.chile * 100)}% de tu patrimonio y tu máximo es ${Math.round(metaChile * 100)}%: el aporte va completo a EE.UU.` : null,
    hoy: report.generado.slice(0, 10),
  }) : null;

  return {
    asesor: {
      generado: report.generado, nivel, aporteMensual: perfil?.aporteMensual ?? null,
      veredicto: veredictoDe(aporte, rebalanceo),
      aporte, rebalanceo, ideas,
      frenos: [...frenos].map(([ticker, motivo]) => ({ ticker, motivo })),
    },
    report,
  };
}
