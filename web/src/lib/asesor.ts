import { buildAdvisorReport, fmtMoney, type Accion, type AdvisorReport, type HoldingInput } from './advisor';
import { NUCLEO, planAporte, type PlanAporte } from './aporte';
import { NOMBRE_MERCADO, semaforosQueFaltan } from './avisos';
import { hoyEnChile } from './ejecucion';
import { avisoSinRevisar, frenosPorEventos, type EventoSec } from './eventos';
import { ideasDelBot, type IdeasDelBot } from './ideas';
import { liveQuotes } from './marketData';
import { metaChileDe, nivelDe, proteccionDe, type NivelRiesgo, type PerfilInversionista } from './perfil';
import { COSTO_REINVERSION, netoDeVentas, oportunidadesDelBot, plataNuevaDe, planRebalanceo, type PlanRebalanceo } from './rebalanceo';

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

// El aporte del mes: cuánto ya se invirtió (las compras registradas este mes) y cuánto falta
export interface AporteDelMes {
  mes: string; // YYYY-MM, en hora de Chile
  mensualCLP: number;
  invertidoCLP: number;
  pendienteCLP: number;
}

export interface AsesorDelDia {
  generado: string;
  nivel: NivelRiesgo | null;
  aporteMensual: number | null;
  aporteDelMes: AporteDelMes | null;
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

/** Lo que ya compraste este mes, en pesos: los lotes de tu cartera con fecha de compra en `mes` (YYYY-MM). */
export function compradoEnElMes(items: Pick<HoldingInput, 'cantidad' | 'precio_compra' | 'moneda' | 'purchase_date'>[], mes: string, usdClp: number): number {
  return items.filter(i => (i.purchase_date ?? '').slice(0, 7) === mes)
    .reduce((s, i) => s + i.cantidad * i.precio_compra * (i.moneda === 'USD' ? usdClp : 1), 0);
}

/** Cuánto del aporte mensual falta por invertir. Si lo que falta no alcanza para una orden, el mes está hecho. */
export function aporteDelMes(mensualCLP: number | null | undefined, items: Parameters<typeof compradoEnElMes>[0], mes: string, usdClp: number): AporteDelMes | null {
  if (!mensualCLP || mensualCLP <= 0) return null;
  const invertidoCLP = Math.round(compradoEnElMes(items, mes, usdClp));
  const falta = mensualCLP - invertidoCLP;
  return { mes, mensualCLP, invertidoCLP, pendienteCLP: falta >= MIN_PENDIENTE ? falta : 0 };
}
const MIN_PENDIENTE = 10000; // bajo $10.000 no hay orden que valga la comisión

export function veredictoDe(aporte: PlanAporte | null, plan: PlanRebalanceo, mes: AporteDelMes | null = null): Veredicto {
  const ventas = plan.ventas;
  const compras = aporte?.ordenes.length ? aporte.ordenes : plan.compras;
  const invierteCLP = compras.reduce((s, o) => s + o.montoCLP, 0);
  const pasos: Paso[] = [
    ...ventas.map(o => ({ lado: 'VENDER' as const, ticker: o.ticker, nombre: o.nombre, moneda: o.moneda, cantidad: o.cantidad, todo: o.todo, precio: o.precio, limite: o.limite, montoCLP: o.montoCLP, motivo: o.motivo })),
    ...compras.map(o => ({ lado: 'COMPRAR' as const, ticker: o.ticker, nombre: o.nombre, moneda: o.moneda, cantidad: o.cantidad, todo: false, precio: o.precio, limite: o.limite, montoCLP: o.montoCLP, motivo: o.motivo })),
  ];
  if (!pasos.length && aporte && aporte.montoCLP > 0) {
    // Había plata para invertir y no salió ninguna orden: es un problema de datos, no un "no hagas nada"
    const causa = aporte.descartadas[0];
    return {
      accion: 'MANTENER', titulo: 'Hoy no pude calcular tu compra', pasos,
      detalle: `Tienes ${fmtMoney(aporte.montoCLP, 'CLP')} para invertir, pero no hay una compra que pueda recomendar con los datos de hoy`
        + `${causa ? ` (${sinSufijo(causa.ticker)}: ${minuscula(causa.motivo)})` : ''}. No es una señal de esperar: vuelve a revisar más tarde.`,
    };
  }
  if (!pasos.length) {
    return {
      accion: 'MANTENER', titulo: 'No hagas nada hoy', pasos,
      detalle: `${plan.sinVender ?? 'Nada pasa un límite ni tiene una señal de venta con evidencia.'} ${mes && mes.pendienteCLP <= 0
        ? `Tu aporte de este mes ya está invertido: registraste compras por ${fmtMoney(mes.invertidoCLP, 'CLP')} (tu aporte es de ${fmtMoney(mes.mensualCLP, 'CLP')}). El próximo mes te digo qué comprar; si quieres invertir más ahora, escribe el monto.`
        : mes ? 'Con tu aporte de este mes no salió ninguna compra hoy.'
          : 'Indica tu aporte mensual en tu perfil y cada mes te digo exactamente qué comprar.'}`,
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
  if (ventas.length && compras.length) porque.push(`Las compras ya descuentan ${String(COSTO_REINVERSION * 100).replace('.', ',')}% de lo vendido (comisiones, cambio y margen de las órdenes). Si la plata de la venta demora, parte con lo que te alcance.`);
  // El aporte del mes no se anuncia dos veces: lo ya comprado se descuenta, y se dice
  if (mes && mes.invertidoCLP > 0 && compras.length) {
    porque.push(mes.pendienteCLP > 0
      ? `Este mes ya registraste compras por ${fmtMoney(mes.invertidoCLP, 'CLP')}: esto es lo que falta de tu aporte de ${fmtMoney(mes.mensualCLP, 'CLP')}.`
      : `Tu aporte de este mes ya está invertido (${fmtMoney(mes.invertidoCLP, 'CLP')} en compras registradas): estas compras son solo con lo que vendes.`);
  } else if (mes && mes.pendienteCLP <= 0 && !compras.length) {
    porque.push(`Tu aporte de este mes ya está invertido (${fmtMoney(mes.invertidoCLP, 'CLP')} en compras registradas).`);
  }

  const monto = fmtMoney(invierteCLP, 'CLP');
  const vendes = lista(ventas.map(o => `${sinSufijo(o.ticker)}${o.todo ? '' : ' (parte)'}`));
  if (ventas.length && compras.length) return { accion: 'VENDER Y COMPRAR', titulo: `Vende ${vendes} y compra ${nombres(compras)} con ${monto}`, detalle: porque.join(' '), pasos };
  if (ventas.length) return { accion: 'VENDER', titulo: `Vende ${vendes}`, detalle: porque.join(' '), pasos };
  return { accion: 'COMPRAR', titulo: `Compra ${nombres(compras)} con ${monto}`, detalle: porque.join(' '), pasos };
}

/** Precios al día de las ideas del Top y de los índices núcleo que no están en la cartera (los de la cartera ya los
 *  trae el informe). */
export async function preciosIdeas(ideas: IdeasDelBot | null, report: AdvisorReport) {
  const precios = new Map<string, { price: number; name?: string; time?: string }>();
  // Con la fecha real de cada precio: uno que no es de la última sesión no sirve para calcular una compra (lib/aporte.ts)
  for (const a of [...report.posiciones, ...report.candidatos]) {
    if (a.conDatos && a.precio > 0 && a.fechaPrecio) precios.set(a.ticker, { price: a.precio, name: a.nombre, time: a.fechaPrecio });
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
  { montoCLP, fraccionar = true, eventos = null, eventosSinRevisar = [], hoy = hoyEnChile() }: {
    montoCLP?: number | null; fraccionar?: boolean; eventos?: Record<string, EventoSec[]> | null;
    eventosSinRevisar?: string[]; // empresas cuyos hechos relevantes no se pudieron consultar hoy
    hoy?: string; // YYYY-MM-DD en Chile: el mes del aporte
  } = {},
): Promise<{ asesor: AsesorDelDia; report: AdvisorReport }> {
  const nivel = nivelDe(perfil);
  let ideasFallaron = false;
  const [ideas, oportunidades] = await Promise.all([
    ideasDelBot().catch(() => { ideasFallaron = true; return null; }),
    oportunidadesDelBot().catch(() => [] as string[]),
  ]);
  const { modelo, ...report } = await buildAdvisorReport(items, oportunidades, perfil);
  // Sin el Top la compra sale 100% al índice: se dice, para que no parezca la recomendación normal
  if (nivel && !ideas) {
    report.avisosDatos.push(ideasFallaron
      ? 'No se pudieron leer las ideas del Top: la compra de hoy va solo al índice. Revisa de nuevo más tarde.'
      : 'El Top no está al día (el escaneo diario no ha corrido): la compra de hoy va solo al índice.');
  }
  const precios = await preciosIdeas(ideas, report);
  const metaChile = metaChileDe(perfil);
  const proteccion = proteccionDe(perfil);
  const semaforos = report.mercado?.semaforos ?? [];
  const frenos = frenosPorEventos(eventos, report.generado.slice(0, 10));
  if (eventosSinRevisar.length) report.avisosDatos.push(avisoSinRevisar(eventosSinRevisar));
  // Con protección elegida, un semáforo sin dato no es "verde": ahí no se compra, y se dice
  const sinSemaforo = proteccion !== 'avisar' ? semaforosQueFaltan(semaforos) : [];
  if (sinSemaforo.length) {
    report.avisosDatos.push(`Hoy no hay dato del semáforo de ${sinSemaforo.map(c => NOMBRE_MERCADO[c]).join(' ni de ')}: con la protección que elegiste no se compra ahí hasta tenerlo, y no se vende por protección sin ese dato.`);
  }
  // El aporte del mes se recomienda una vez: lo que ya compraste este mes (lotes con fecha de este mes) se descuenta.
  // Un monto distinto al aporte mensual es plata que el usuario escribió a mano, y se usa tal cual
  const delMes = aporteDelMes(perfil?.aporteMensual, items, hoy.slice(0, 7), report.usdClp);
  const esElAporte = montoCLP === null || montoCLP === undefined || (!!delMes && montoCLP === delMes.mensualCLP);
  const monto = esElAporte ? delMes?.pendienteCLP ?? 0 : montoCLP ?? 0;
  // Sin perfil no hay aporte: lo vendido lo reinvierte el rebalanceo. Con perfil se invierte junto con el aporte, en una
  // sola lista de compras, sobre la cartera que queda después de vender (no compra en Chile mientras se está reduciendo)
  const rebalanceo = planRebalanceo(report, modelo, {
    metaChile, fraccionar, proteccion, nivel, ideas, precios, frenos, plataNueva: plataNuevaDe(perfil?.aporteMensual, monto), reinvertir: !nivel,
  });
  const disponible = monto + (nivel ? netoDeVentas(rebalanceo.ventasCLP - rebalanceo.refugioCLP) : 0);
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
      aporteDelMes: esElAporte ? delMes : null,
      veredicto: veredictoDe(aporte, rebalanceo, esElAporte ? delMes : null),
      aporte, rebalanceo, ideas,
      frenos: [...frenos].map(([ticker, motivo]) => ({ ticker, motivo })),
    },
    report,
  };
}
