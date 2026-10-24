'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Sparkles } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';
import { NOMBRE_PONDERACION, evidenciaMetodo, sesgosEvidencia, type ClaveMetodo, type Nivel, type Ponderacion } from '@/lib/evidenciaMetodos';
import {
  type Candidato, type Historiales, SECTOR, fechaCorta, lineaHistorial, normalizeYield, pctSigno, textoDeuda, textoPE, textoResultados,
} from './topFormato';

// Top con el método v2 del bot: las acciones que eligen los únicos criterios que, medidos en 10 años, le ganaron
// a su mercado (evidencia.py, METODOS). Cada lista muestra su evidencia y su historial real.

const NIVEL_ESTILO: Record<Nivel, string> = {
  'sólida': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  'débil': 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  'sin evidencia': 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  'en contra': 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};
const tarjeta = 'bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-lg';

function criterio(c: Candidato): string {
  if (typeof c.calidad === 'number') {
    const cierre = c.cierre_fiscal ? ` (año fiscal cerrado el ${fechaCorta(c.cierre_fiscal)})` : '';
    return `Su flujo de caja, descontado lo que paga en acciones, supera su utilidad en ${(c.calidad * 100).toFixed(1)}% de sus activos${cierre}: está entre las mejores de su sector (percentil ${Math.round((c.percentil_sector ?? 0) * 100)}). Ocurre cuando la utilidad viene con caja de verdad, o cuando bajó por castigos contables que no son salida de caja.`;
  }
  if (typeof c.momentum === 'number') return `Subió ${pctSigno(c.momentum)} (con dividendos) entre hace 12 meses y hace 1 mes: de las de mayor alza del IPSA.`;
  return '';
}

const resumenCorto = (c: Candidato) => typeof c.calidad === 'number'
  ? `Caja sobre utilidad: ${pctSigno(c.calidad)} de sus activos`
  : typeof c.momentum === 'number' ? `Alza 12 meses (sin el último): ${pctSigno(c.momentum, 0)}` : '';

const sectorDe = (c: Candidato) => {
  const s = c.sector_gics ?? c.sector;
  return s ? [SECTOR[s] ?? s, c.industria].filter(Boolean).join(' · ') : null;
};

const pctCorto = (x: number) => `${(x * 100).toFixed(1)}%`;

function CajaMetodo({ clave }: { clave: ClaveMetodo }) {
  const e = evidenciaMetodo(clave);
  if (!e) return null;
  const c = e.cartera;
  const el = c ? c.ponderaciones[c.elegida] : null;
  // Las mitades de la cartera usan el mismo corte que las de la medición a 3 meses, que traen sus fechas
  const periodos = e.mitades3m.map(m => `${m.desde.slice(0, 4)}–${m.hasta.slice(0, 4)}`);
  return (
    <div className={`${tarjeta} p-4 text-left space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-zinc-900 dark:text-[#e4e4e7]">{e.nombre}</p>
        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${NIVEL_ESTILO[e.nivel]}`}>evidencia {e.nivel}</span>
      </div>
      {c && el ? (
        <>
          <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] leading-relaxed">
            En {e.anios}, la cartera de las {e.n} elegidas, rebalanceada cada mes y repartida por {NOMBRE_PONDERACION[c.elegida].toLowerCase()},
            rindió {pctSigno(el.exceso_anual)} al año sobre el promedio de su mercado
            {Object.values(el.mitades).length === 2 && ` (${Object.values(el.mitades).map((m, i) => `${periodos[i] ?? (i ? 'después' : 'antes')}: ${pctSigno(m.exceso_anual)}`).join('; ')})`}.
            {` Fuerza estadística t = ${e.t.toFixed(1)}: sobre 2, y ganando en ambas mitades, se considera sólida.`}
          </p>
          <TablaPonderaciones elegida={c.elegida} ponderaciones={c.ponderaciones} />
          {e.variantes.length > 1 && (
            <p className="text-[11px] text-zinc-500 dark:text-[#71717a]">
              Se midieron también {e.variantes.length - 1} variantes del criterio (con filtro de tendencia y ajustadas por riesgo): ninguna le ganó al original, así que se mantiene.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] leading-relaxed">
          En {e.anios}, las {e.n} elegidas de cada mes rindieron {pctSigno(e.exceso3m)} frente a su mercado en los 3 meses siguientes. Fuerza estadística t = {e.t.toFixed(1)}.
        </p>
      )}
    </div>
  );
}

