'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, Newspaper, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';

type Accion = 'AUMENTAR' | 'MANTENER' | 'REDUCIR';
type Tono = 'positivo' | 'neutral' | 'negativo' | 'mixto';

interface Pilar { veredicto: string; motivos: string[] }

interface Fundamentales {
  tipo: 'accion' | 'etf' | 'fondo';
  sector?: string;
  per?: number;
  perForward?: number;
  pvl?: number;
  roe?: number;
  dividendYield?: number;
  payout?: number;
  crecimientoUtilidad?: number;
  analistas?: { n: number; recomendacion: string; objetivo: number; potencial: number };
  gastoAnual?: number;
  categoria?: string;
}

interface Posicion {
  ticker: string;
  nombre?: string;
  tipo: 'accion' | 'etf' | 'fondo';
  sector?: string;
  moneda: 'USD' | 'CLP';
  precio: number;
  valorCLP: number;
  peso: number;
  pesoEfectivo: number;
  pnl: number | null;
  ret1y: number | null;
  ret3y: number | null;
  vol: number | null;
  aporteRiesgo: number | null;
  beta: number | null;
  benchmark: string;
  stop: number | null;
  stopDist: number | null;
  stopActivado: boolean;
  fundamentales: Fundamentales | null;
  tecnico: Pilar;
  fundamental: Pilar;
  riesgo: Pilar;
  accion: Accion;
  conviccion: 'alta' | 'media' | 'baja';
  motivos: string[];
  comentarioIa: string;
}

interface Hallazgo { nivel: 'alerta' | 'atencion' | 'ok'; titulo: string; detalle: string }

interface Informe {
  generado: string;
  usdClp: number;
  tasaLibreRiesgo: number;
  resumen: {
    valorCLP: number;
    pnlCLP: number;
    pnlPct: number | null;
    pesoUSD: number;
    vol: number | null;
    maxDD: number | null;
    ret1y: number | null;
    retAnualVentana: number | null;
    var95CLP: number | null;
    es95CLP: number | null;
    diversificacion: number | null;
    posicionesEfectivas: number | null;
    riesgoCambiario: number | null;
    ventanaAnios: number;
    indice: { nombre: string; ret1y: number; diferencia: number | null; trackingError: number | null } | null;
    perfil: string | null;
  };
  mercado: {
    regimen: 'favorable' | 'cauteloso' | 'defensivo';
    titulo: string;
    lecturas: string[];
  } | null;
  exposicion: {
    regiones: { nombre: string; peso: number }[];
    sectores: { nombre: string; peso: number; via: string[] }[];
    empresas: { ticker: string; directo: number; viaFondos: number; total: number; fondos: string[] }[];
    notas: string[];
  };
  estrategia: string[];
  hallazgos: Hallazgo[];
  diagnostico: string;
  posiciones: Posicion[];
  avisosDatos: string[];
  modelo: string | null;
  avisoIa: string | null;
  redaccionPendiente?: boolean;
}

interface Noticia { titulo: string; fuente: string; fecha: string; url: string }
interface Noticias {
  noticias: Record<string, Noticia[]>;
  tono: Record<string, { tono: Tono; resumen: string }>;
  avisoIa: string | null;
}

const CACHE_PREFIX = 'omnicapital_informe_v4_';
const NEWS_PREFIX = 'omnicapital_noticias_v1_';

// Fecha de hoy en Chile: el informe se renueva cada día de mercado chileno, no a medianoche UTC
const hoyEnChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());

// Una sola solicitud en curso por composición: si el usuario sale de la pestaña y vuelve, se reutiliza
const enCurso = new Map<string, Promise<Informe>>();

const pct = (x: number | null | undefined, digits = 1, sign = false) =>
  x === null || x === undefined ? 'N/D' : `${sign && x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`;
