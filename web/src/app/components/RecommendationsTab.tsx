/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

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

export default function RecommendationsTab() {
  const [data, setData] = useState<AiData | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchAI() {
    try {
      const { data: aiRes, error } = await supabase
        .from('analisis_ia')
        .select('*')
        .order('fecha', { ascending: false })
        .limit(1);

      if (!error && aiRes && aiRes.length > 0) {
        const report = aiRes[0];
        
        let parsedRecs: Recommendation[] = [];
        if (report.candidatos_json && report.candidatos_json.recomendaciones_portafolio && report.candidatos_json.recomendaciones_portafolio.length > 0) {
          parsedRecs = report.candidatos_json.recomendaciones_portafolio.map((c: any) => ({
            ticker: c.ticker,
            accion: c.accion || '🟡 HOLD',
            stop_loss: c.stop_loss || 'Sin datos de stop loss de emergencia.',
            analisis: c.analisis || c.razon || 'Sin análisis detallado.'
          }));
        } else if (report.candidatos_json) {
          // Fallback to global top anomalies if no specific portfolio analysis exists yet
          const combined = [...(report.candidatos_json.us || []), ...(report.candidatos_json.cl || [])];
          parsedRecs = combined.map(c => ({
            ticker: c.ticker,
            accion: c.signal || (c.score > 50 ? '🟢 BUY' : '🟡 HOLD'),
            stop_loss: 'No aplicable (Activo sugerido, no en portafolio)',
            analisis: (report.insights_tickers && report.insights_tickers[c.ticker]) || `Oportunidad técnica detectada. Score: ${c.score.toFixed(1)}`
          }));
        }

        setData({
          fecha: report.fecha,
          diagnostico: (report.candidatos_json && report.candidatos_json.diagnostico_portafolio) ? report.candidatos_json.diagnostico_portafolio : (report.vision_radar || "Sin diagnóstico."),
          recomendaciones: parsedRecs
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAI();
  }, []);

  if (loading) return <div className="text-center p-12 font-mono text-zinc-600 dark:text-zinc-400">Cargando análisis de IA...</div>;

  if (!data || data.recomendaciones.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500 dark:text-zinc-400 font-mono border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 rounded">
        <p>No se encontraron recomendaciones de IA para tu portafolio.</p>
        <p className="text-[10px] mt-2">Asegúrate de tener activos en el portafolio y ejecuta el bot de Python.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Equivalente a st.info() usando Tailwind para que adapte a Light/Dark Mode */}
      <div className="bg-blue-50 dark:bg-blue-900/10 border-l-4 border-l-blue-500 border-y border-r border-blue-200 dark:border-blue-900/30 p-5 rounded-md shadow-sm">
        <h3 className="text-xs font-sans font-bold tracking-tight text-blue-700 dark:text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2">
          <span className="text-lg">ℹ️</span> Diagnóstico General de Mi Portafolio
        </h3>
        <p className="text-sm font-sans text-blue-900 dark:text-blue-100 leading-relaxed">
          {data.diagnostico}
        </p>
        <p className="text-[10px] font-mono text-blue-600/70 dark:text-blue-400/60 mt-4 uppercase">
          Generado: {new Date(data.fecha).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {data.recomendaciones.map((rec, i) => {
          // Colores por defecto para bordes y fondos sutiles que adaptan al tema actual (Light/Dark)
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
                  <h5 className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-1">🧠 Análisis Quirúrgico</h5>
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