// Teoría de portafolio medida: cada forma de repartir la misma lista, rebalanceada cada mes durante 10 años
function TablaPonderaciones({ elegida, ponderaciones }: { elegida: Ponderacion; ponderaciones: Record<Ponderacion, { retorno_anual: number; volatilidad_anual: number; sharpe: number | null; peor_caida: number }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-zinc-500 dark:text-[#71717a] text-right">
            <th className="text-left font-normal py-1">Pesos</th><th className="font-normal">Retorno</th><th className="font-normal">Volatilidad</th>
            <th className="font-normal" title="Retorno por unidad de riesgo (Sharpe sin tasa libre de riesgo)">Ret./riesgo</th><th className="font-normal">Peor caída</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(ponderaciones) as Ponderacion[]).map(p => {
            const x = ponderaciones[p];
            return (
              <tr key={p} className={`text-right border-t border-zinc-100 dark:border-[#27272a] ${p === elegida ? 'font-bold text-zinc-900 dark:text-[#e4e4e7]' : 'text-zinc-600 dark:text-[#a1a1aa]'}`}>
                <td className="text-left py-1">{NOMBRE_PONDERACION[p]}{p === elegida ? ' ✓' : ''}</td>
                <td>{pctCorto(x.retorno_anual)}</td><td>{pctCorto(x.volatilidad_anual)}</td>
                <td>{x.sharpe?.toFixed(2) ?? '—'}</td><td>{pctCorto(x.peor_caida)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-zinc-500 dark:text-[#71717a] mt-1">
        ✓ la que se usa: la de mejor retorno por unidad de riesgo que además no fue peor que partes iguales en ninguna mitad de la historia.
        Mínima varianza es la cartera eficiente de Markowitz cuando todas las elegidas tienen el mismo retorno esperado (covarianza de Ledoit-Wolf, un año de datos).
      </p>
    </div>
  );
}

function Historial({ h }: { h: Historiales | null }) {
  if (!h) return null;
  return (
    <div className="text-left text-xs text-zinc-600 dark:text-[#a1a1aa] space-y-1">
      <p className="font-semibold text-zinc-800 dark:text-[#e4e4e7]">Historial real (comprando al cierre del día en que se publicó cada idea)</p>
      {h.actual
        ? <><p>Método actual, desde {fechaCorta(h.actual.desde)}: {lineaHistorial(h.actual, 'EE.UU.')}</p><p>{lineaHistorial(h.actual, 'Chile')}</p></>
        : <p>Método actual: empezó {h.desde_metodo_actual ? `el ${fechaCorta(h.desde_metodo_actual)}` : 'hoy'}; su historial se mide cada día y aparecerá aquí.</p>}
      {h.anterior && (
        <p className="text-zinc-500 dark:text-[#71717a]">
          Método anterior (acciones en sobreventa), {fechaCorta(h.anterior.desde)} a {fechaCorta(h.anterior.hasta)}: {lineaHistorial(h.anterior, 'EE.UU.')} Por eso se reemplazó.
        </p>
      )}
    </div>
  );
}

// Qué peso lleva cada idea de la lista y cuánto llegó a caer esa cartera en la historia medida
function avisoPesos(clave: ClaveMetodo): string {
  const c = evidenciaMetodo(clave)?.cartera;
  if (!c) return '';
  const caida = c.ponderaciones[c.elegida].peor_caida;
  const como = c.elegida === 'igual' ? 'todas pesan lo mismo' : c.elegida === 'inversa_volatilidad'
    ? 'la más volátil pesa menos' : 'pesan más las que bajan el riesgo del conjunto';
  return ` Peso de cada una (a la derecha): ${NOMBRE_PONDERACION[c.elegida].toLowerCase()}, ${como}. En la historia medida esta cartera llegó a caer ${pctCorto(caida)} en algún momento.`;
}

interface Tesis { loading: boolean; content: string; error?: string }

function Idea({ c, i, abierta, onToggle, tesis, onTesis }: {
  c: Candidato; i: number; abierta: boolean; onToggle: () => void; tesis?: Tesis; onTesis: () => void;
}) {
  const res = textoResultados(c.proximos_resultados);
  return (
    <div className={`border rounded-lg overflow-hidden ${abierta ? 'border-[#60a5fa]' : 'border-zinc-200 dark:border-[#27272a]'} bg-zinc-50 dark:bg-[#09090b]`}>
      <button onClick={onToggle} className="w-full p-3 flex items-center gap-3 text-left">
        <span className="font-mono text-xs text-zinc-500 w-6 text-right">{i + 1}</span>
        <span className="font-mono font-bold text-base text-zinc-900 dark:text-[#e4e4e7] w-28 shrink-0">{c.ticker}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs text-zinc-500 dark:text-[#a1a1aa] truncate">{sectorDe(c)}</span>
          <span className="block text-xs text-zinc-700 dark:text-[#d4d4d8]">{resumenCorto(c)}</span>
        </span>
        {res?.pronto && <span className="hidden sm:inline text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">resultados {res.texto}</span>}
        {typeof c.peso === 'number' && (
          <span title="Peso dentro de esta lista" className="font-mono text-xs font-bold text-zinc-900 dark:text-[#e4e4e7] shrink-0">{(c.peso * 100).toFixed(1)}%</span>
        )}
        {abierta ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
      </button>
      {abierta && (
        <div className="p-4 bg-white dark:bg-[#18181b] border-t border-zinc-200 dark:border-[#27272a] space-y-4">
          <p className="text-sm text-zinc-700 dark:text-[#d4d4d8] leading-relaxed">{criterio(c)}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {[
              ['P/E (precio / utilidad)', textoPE(c)],
              ['Dividendo anual', normalizeYield(c.div_str)],
              ['Deuda / patrimonio', textoDeuda(c)],
              ['Próximos resultados', res?.texto ?? 'Sin fecha anunciada en Yahoo'],
            ].map(([label, valor]) => (
              <div key={label} className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded-sm p-3">
                <dt className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">{label}</dt>
                <dd className="mt-1 text-zinc-900 dark:text-[#e4e4e7]">{valor}</dd>
              </div>
            ))}
          </dl>
          {res?.pronto && (
            <div className="flex items-start gap-3 bg-amber-50 dark:bg-[#422006] border border-amber-300 dark:border-[#78350f] p-3 rounded-sm text-amber-900 dark:text-[#fcd34d]">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="text-xs">Publica resultados {res.texto}. El precio suele moverse fuerte ese día, hacia arriba o hacia abajo: comprar antes es apostar al resultado.</p>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-[#d946ef] text-xs font-bold uppercase tracking-widest"><Sparkles className="w-4 h-4" /> Análisis redactado por IA</p>
              {!tesis?.content && !tesis?.loading && (
                <button onClick={onTesis} className="text-[10px] font-mono px-3 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-white rounded">Generar análisis</button>
              )}
            </div>
            <div className="mt-2 text-sm pl-4 border-l-2 border-zinc-200 dark:border-[#27272a]">
              {tesis?.loading ? (
                <p className="flex items-center gap-2 text-xs text-zinc-500 py-3"><Loader2 className="w-4 h-4 animate-spin text-[#60a5fa]" /> Generando análisis con IA...</p>
              ) : tesis?.error ? (
                <p className="text-xs text-red-500">{tesis.error} <button onClick={onTesis} className="underline">Reintentar</button></p>
              ) : tesis?.content ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-zinc-800 dark:text-zinc-200"><ReactMarkdown>{tesis.content}</ReactMarkdown></div>
              ) : (
                <p className="text-xs text-zinc-500 italic">Redacta con IA por qué está en la lista, sus riesgos y cómo encaja con tu cartera (no es una predicción).</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TopIdeasV2({ us, cl, historial, fecha }: { us: Candidato[]; cl: Candidato[]; historial: Historiales | null; fecha: string }) {
  const { items } = usePortfolio();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [tesis, setTesis] = useState<Record<string, Tesis>>({});

  const generar = async (c: Candidato) => {
    if (tesis[c.ticker]?.loading || tesis[c.ticker]?.content) return;
    const clave = `quantum_thesis_v3_${c.ticker}_${fecha}`;
    let guardada: string | null = null;
    try { guardada = localStorage.getItem(clave); } catch { /* sin almacenamiento local */ }
    if (guardada) { setTesis(p => ({ ...p, [c.ticker]: { loading: false, content: guardada! } })); return; }
    setTesis(p => ({ ...p, [c.ticker]: { loading: true, content: '' } }));
    try {
      const res = await fetch('/api/generate-thesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: c.ticker, price: c.price, pe: textoPE(c), div_str: normalizeYield(c.div_str), deuda: textoDeuda(c),
          sector: sectorDe(c), resultados: textoResultados(c.proximos_resultados)?.texto, criterio: criterio(c),
          portfolio: items.map(i => i.ticker).join(', '),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar el análisis');
      try { localStorage.setItem(clave, data.thesis); } catch { /* sin almacenamiento local */ }
      setTesis(p => ({ ...p, [c.ticker]: { loading: false, content: data.thesis } }));
    } catch (e) {
      setTesis(p => ({ ...p, [c.ticker]: { loading: false, content: '', error: e instanceof Error ? e.message : 'Error al generar el análisis' } }));
    }
  };

  const toggle = (c: Candidato) => {
    const nueva = abierta === c.ticker ? null : c.ticker;
    setAbierta(nueva);
    if (nueva) generar(c);
  };

  // Donde la evidencia no es significativa es mejor no recomendar: la lista no se muestra (el bot tampoco la publica)
  const lista = (clave: ClaveMetodo, titulo: string, ideas: Candidato[], aviso?: string) => {
    const significativa = evidenciaMetodo(clave)?.nivel === 'sólida';
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-[#e4e4e7]">{titulo}</h3>
        {!significativa ? (
          <p className="text-xs text-zinc-600 dark:text-[#a1a1aa]">Este método no tiene hoy evidencia significativa (t de 2 o más y ganando en ambas mitades de la historia): no se recomienda ninguna acción de esta lista.</p>
        ) : (
          <>
            {aviso && <p className="text-[11px] text-zinc-500 dark:text-[#71717a]">{aviso}</p>}
            {ideas.length === 0
              ? <p className="text-xs text-zinc-500">Hoy no hay acciones que cumplan el criterio con datos confiables.</p>
              : ideas.map((c, i) => <Idea key={c.ticker} c={c} i={i} abierta={abierta === c.ticker} onToggle={() => toggle(c)} tesis={tesis[c.ticker]} onTesis={() => generar(c)} />)}
          </>
        )}
      </section>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className={`${tarjeta} p-6 space-y-4`}>
        <div className="text-center">
          <h2 className="text-xl font-bold text-[#60a5fa] uppercase tracking-widest">Ideas con evidencia</h2>
          <p className="text-zinc-600 dark:text-[#a1a1aa] text-sm max-w-2xl mx-auto mt-2">
            Cada día el sistema elige acciones con los únicos criterios que, medidos en 10 años de datos y sin mirar el futuro, le ganaron a su mercado.
            No son una recomendación personal: en la pestaña de recomendaciones verás cómo encaja cada una con tu cartera.
          </p>
          <p className="text-xs font-medium text-zinc-500 dark:text-[#71717a] mt-3 uppercase">Última actualización: {new Date(fecha).toLocaleString('es-CL')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <CajaMetodo clave="calidad_eeuu" />
          <CajaMetodo clave="momentum_chile" />
        </div>
        <Historial h={historial} />
      </div>

      {lista('calidad_eeuu', 'EE.UU.: utilidad respaldada por caja (una o dos por sector, sin bancos)', us,
        `Se evalúa cada empresa del S&P 500 frente a las de su sector con sus estados financieros en la SEC; quedan fuera las que reparten en dividendos más de lo que ganan.${avisoPesos('calidad_eeuu')}`)}
      {lista('momentum_chile', 'Chile: las de mayor alza de los últimos 12 meses', cl,
        `Precios oficiales de la Bolsa de Santiago.${avisoPesos('momentum_chile')}`)}

      <details className="text-[11px] text-zinc-500 dark:text-[#71717a]">
        <summary className="cursor-pointer">Límites de la medición</summary>
        <ul className="mt-2 space-y-1 list-disc pl-4">
          {sesgosEvidencia().map((s, i) => <li key={i}>{s}</li>)}
          <li>Rentabilidades pasadas no aseguran las futuras. Es una herramienta de apoyo y no constituye asesoría financiera personalizada.</li>
        </ul>
      </details>
    </div>
  );
}
