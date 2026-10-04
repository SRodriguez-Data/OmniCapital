'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, RefreshCw, ShieldAlert } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';

type Accion = 'AUMENTAR' | 'MANTENER' | 'REDUCIR';

interface Posicion {
  ticker: string;
  nombre?: string;
  moneda: 'USD' | 'CLP';
  precio: number;
  valorCLP: number;
  peso: number;
  pnl: number | null;
  momentum: number | null;
  momentumMeses: 12 | 6 | null;
  ret1y: number | null;
  vol: number | null;
  aporteRiesgo: number | null;
  beta: number | null;
  benchmark: string;
  rsi: number | null;
  stop: number | null;
  stopDist: number | null;
  stopActivado: boolean;
  accion: Accion;
  motivos: string[];
  analisis: string;
}

interface Hallazgo { nivel: 'alerta' | 'atencion' | 'ok'; titulo: string; detalle: string }

interface Informe {
  generado: string;
  usdClp: number;
  tasaLibreRiesgo: number;
  resumen: {
    valorCLP: number;
    costoCLP: number;
    pnlCLP: number;
    pnlPct: number | null;
    pesoUSD: number;
    vol: number | null;
    maxDD: number | null;
    ret1y: number | null;
    sharpe: number | null;
    var95: number | null;
    var95CLP: number | null;
    es95: number | null;
    es95CLP: number | null;
    diversificacion: number | null;
    posicionesEfectivas: number | null;
    riesgoCambiario: number | null;
    cobertura: number;
    indice: { nombre: string; ret1y: number; diferencia: number | null; trackingError: number | null } | null;
    perfil: string | null;
  };
  hallazgos: Hallazgo[];
  diagnostico: string;
  posiciones: Posicion[];
  modelo: string | null;
  avisoIa: string | null;
}

const CACHE_PREFIX = 'omnicapital_informe_v3_';

// Fecha de hoy en Chile: el informe se renueva cada día de mercado chileno, no a medianoche UTC
const hoyEnChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());

// Una sola solicitud en curso por composición: si el usuario sale de la pestaña y vuelve, se reutiliza
// en vez de gastar otra llamada a la IA
const enCurso = new Map<string, Promise<Informe>>();

const pct = (x: number | null, digits = 1, sign = false) =>
  x === null || x === undefined ? 'N/D' : `${sign && x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`;