const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const money = (n: number, moneda: 'USD' | 'CLP') => moneda === 'CLP'
  ? clp(n)
  : `US$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (x: number | null) => (x === null ? 'text-zinc-500' : x >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400');
const fecha = (f: string) => `${f.slice(8, 10)}-${f.slice(5, 7)}`;

const ACCION_ESTILO: Record<Accion, { label: string; box: string; badge: string }> = {
  AUMENTAR: { label: '🟢 AUMENTAR', box: 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/10', badge: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400' },
  MANTENER: { label: '🟡 MANTENER', box: 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30', badge: 'border-amber-500/50 text-amber-700 dark:text-amber-400' },
  REDUCIR: { label: '🔴 REDUCIR', box: 'border-red-500/40 bg-red-50/40 dark:bg-red-950/10', badge: 'border-red-500/50 text-red-700 dark:text-red-400' },
};

// Color del veredicto de cada pilar
const VEREDICTO: Record<string, string> = {
  alcista: 'text-emerald-700 dark:text-emerald-400', favorable: 'text-emerald-700 dark:text-emerald-400', holgado: 'text-emerald-700 dark:text-emerald-400', positivo: 'text-emerald-700 dark:text-emerald-400',
  neutral: 'text-zinc-600 dark:text-zinc-400', 'sin datos': 'text-zinc-500', mixto: 'text-amber-700 dark:text-amber-400', 'cerca del límite': 'text-amber-700 dark:text-amber-400',
  bajista: 'text-red-700 dark:text-red-400', débil: 'text-red-700 dark:text-red-400', quiebre: 'text-red-700 dark:text-red-400', excedido: 'text-red-700 dark:text-red-400', negativo: 'text-red-700 dark:text-red-400',
};
const REGIMEN: Record<string, string> = {
  favorable: 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300',
  cauteloso: 'border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300',
  defensivo: 'border-red-500/40 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300',
};
const tarjeta = 'bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-lg';

function Kpi({ label, value, sub, valueClass = '' }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className={`${tarjeta} p-4`}>
      <p className="text-[10px] font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa] ${valueClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-500 dark:text-[#a1a1aa] mt-1">{sub}</p>}
    </div>
  );
}

function Metric({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{label}</p>
      <p className={`text-sm font-mono font-semibold text-zinc-900 dark:text-zinc-100 ${className}`}>{value}</p>
    </div>
  );
}

function Barras({ titulo, filas }: { titulo: string; filas: { nombre: string; peso: number; detalle?: string }[] }) {
  const max = Math.max(...filas.map(f => f.peso), 0.01);
  return (
    <div>
      <p className="text-[10px] font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-2">{titulo}</p>
      <div className="space-y-1.5">
        {filas.map(f => (
          <div key={f.nombre} title={f.detalle}>
            <div className="flex justify-between text-xs text-zinc-700 dark:text-zinc-300">
              <span className="truncate pr-2">{f.nombre}</span><span className="font-mono">{pct(f.peso)}</span>
            </div>
            <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded">
              <div className="h-1.5 rounded bg-blue-500/70" style={{ width: `${(f.peso / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PilarBox({ titulo, pilar }: { titulo: string; pilar: Pilar }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 bg-white/60 dark:bg-zinc-950/30">
      <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{titulo}</p>
      <p className={`text-sm font-bold capitalize ${VEREDICTO[pilar.veredicto] ?? ''}`}>{pilar.veredicto}</p>
      <ul className="mt-1.5 space-y-1 text-[11px] text-zinc-600 dark:text-zinc-400 leading-snug">
        {pilar.motivos.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </div>
  );
}

function datosFundamentales(p: Posicion): { label: string; value: string; className?: string }[] {
  const f = p.fundamentales;
  if (!f) return [];
  const out: { label: string; value: string; className?: string }[] = [];
  if (f.per !== undefined) out.push({ label: 'PER', value: f.per.toFixed(1) });
  if (f.perForward !== undefined) out.push({ label: 'PER esperado', value: f.perForward.toFixed(1) });
  if (f.pvl !== undefined) out.push({ label: 'P/VL', value: f.pvl.toFixed(1) });
  if (f.roe !== undefined) out.push({ label: 'ROE', value: pct(f.roe) });
  if (f.dividendYield !== undefined) out.push({ label: 'Dividendo', value: pct(f.dividendYield) });
  if (f.crecimientoUtilidad !== undefined) out.push({ label: 'Crec. utilidad', value: pct(f.crecimientoUtilidad, 1, true), className: tone(f.crecimientoUtilidad) });
  if (f.analistas) out.push({ label: `Objetivo (${f.analistas.n} analistas)`, value: `${money(f.analistas.objetivo, p.moneda)} (${pct(f.analistas.potencial, 0, true)})`, className: tone(f.analistas.potencial) });
  if (f.gastoAnual !== undefined) out.push({ label: 'Costo anual', value: pct(f.gastoAnual, 2) });
  return out;
}

export default function RecommendationsTab() {
  const { items } = usePortfolio();
  const [data, setData] = useState<Informe | null>(null);
  const [noticias, setNoticias] = useState<Noticias | null>(null);
  const [loading, setLoading] = useState(true);
  const [redactando, setRedactando] = useState(false);
  const [error, setError] = useState('');
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const cacheKeyRef = useRef('');

  // Se cachea por sesión según la composición del portafolio y el día, para no gastar cuota de IA
  const cacheKey = CACHE_PREFIX + hoyEnChile() + JSON.stringify(items.map(i => [i.ticker, i.cantidad, i.precio_compra, i.moneda, i.purchase_date || '']).sort());

  // Noticias (aparte, porque tardan y no cambian las decisiones)
  const cargarNoticias = useCallback(async (informe: Informe, force: boolean) => {
    const activos = informe.posiciones.filter(p => p.tipo !== 'etf').map(p => ({ ticker: p.ticker, nombre: p.nombre }));
    if (activos.length === 0) return;
    const key = NEWS_PREFIX + hoyEnChile() + activos.map(a => a.ticker).sort().join(',');
    if (!force) {
      try {
        const cached = sessionStorage.getItem(key);
        if (cached) { setNoticias(JSON.parse(cached)); return; }
      } catch { /* sin caché */ }
    }
    try {
      const res = await fetch('/api/portfolio/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activos }),
        signal: AbortSignal.timeout(70000),
      });
      if (!res.ok) return;
      const json = await res.json();
      try { sessionStorage.setItem(key, JSON.stringify(json)); } catch { /* sin caché */ }
      setNoticias(json);
    } catch { /* las noticias son un extra: si fallan, el informe sigue */ }
  }, []);

  // Redacción con IA (llamada aparte): el informe ya está en pantalla mientras tanto
  const redactar = useCallback(async (informe: Informe, key: string) => {
    setRedactando(true);
    let final: Informe;
    try {
      const res = await fetch('/api/portfolio/redaccion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ informe }),
        signal: AbortSignal.timeout(70000),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || r.error) throw new Error(r.error || `Error ${res.status}`);
      final = {
        ...informe,
        diagnostico: r.diagnostico ?? informe.diagnostico,
        posiciones: informe.posiciones.map(p => ({ ...p, comentarioIa: r.comentarios?.[p.ticker] ?? '' })),
        modelo: r.modelo ?? null,
        avisoIa: r.avisoIa ?? null,
        redaccionPendiente: false,
      };
    } catch {
      final = { ...informe, avisoIa: 'La redacción con IA no está disponible ahora; se muestra el análisis calculado.', redaccionPendiente: false };
    }
    try { sessionStorage.setItem(key, JSON.stringify(final)); } catch { /* sin caché */ }
    if (cacheKeyRef.current === key) setData(final);
    if (cacheKeyRef.current === key) setRedactando(false);
  }, []);

  const generate = useCallback(async (force: boolean) => {
    cacheKeyRef.current = cacheKey;
    if (items.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');

    if (!force) {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const informe = JSON.parse(cached) as Informe;
          setData(informe);
          setLoading(false);
          cargarNoticias(informe, false);
          if (informe.redaccionPendiente) redactar(informe, cacheKey);
          return;
        }
      } catch { /* sessionStorage no disponible: seguimos sin caché */ }
    }

    try {
      let pending = enCurso.get(cacheKey);
      if (!pending) {
        pending = (async () => {
          const res = await fetch('/api/portfolio/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: items.map(i => ({
                ticker: i.ticker,
                cantidad: i.cantidad,
                precio_compra: i.precio_compra,
                moneda: i.moneda,
                purchase_date: i.purchase_date || null,
              })),
            }),
            signal: AbortSignal.timeout(130000),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status} al generar el informe`);
          try { sessionStorage.setItem(cacheKey, JSON.stringify(json)); } catch { /* sin caché */ }
          return json as Informe;
        })().finally(() => enCurso.delete(cacheKey));
        enCurso.set(cacheKey, pending);
      }
      const json = await pending;
      if (cacheKeyRef.current === cacheKey) {
        setData(json);
        cargarNoticias(json, force);
        if (json.redaccionPendiente) redactar(json, cacheKey);
      }
    } catch (e: unknown) {
      if (cacheKeyRef.current !== cacheKey) return; // el portafolio cambió mientras esperaba
      const aborted = e instanceof DOMException && (e.name === 'AbortError' || e.name === 'TimeoutError');
      setError(aborted ? 'El análisis tardó demasiado. Intenta de nuevo.' : e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      if (cacheKeyRef.current === cacheKey) setLoading(false);
    }
  }, [items, cacheKey, cargarNoticias, redactar]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    generate(false);
  }, [generate]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500 dark:text-zinc-400 font-mono border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 rounded">
        <p className="text-lg mb-2">📊 Portafolio Vacío</p>
        <p className="text-sm text-center max-w-lg">
          Agrega acciones a tu portafolio (pestaña Mi Portafolio o sube una Cartola) para ver tu diagnóstico personalizado.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center p-12 font-mono text-zinc-600 dark:text-zinc-400">
        Descargando 3 años de precios con dividendos, fundamentales, consenso de analistas y contexto de mercado (la primera vez del día puede tardar hasta dos minutos)...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-red-600 dark:text-red-400 font-mono border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 rounded text-center max-w-5xl mx-auto">
        <p className="text-lg mb-2">⚠️ Informe no disponible</p>
        <p className="text-sm max-w-lg">{error || 'Sin datos.'}</p>
        <button onClick={() => generate(true)} className="mt-4 text-xs font-bold underline hover:no-underline">Reintentar</button>
      </div>
    );
  }

  const r = data.resumen;
  const porAccion = (a: Accion) => data.posiciones.filter(p => p.accion === a).map(p => p.ticker);
  const negativas = noticias ? Object.entries(noticias.tono).filter(([, t]) => t.tono === 'negativo') : [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-sans font-bold text-zinc-900 dark:text-zinc-100">Informe de tu portafolio</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
            {new Date(data.generado).toLocaleString('es-CL')} · Dólar ${data.usdClp.toLocaleString('es-CL', { maximumFractionDigits: 2 })} · TPM {pct(data.tasaLibreRiesgo)}
          </p>
        </div>
        <button
          onClick={() => generate(true)}
          className="bg-[#60a5fa] hover:bg-[#3b82f6] text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-2 w-fit"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Actualizar informe
        </button>
      </div>

      {data.avisosDatos.length > 0 && (
        <div className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-300/50 rounded p-3 space-y-1">
          {data.avisosDatos.map((a, i) => <p key={i} className="flex gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{a}</p>)}
        </div>
      )}

      {/* Contexto de mercado */}
      {data.mercado && (
        <div className={`border rounded-lg p-4 ${REGIMEN[data.mercado.regimen]}`}>
          <p className="text-[10px] font-mono uppercase tracking-widest mb-1">Contexto de mercado · {data.mercado.regimen}</p>
          <p className="text-sm font-semibold mb-2">{data.mercado.titulo}</p>
          <ul className="text-xs space-y-0.5 opacity-90">{data.mercado.lecturas.map((l, i) => <li key={i}>• {l}</li>)}</ul>
        </div>
      )}

      {/* KPIs del portafolio, todo consolidado en pesos */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Valor total" value={clp(r.valorCLP)} sub={`${pct(r.pesoUSD, 0)} en dólares`} />
        <Kpi label="Resultado desde compra" value={pct(r.pnlPct, 1, true)} valueClass={tone(r.pnlPct)} sub={`${r.pnlCLP >= 0 ? '+' : '-'}${clp(Math.abs(r.pnlCLP))} en pesos`} />
        <Kpi
          label="12 meses (con dividendos)"
          value={pct(r.ret1y, 1, true)}
          valueClass={tone(r.ret1y)}
          sub={r.indice ? `Índice equivalente ${pct(r.indice.ret1y, 1, true)}` : undefined}
        />
        <Kpi label="Volatilidad anual" value={pct(r.vol)} sub={r.perfil ? `Perfil ${r.perfil} (${r.ventanaAnios} años)` : undefined} />
        <Kpi label={`Caída máxima ${r.ventanaAnios} años`} value={r.maxDD !== null ? `-${pct(r.maxDD)}` : 'N/D'} valueClass="text-red-600 dark:text-red-400" />
        <Kpi
          label="Pérdida en un mal día"
          value={r.var95CLP !== null ? `-${clp(r.var95CLP)}` : 'N/D'}
          sub={r.es95CLP !== null ? `Promedio en días malos: -${clp(r.es95CLP)}` : undefined}
        />
      </div>

      {/* Plan estratégico calculado con reglas */}
      <div className={`${tarjeta} p-5`}>
        <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-widest mb-3">Plan estratégico</h3>
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          {data.estrategia.map((e, i) => <li key={i}>{e}</li>)}
        </ol>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-xs font-mono">
          <span className="text-emerald-700 dark:text-emerald-400">AUMENTAR: {porAccion('AUMENTAR').join(', ') || '—'}</span>
          <span className="text-amber-700 dark:text-amber-400">MANTENER: {porAccion('MANTENER').join(', ') || '—'}</span>
          <span className="text-red-700 dark:text-red-400">REDUCIR: {porAccion('REDUCIR').join(', ') || '—'}</span>
        </div>
      </div>

      {/* Diagnóstico redactado por la IA */}
      <div className="bg-blue-50 dark:bg-blue-900/10 border-l-4 border-l-blue-500 border-y border-r border-blue-200 dark:border-blue-900/30 p-5 rounded-md">
        <h3 className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Diagnóstico {redactando ? '(redactando con IA…)' : data.modelo ? '(redactado por IA a partir de los datos calculados)' : '(calculado)'}
        </h3>
        <p className="text-sm text-blue-900 dark:text-blue-100 leading-relaxed whitespace-pre-line">{data.diagnostico}</p>
        {data.avisoIa && (
          <p className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 mt-3"><Info className="w-3.5 h-3.5" /> {data.avisoIa}</p>
        )}
      </div>

      {/* Exposición real, mirando dentro de los fondos */}
      <div className={`${tarjeta} p-5`}>
        <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-widest mb-4">Exposición real (contando lo que hay dentro de tus fondos)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Barras titulo="Países" filas={data.exposicion.regiones} />
          <Barras titulo="Sectores" filas={data.exposicion.sectores.slice(0, 8).map(s => ({ nombre: s.nombre, peso: s.peso, detalle: `Vía ${s.via.join(', ')}` }))} />
          <Barras
            titulo="Empresas (directo + vía fondos)"
            filas={data.exposicion.empresas.slice(0, 8).map(e => ({
              nombre: e.ticker,
              peso: e.total,
              detalle: `Directo ${pct(e.directo)}${e.viaFondos > 0 ? `; vía ${e.fondos.join(', ')} ${pct(e.viaFondos)}` : ''}`,
            }))}
          />
        </div>
        {data.exposicion.notas.length > 0 && <p className="text-[11px] text-zinc-500 mt-3">{data.exposicion.notas.join(' ')}</p>}
      </div>

      {/* Hallazgos calculados */}
      <div className={`${tarjeta} divide-y divide-zinc-200 dark:divide-[#27272a]`}>
        {data.hallazgos.map((h, i) => (
          <div key={i} className="flex gap-3 p-4">
            {h.nivel === 'alerta' ? <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              : h.nivel === 'atencion' ? <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              : <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />}
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{h.titulo}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{h.detalle}</p>
            </div>
          </div>
        ))}
        {negativas.length > 0 && (
          <div className="flex gap-3 p-4">
            <Newspaper className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Noticias con tono negativo: {negativas.map(([t]) => t).join(', ')}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{negativas.map(([t, n]) => `${t}: ${n.resumen}`).join(' ')} Revisa los titulares antes de comprar más.</p>
            </div>
          </div>
        )}
      </div>

      {/* Una tarjeta por activo */}
      <div className="grid grid-cols-1 gap-4">
        {data.posiciones.map(p => {
          const estilo = ACCION_ESTILO[p.accion];
          const abierto = abiertos[p.ticker];
          const ns = noticias?.noticias[p.ticker] ?? [];
          const t = noticias?.tono[p.ticker];
          const fund = datosFundamentales(p);
          return (
            <div key={p.ticker} className={`border ${estilo.box} rounded-xl p-5`}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <div>
                    <h4 className="font-mono font-bold text-xl text-zinc-900 dark:text-zinc-100">{p.ticker}</h4>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-[320px] truncate">
                      {[p.nombre, p.tipo === 'etf' ? 'ETF' : p.tipo === 'fondo' ? 'Fondo' : p.sector].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={`font-bold text-xs px-3 py-1.5 border rounded-md bg-white dark:bg-zinc-950 ${estilo.badge}`}>{estilo.label}</span>
                    <span className="text-[10px] font-mono text-zinc-500 text-center">convicción {p.conviccion}</span>
                  </div>
                </div>
                <div className="flex gap-6 text-right">
                  <Metric label="Peso" value={p.pesoEfectivo > p.peso + 0.005 ? `${pct(p.peso)} (${pct(p.pesoEfectivo)})` : pct(p.peso)} />
                  <Metric label="Valor" value={clp(p.valorCLP)} />
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3 mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <Metric label="Precio" value={money(p.precio, p.moneda)} />
                <Metric label="P&L compra" value={pct(p.pnl, 1, true)} className={tone(p.pnl)} />
                <Metric label="12 meses" value={pct(p.ret1y, 1, true)} className={tone(p.ret1y)} />
                <Metric label="3 años (anual)" value={pct(p.ret3y, 1, true)} className={tone(p.ret3y)} />
                <Metric label="Volatilidad" value={pct(p.vol, 0)} />
                <Metric label="Aporte al riesgo" value={pct(p.aporteRiesgo)} />
                <Metric label={`Beta ${p.benchmark}`} value={p.beta !== null ? p.beta.toFixed(2) : 'N/D'} />
                <Metric
                  label={p.stopActivado ? 'Stop (activado)' : 'Stop sugerido'}
                  value={p.stop !== null ? `${money(p.stop, p.moneda)} (${pct(p.stopDist)})` : 'N/D'}
                  className={p.stopActivado ? 'text-red-600 dark:text-red-400' : ''}
                />
              </div>

              {fund.length > 0 && (
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
                  {fund.map(d => <Metric key={d.label} label={d.label} value={d.value} className={d.className} />)}
                </div>
              )}

              <ul className="mt-4 space-y-1 text-sm text-zinc-800 dark:text-zinc-200">
                {p.motivos.map((m, i) => <li key={i} className="flex gap-1.5"><span className="text-zinc-400">›</span>{m}</li>)}
              </ul>

              {p.comentarioIa && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mt-3 border-l-2 border-blue-400/60 pl-3">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-blue-600 dark:text-blue-400 mr-1.5">Comentario IA</span>{p.comentarioIa}
                </p>
              )}

              {(ns.length > 0 || t) && (
                <div className="mt-3 text-xs">
                  <p className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                    <Newspaper className="w-3.5 h-3.5" /> Noticias (30 días)
                    {t && <span className={`font-semibold capitalize ${VEREDICTO[t.tono] ?? ''}`}>· tono {t.tono}</span>}
                  </p>
                  {t && <p className="text-zinc-600 dark:text-zinc-400 mt-1">{t.resumen} <span className="text-[10px] text-blue-600 dark:text-blue-400">(resumen IA)</span></p>}
                  <ul className="mt-1 space-y-0.5">
                    {ns.slice(0, abierto ? 6 : 2).map((n, i) => (
                      <li key={i} className="truncate">
                        <span className="font-mono text-zinc-400 mr-1.5">{fecha(n.fecha)}</span>
                        <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" className="text-zinc-700 dark:text-zinc-300 hover:underline">{n.titulo}</a>
                        <span className="text-zinc-400"> · {n.fuente}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={() => setAbiertos(prev => ({ ...prev, [p.ticker]: !prev[p.ticker] }))}
                className="flex items-center gap-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mt-3"
              >
                {abierto ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />} Análisis por pilar{ns.length > 2 ? ' y más noticias' : ''}
              </button>
              {abierto && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <PilarBox titulo="Técnico (precio con dividendos)" pilar={p.tecnico} />
                  <PilarBox titulo="Fundamental" pilar={p.fundamental} />
                  <PilarBox titulo="Riesgo en tu cartera" pilar={p.riesgo} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {noticias?.avisoIa && <p className="text-[11px] text-amber-700 dark:text-amber-400">{noticias.avisoIa}</p>}

      <p className="text-[11px] text-zinc-500 dark:text-zinc-500 leading-relaxed">
        Cómo se calcula: {r.ventanaAnios} años de cierres diarios ajustados por dividendos (base del minero para Chile, Yahoo Finance para EE.UU.), solo con datos al día.
        Técnico: precio contra su media de 200 días con una banda de ±3% y momentum 12-1; el RSI solo sugiere el momento de entrada; stop = máximo del último mes menos 2 desviaciones
        estándar mensuales, confirmado con dos cierres. Fundamental: PER frente a su mercado, ROE, crecimiento de utilidades, salud del dividendo y consenso de analistas (Yahoo Finance);
        en ETFs, costo y valoración de lo que tienen. Riesgo: peso contando lo que tienes dentro de tus fondos (máximo 20% por empresa, 40% por fondo y 35% por sector), aporte al riesgo con
        covarianza de Newey-West encogida (Ledoit-Wolf), activos que se mueven casi igual, y beta de Dimson. Mercado: tendencia del S&P 500, del IPSA y de las acciones globales, y el VIX.
        Noticias: titulares de Yahoo Finance y Google News de los últimos 30 días; no cambian las decisiones. El ETF del IPSA en Yahoo no incluye sus repartos de dividendos.
        No considera comisiones, impuestos ni tu situación personal (horizonte, metas, otros ahorros). {data.modelo ? `Redacción: ${data.modelo}. ` : ''}
        Es una herramienta de apoyo y no constituye asesoría financiera personalizada.
      </p>
    </div>
  );
}
