/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Recommendation {
  ticker: string;
  accion: 'BUY' | 'SELL' | 'HOLD';
  razon: string;
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
            accion: c.accion || 'HOLD',
            razon: c.razon || 'Sin justificación detallada.'
          }));
        } else if (report.candidatos_json) {
          // Fallback to global top anomalies if no specific portfolio analysis exists yet
          const combined = [...(report.candidatos_json.us || []), ...(report.candidatos_json.cl || [])];
          parsedRecs = combined.map(c => ({
            ticker: c.ticker,
            accion: c.signal || (c.score > 50 ? 'BUY' : 'HOLD'),
            razon: (report.insights_tickers && report.insights_tickers[c.ticker]) || `Oportunidad técnica detectada. Score: ${c.score.toFixed(1)}`
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

  if (loading) return <div className="text-center p-12 font-mono text-zinc-600 dark:text-[#a1a1aa]">Cargando análisis de IA...</div>;

  if (!data || data.recomendaciones.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500 dark:text-[#71717a] font-mono border border-zinc-200 dark:border-[#27272a] bg-zinc-50 dark:bg-[#09090b] rounded">
        <p>No se encontraron recomendaciones de IA para tu portafolio.</p>
        <p className="text-[10px] mt-2">Asegúrate de tener activos en el portafolio y ejecuta el bot de Python.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#18181b] border-l-4 border-l-[#60a5fa] border-y border-r border-zinc-200 dark:border-[#27272a] p-4 rounded-sm">
        <h3 className="text-[10px] font-sans font-bold tracking-tight text-[#60a5fa] uppercase tracking-widest mb-2">Diagnóstico de Mi Portafolio</h3>
        <p className="text-sm font-sans text-[#d4d4d8] leading-relaxed">
          {data.diagnostico}
        </p>
        <p className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a] mt-3 uppercase">Generado: {new Date(data.fecha).toLocaleString()}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.recomendaciones.map((rec, i) => {
          let borderColor = 'border-zinc-200 dark:border-[#27272a]';
          let textColor = 'text-zinc-600 dark:text-[#a1a1aa]';
          let bgColor = 'bg-white dark:bg-[#18181b]';

          if (rec.accion === 'BUY') {
            borderColor = 'border-[#047857]';
            textColor = 'text-[#34d399]';
            bgColor = 'bg-[#064e3b]';
          } else if (rec.accion === 'SELL') {
            borderColor = 'border-[#b91c1c]';
            textColor = 'text-[#f87171]';
            bgColor = 'bg-[#7f1d1d]';
          } else if (rec.accion === 'HOLD') {
            borderColor = 'border-[#52525b]';
            textColor = 'text-zinc-900 dark:text-[#e4e4e7]';
            bgColor = 'bg-[#27272a]';
          }

          return (
            <div key={i} className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded-sm overflow-hidden flex flex-col">
              <div className={`p-3 border-b flex justify-between items-center ${borderColor} ${bgColor}`}>
                <h4 className="font-sans font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7] text-lg">{rec.ticker}</h4>
                <span className={`font-mono text-xs font-bold px-2 py-1 border rounded-sm ${borderColor} ${textColor}`}>
                  {rec.accion}
                </span>
              </div>
              <div className="p-4 flex-1">
                <p className="text-sm font-sans text-zinc-600 dark:text-[#a1a1aa] leading-relaxed">
                  {rec.razon}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
