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

  useEffect(() => {
    fetchAI();
  }, []);

  const fetchAI = async () => {
    try {
      const { data: aiRes, error } = await supabase
        .from('analisis_ia')
        .select('*')
        .order('fecha', { ascending: false })
        .limit(1);

      if (!error && aiRes && aiRes.length > 0) {
        const report = aiRes[0];
        setData({
          fecha: report.fecha,
          diagnostico: report.vision_radar || "Sin diagnóstico.",
          recomendaciones: report.candidatos_json?.portafolio_recomendaciones || []
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="text-center p-12 font-mono text-[#a1a1aa]">Cargando análisis de IA...</div>;

  if (!data || data.recomendaciones.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[#71717a] font-mono border border-[#27272a] bg-[#09090b] rounded">
        <p>No se encontraron recomendaciones de IA para tu portafolio.</p>
        <p className="text-[10px] mt-2">Asegúrate de tener activos en el portafolio y ejecuta el bot de Python.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-[#18181b] border-l-4 border-l-[#60a5fa] border-y border-r border-[#27272a] p-4 rounded-sm">
        <h3 className="text-[10px] font-mono font-bold text-[#60a5fa] uppercase tracking-widest mb-2">Diagnóstico Global del Portafolio</h3>
        <p className="text-sm font-sans text-[#d4d4d8] leading-relaxed">
          {data.diagnostico}
        </p>
        <p className="text-[10px] font-mono text-[#71717a] mt-3 uppercase">Generado: {new Date(data.fecha).toLocaleString()}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.recomendaciones.map((rec, i) => {
          let borderColor = 'border-[#27272a]';
          let textColor = 'text-[#a1a1aa]';
          let bgColor = 'bg-[#18181b]';

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
            textColor = 'text-[#e4e4e7]';
            bgColor = 'bg-[#27272a]';
          }

          return (
            <div key={i} className="bg-[#09090b] border border-[#27272a] rounded-sm overflow-hidden flex flex-col">
              <div className={`p-3 border-b flex justify-between items-center ${borderColor} ${bgColor}`}>
                <h4 className="font-mono font-bold text-[#e4e4e7] text-lg">{rec.ticker}</h4>
                <span className={`font-mono text-xs font-bold px-2 py-1 border rounded-sm ${borderColor} ${textColor}`}>
                  {rec.accion}
                </span>
              </div>
              <div className="p-4 flex-1">
                <p className="text-sm font-sans text-[#a1a1aa] leading-relaxed">
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