const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const money = (n: number, moneda: 'USD' | 'CLP') => moneda === 'CLP'
  ? clp(n)
  : `US$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (x: number | null) => (x === null ? 'text-zinc-500' : x >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400');

const ACCION_ESTILO: Record<Accion, { label: string; box: string; badge: string }> = {
  AUMENTAR: {
    label: '🟢 AUMENTAR',
    box: 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/10',
    badge: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400',
  },
  MANTENER: {
    label: '🟡 MANTENER',
    box: 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30',
    badge: 'border-amber-500/50 text-amber-700 dark:text-amber-400',
  },
  REDUCIR: {
    label: '🔴 REDUCIR',
    box: 'border-red-500/40 bg-red-50/40 dark:bg-red-950/10',
    badge: 'border-red-500/50 text-red-700 dark:text-red-400',
  },
};

function Kpi({ label, value, sub, valueClass = '' }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-lg p-4">
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

export default function RecommendationsTab() {
  const { items } = usePortfolio();
  const [data, setData] = useState<Informe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const cacheKeyRef = useRef('');

  // Se cachea por sesión según la composición del portafolio y el día, para no gastar cuota de IA
  const cacheKey = CACHE_PREFIX + hoyEnChile() + JSON.stringify(items.map(i => [i.ticker, i.cantidad, i.precio_compra, i.moneda, i.purchase_date || '']).sort());

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
          setData(JSON.parse(cached));
          setLoading(false);
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
            signal: AbortSignal.timeout(90000),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status} al generar el informe`);
          try { sessionStorage.setItem(cacheKey, JSON.stringify(json)); } catch { /* sin caché */ }
          return json as Informe;
        })().finally(() => enCurso.delete(cacheKey));
        enCurso.set(cacheKey, pending);
      }
      const json = await pending;
      if (cacheKeyRef.current === cacheKey) setData(json);
    } catch (e: unknown) {
      if (cacheKeyRef.current !== cacheKey) return; // el portafolio cambió mientras esperaba
      const aborted = e instanceof DOMException && (e.name === 'AbortError' || e.name === 'TimeoutError');
      setError(aborted ? 'El análisis tardó demasiado. Intenta de nuevo.' : e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      if (cacheKeyRef.current === cacheKey) setLoading(false);
    }
  }, [items, cacheKey]);

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
        Calculando riesgo, tendencias y stops con precios reales, y redactando el informe (puede tardar hasta un minuto)...
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

      {/* KPIs del portafolio, todo consolidado en pesos */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Valor total" value={clp(r.valorCLP)} sub={`${pct(r.pesoUSD, 0)} en dólares`} />
        <Kpi label="Resultado desde compra" value={pct(r.pnlPct, 1, true)} valueClass={tone(r.pnlPct)} sub={`${r.pnlCLP >= 0 ? '+' : '-'}${clp(Math.abs(r.pnlCLP))} en pesos`} />
        <Kpi
          label="Rentabilidad 12 meses"
          value={pct(r.ret1y, 1, true)}
          valueClass={tone(r.ret1y)}
          sub={r.indice ? `Índice equivalente ${pct(r.indice.ret1y, 1, true)}` : r.sharpe !== null ? `Sharpe estimado ${r.sharpe.toFixed(2)}` : undefined}
        />
        <Kpi label="Volatilidad anual" value={pct(r.vol)} sub={r.perfil ? `Perfil ${r.perfil}` : undefined} />
        <Kpi label="Caída máxima 12m" value={r.maxDD !== null ? `-${pct(r.maxDD)}` : 'N/D'} valueClass="text-red-600 dark:text-red-400" />
        <Kpi
          label="Pérdida en un mal día"
          value={r.var95CLP !== null ? `-${clp(r.var95CLP)}` : 'N/D'}
          sub={r.es95CLP !== null ? `Promedio en días malos: -${clp(r.es95CLP)}` : undefined}
        />
      </div>

      {/* Estructura del riesgo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Diversificación" value={r.diversificacion !== null ? `${r.diversificacion.toFixed(2)}x` : 'N/D'} sub="Cuánto reduce el riesgo vs. sumar cada activo" />
        <Kpi label="Apuestas independientes" value={r.posicionesEfectivas !== null ? r.posicionesEfectivas.toFixed(1) : 'N/D'} sub="Según cómo se reparte el riesgo" />
        <Kpi label="Riesgo del dólar" value={pct(r.riesgoCambiario, 0)} sub="Parte del riesgo total" />
        <Kpi
          label="Vs. índice equivalente"
          value={r.indice?.diferencia != null ? pct(r.indice.diferencia, 1, true) : 'N/D'}
          valueClass={tone(r.indice?.diferencia ?? null)}
          sub={r.indice?.trackingError != null ? `Desvío vs. índice ${pct(r.indice.trackingError)} anual` : undefined}
        />
      </div>

      {/* Hallazgos calculados */}
      <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-lg divide-y divide-zinc-200 dark:divide-[#27272a]">
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
      </div>

      {/* Diagnóstico redactado */}
      <div className="bg-blue-50 dark:bg-blue-900/10 border-l-4 border-l-blue-500 border-y border-r border-blue-200 dark:border-blue-900/30 p-5 rounded-md">
        <h3 className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-widest mb-3">Diagnóstico del asesor</h3>
        <p className="text-sm text-blue-900 dark:text-blue-100 leading-relaxed">{data.diagnostico}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-xs font-mono">
          <span className="text-emerald-700 dark:text-emerald-400">AUMENTAR: {porAccion('AUMENTAR').join(', ') || '—'}</span>
          <span className="text-amber-700 dark:text-amber-400">MANTENER: {porAccion('MANTENER').join(', ') || '—'}</span>
          <span className="text-red-700 dark:text-red-400">REDUCIR: {porAccion('REDUCIR').join(', ') || '—'}</span>
        </div>
        {data.avisoIa && (
          <p className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 mt-3"><Info className="w-3.5 h-3.5" /> {data.avisoIa}</p>
        )}
      </div>

      {/* Una tarjeta por activo */}
      <div className="grid grid-cols-1 gap-4">
        {data.posiciones.map(p => {
          const estilo = ACCION_ESTILO[p.accion];
          const abierto = abiertos[p.ticker];
          return (
            <div key={p.ticker} className={`border ${estilo.box} rounded-xl p-5`}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <div>
                    <h4 className="font-mono font-bold text-xl text-zinc-900 dark:text-zinc-100">{p.ticker}</h4>
                    {p.nombre && <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-[260px] truncate">{p.nombre}</p>}
                  </div>
                  <span className={`font-bold text-xs px-3 py-1.5 border rounded-md bg-white dark:bg-zinc-950 ${estilo.badge}`}>{estilo.label}</span>
                </div>
                <div className="flex gap-6 text-right">
                  <Metric label="Peso" value={pct(p.peso)} />
                  <Metric label="Valor" value={clp(p.valorCLP)} />
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3 mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <Metric label="Precio" value={money(p.precio, p.moneda)} />
                <Metric label="P&L compra" value={pct(p.pnl, 1, true)} className={tone(p.pnl)} />
                <Metric label={`Momentum ${p.momentumMeses ?? 12}-1`} value={pct(p.momentum, 1, true)} className={tone(p.momentum)} />
                <Metric label="12 meses" value={pct(p.ret1y, 1, true)} className={tone(p.ret1y)} />
                <Metric label="Volatilidad" value={pct(p.vol, 0)} />
                <Metric label="Aporte al riesgo" value={pct(p.aporteRiesgo)} />
                <Metric label={`Beta ${p.benchmark}`} value={p.beta !== null ? p.beta.toFixed(2) : 'N/D'} />
                <Metric label="RSI 14" value={p.rsi !== null ? p.rsi.toFixed(0) : 'N/D'} />
                <Metric
                  label={p.stopActivado ? 'Stop (activado)' : 'Stop sugerido'}
                  value={p.stop !== null ? `${money(p.stop, p.moneda)} (${pct(p.stopDist)})` : 'N/D'}
                  className={p.stopActivado ? 'text-red-600 dark:text-red-400' : ''}
                />
              </div>

              {p.analisis && <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mt-4">{p.analisis}</p>}

              <button
                onClick={() => setAbiertos(prev => ({ ...prev, [p.ticker]: !prev[p.ticker] }))}
                className="flex items-center gap-1 text-[11px] font-mono text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 mt-3"
              >
                {abierto ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />} Por qué esta decisión
              </button>
              {abierto && (
                <ul className="list-disc pl-5 mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {p.motivos.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-zinc-500 dark:text-zinc-500 leading-relaxed">
        Cómo se calcula: cierres diarios del último año (base del minero para Chile, Yahoo Finance para EE.UU.), solo con datos al día. Señales: tendencia sobre la
        media de 200 días, momentum 12-1 y RSI de 14 días; stop = máximo del último mes menos 2 desviaciones estándar mensuales, confirmado con dos cierres.
        Riesgo en pesos con tus pesos actuales y el dólar de cada día: volatilidad con corrección de Newey-West (el peso reacciona un día después a Wall Street),
        VaR y pérdida promedio en el 5% de peores días, aporte de cada activo y del dólar al riesgo total, y beta de Dimson contra el índice de su mercado.
        {data.modelo ? ` Redacción: ${data.modelo}.` : ''} Es una herramienta de apoyo y no constituye asesoría financiera personalizada.
      </p>
    </div>
  );
}
