'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePortfolio } from '../context/PortfolioContext';
import { fetchUsdClp } from '@/lib/fx';

interface Recommendation {
  ticker: string;
  accion: string;
  stop_loss: string;
  analisis: string;
}

interface AiData {
  fecha: string;
  diagnostico: string;
  recomendaciones: Recommendation[];
}

const CACHE_PREFIX = 'quantum_diagnostico_';

export default function RecommendationsTab() {
  const { items } = usePortfolio();
  const [data, setData] = useState<AiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // El diagnóstico se cachea por sesión según la composición del portafolio,
  // para no gastar cuota de IA cada vez que se cambia de pestaña.
  const cacheKey = CACHE_PREFIX + JSON.stringify(items.map(i => [i.ticker, i.cantidad]).sort());

  const generate = useCallback(async (force: boolean) => {
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
      // Precios reales y dólar del día, para que la IA analice valores de mercado y no solo costos
      const symbols = Array.from(new Set(items.map(i => i.ticker))).join(',');
      const [pricesRes, usdClp] = await Promise.all([
        fetch(`/api/portfolio/live?symbols=${encodeURIComponent(symbols)}`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
        fetchUsdClp(),
      ]);
      const prices: Record<string, number> = pricesRes;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      const res = await fetch('/api/portfolio/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(i => ({
            ticker: i.ticker,
            cantidad: i.cantidad,
            precio_compra: i.precio_compra,
            moneda: i.moneda,
            precio_actual: prices[i.ticker],
          })),
          usdClp,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      // La ruta responde en streaming: si la IA falla después de empezar, el error llega con status 200
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error || `Error ${res.status} al generar el diagnóstico`);

      const result: AiData = { fecha: json.generado, diagnostico: json.diagnostico, recomendaciones: json.recomendaciones };
      setData(result);
      try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* sin caché */ }
    } catch (e: unknown) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      setError(aborted ? 'La IA tardó demasiado en responder. Intenta de nuevo.' : e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [items, cacheKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    generate(false);
  }, [generate]);

  // Si no hay items en el portafolio, no mostrar diagnóstico fantasma
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

  if (loading) return <div className="text-center p-12 font-mono text-zinc-600 dark:text-zinc-400">La IA está analizando tu portafolio (puede tardar hasta un minuto)...</div>;

  function renderAiData(aiData: AiData) {
    return (
      <div className="space-y-6">

        <div className="bg-blue-50 dark:bg-blue-900/10 border-l-4 border-l-blue-500 border-y border-r border-blue-200 dark:border-blue-900/30 p-5 rounded-md shadow-sm">
          <h3 className="text-xs font-sans font-bold tracking-tight text-blue-700 dark:text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <span className="text-lg">🤖</span> Diagnóstico General de Mi Portafolio
          </h3>
          <p className="text-sm font-sans text-blue-900 dark:text-blue-100 leading-relaxed">
            {aiData.diagnostico}
          </p>
          <p className="text-[10px] font-mono text-blue-600/70 dark:text-blue-400/60 mt-4 uppercase">
            Generado por IA: {new Date(aiData.fecha).toLocaleString()} · No constituye asesoría financiera
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {aiData.recomendaciones.map((rec, i) => {
          let borderColor = 'border-zinc-200 dark:border-zinc-800';
          let bgColor = 'bg-white dark:bg-zinc-900/30';
          let headerColor = 'text-zinc-900 dark:text-zinc-100';

          const act = rec.accion.toUpperCase();
          if (act.includes('BUY') || act.includes('🟢')) {
            borderColor = 'border-emerald-500/50 dark:border-emerald-500/30';
            bgColor = 'bg-emerald-50/30 dark:bg-emerald-950/10';
            headerColor = 'text-emerald-700 dark:text-emerald-400';
          } else if (act.includes('SELL') || act.includes('🔴')) {
            borderColor = 'border-red-500/50 dark:border-red-500/30';
            bgColor = 'bg-red-50/30 dark:bg-red-950/10';
            headerColor = 'text-red-700 dark:text-red-400';
          } else if (act.includes('HOLD') || act.includes('🟡')) {
            borderColor = 'border-amber-500/50 dark:border-amber-500/30';
            bgColor = 'bg-amber-50/30 dark:bg-amber-950/10';
            headerColor = 'text-amber-700 dark:text-amber-400';
          }

          return (
            <div key={i} className={`border ${borderColor} ${bgColor} rounded-xl p-5 flex flex-col md:flex-row gap-6 shadow-sm dark:shadow-none hover:shadow-md transition-shadow`}>

              {/* Left Column: Ticker & Action */}
              <div className="md:w-1/4 flex flex-col justify-center items-start border-b md:border-b-0 md:border-r border-zinc-200 dark:border-zinc-800/60 pb-5 md:pb-0 md:pr-5">
                <h4 className="font-mono font-bold text-2xl text-zinc-900 dark:text-zinc-100">{rec.ticker}</h4>
                <div className={`mt-3 font-sans font-bold text-sm px-4 py-1.5 border rounded-md shadow-sm ${borderColor} ${headerColor} bg-white dark:bg-zinc-950`}>
                  {rec.accion}
                </div>
              </div>

              {/* Right Column: Stop Loss & Analysis */}
              <div className="md:w-3/4 flex flex-col justify-center space-y-4">
                <div>
                  <h5 className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-1">🛡️ Stop Loss</h5>
                  <p className="text-sm font-sans font-medium text-zinc-900 dark:text-zinc-100 bg-white/50 dark:bg-zinc-950/30 inline-block px-3 py-1 rounded-sm border border-zinc-200 dark:border-zinc-800">
                    {rec.stop_loss}
                  </p>
                </div>
                <div>
                  <h5 className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-1">🧠 Análisis</h5>
                  <p className="text-sm font-sans text-zinc-700 dark:text-zinc-300 leading-relaxed">
                    {rec.analisis}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-end">
        <button
          onClick={() => generate(true)}
          className="bg-[#60a5fa] hover:bg-[#3b82f6] text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-2"
        >
          🔄 Re-generar Diagnóstico
        </button>
      </div>
      {error ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-red-600 dark:text-red-400 font-mono border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 rounded text-center">
          <p className="text-lg mb-2">⚠️ Diagnóstico no disponible</p>
          <p className="text-sm max-w-lg">{error}</p>
          <button onClick={() => generate(true)} className="mt-4 text-xs font-bold underline hover:no-underline">
            Reintentar
          </button>
        </div>
      ) : data ? renderAiData(data) : null}
    </div>
  );
}
