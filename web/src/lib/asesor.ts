import { buildAdvisorReport, fmtMoney, type Accion, type AdvisorReport, type HoldingInput } from './advisor';
import { NUCLEO, planAporte, type PlanAporte } from './aporte';
import { ideasDelBot, type IdeasDelBot } from './ideas';
import { liveQuotes } from './marketData';
import { metaChileDe, nivelDe, proteccionDe, type NivelRiesgo, type PerfilInversionista } from './perfil';
import { oportunidadesDelBot, planRebalanceo, type PlanRebalanceo } from './rebalanceo';

// El asesor del día: lo que conviene hacer hoy con tu cartera, en un solo cálculo que comparten la pestaña Asesor
// (api/asesor), el agente que avisa al celular (scripts/agente-cartera.ts) y el chat. Junta:
//   - el aporte del mes (lib/aporte.ts): núcleo + Top medido, según tu perfil,
//   - el rebalanceo (lib/rebalanceo.ts): lo que se vende por evidencia o por pasar un límite, y cómo se reinvierte,
//   - un veredicto en una línea, para leerlo sin abrir nada más.

export interface Veredicto {
  accion: 'COMPRAR' | 'VENDER Y COMPRAR' | 'VENDER' | 'MANTENER';
  titulo: string;
  detalle: string;
}

export interface AsesorDelDia {
  generado: string;
  nivel: NivelRiesgo | null;
  aporteMensual: number | null;
  veredicto: Veredicto;
  aporte: PlanAporte | null;
  rebalanceo: PlanRebalanceo;
  ideas: IdeasDelBot | null;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const sinSufijo = (t: string) => t.replace(/\.SN$/, '');
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`);

export function veredictoDe(aporte: PlanAporte | null, plan: PlanRebalanceo, hoy: string): Veredicto {
  const mes = MESES[Number(hoy.slice(5, 7)) - 1];
  const ventas = plan.ventas;
  const compraAporte = aporte?.ordenes.length ? aporte : null;
  const vende = ventas.length
    ? `Vende ${lista(ventas.map(o => `${sinSufijo(o.ticker)}${o.todo ? '' : ' (parte)'}`))} (≈${fmtMoney(plan.ventasCLP, 'CLP')}) y reinviértelo en ${lista([...new Set(plan.compras.map(o => sinSufijo(o.ticker)))]) || 'efectivo'}.`
    : '';
  if (compraAporte) {
    return {
      accion: ventas.length ? 'VENDER Y COMPRAR' : 'COMPRAR',
      titulo: `Invierte tus ${fmtMoney(compraAporte.montoCLP, 'CLP')} de ${mes}`,
      detalle: `${compraAporte.resumen}${vende ? ` Además: ${vende}` : ''}`,
    };
  }
  if (ventas.length) return { accion: plan.compras.length ? 'VENDER Y COMPRAR' : 'VENDER', titulo: 'Ajusta tu cartera', detalle: vende };
  return {
    accion: 'MANTENER',
    titulo: 'Tu cartera está en orden',
    detalle: 'Nada pasa un límite ni tiene una señal de venta con evidencia. Indica tu aporte mensual en tu perfil y cada mes te digo exactamente qué comprar.',
  };
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
  { montoCLP, fraccionar = true }: { montoCLP?: number | null; fraccionar?: boolean } = {},
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
  const rebalanceo = planRebalanceo(report, modelo, { metaChile, fraccionar, proteccion, nivel, ideas, precios });

  // El aporte se calcula sobre la cartera que deja el rebalanceo: así no repite las mismas ideas del Top y no compra en
  // Chile mientras se está reduciendo. Si no haces el rebalanceo, sus compras siguen siendo del Top.
  const monto = montoCLP ?? perfil?.aporteMensual ?? 0;
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
  const aporte = monto > 0 && nivel ? planAporte({
    montoCLP: monto, usdClp: report.usdClp, valorCLP: V + rebalanceo.comprasCLP - rebalanceo.ventasCLP,
    chileCLP: Math.max(0, chileCLP), posiciones: [...tras.values()],
    sectores: report.exposicion.sectores, ideas, precios, nivel, metaChile, semaforos, proteccion, fraccionar,
    // Lo que el rebalanceo vende no se recompra con el aporte
    bloqueados: new Map(rebalanceo.ventas.map(o => [o.ticker, 'Se vende en el rebalanceo de hoy.'])),
    sinChile: rebalanceo.ventas.some(o => o.moneda === 'CLP') && rebalanceo.antes.chile > metaChile
      ? `Chile es ${Math.round(rebalanceo.antes.chile * 100)}% de tu patrimonio y tu máximo es ${Math.round(metaChile * 100)}%: el aporte va completo a EE.UU.` : null,
    hoy: report.generado.slice(0, 10),
  }) : null;

  return {
    asesor: {
      generado: report.generado, nivel, aporteMensual: perfil?.aporteMensual ?? null,
      veredicto: veredictoDe(aporte, rebalanceo, report.generado.slice(0, 10)),
      aporte, rebalanceo, ideas,
    },
    report,
  };
}
