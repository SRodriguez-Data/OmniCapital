'use client';

import React, { useEffect, useState } from 'react';
import { Target, TrendingUp, ShieldAlert, Sparkles, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface TopOpportunity {
  ticker: string;
  precio_entrada_ideal: string;
  target_price: string;
  riesgo: string;
  justificacion: string;
}

export default function TopOportunidadesTab() {
  const [oportunidades, setOportunidades] = useState<TopOpportunity[]>([]);
  const [fecha, setFecha] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  useEffect(() => {
    async function fetchTop5() {
      try {
        const { data, error } = await supabase
          .from('analisis_ia')
          .select('*')
          .order('fecha', { ascending: false })
          .limit(1);

        if (!error && data && data.length > 0) {
          const report = data[0];
          setFecha(report.fecha);
          const top5 = report.candidatos_json?.top5_oportunidades || [];
          setOportunidades(top5);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchTop5();
  }, []);

  if (loading) return <div className="text-center p-12 font-mono text-[#a1a1aa]">Escaneando el mercado en busca de oportunidades...</div>;

  if (oportunidades.length === 0) {
    return (
      <div className="text-center p-12 bg-[#18181b] border border-[#27272a] rounded-sm max-w-4xl mx-auto">
        <AlertTriangle className="w-8 h-8 text-[#f59e0b] mx-auto mb-4" />
        <h3 className="text-lg font-mono text-[#e4e4e7] mb-2">Aún no hay oportunidades generadas</h3>
        <p className="text-sm font-sans text-[#a1a1aa]">La Inteligencia Artificial está procesando el mercado global y el IPSA. Vuelve en un momento.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      <div className="bg-[#18181b] border border-[#27272a] p-6 rounded-sm text-center relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Sparkles className="w-24 h-24 text-[#60a5fa]" />
        </div>
        <h2 className="text-xl font-mono font-bold text-[#60a5fa] mb-2 uppercase tracking-widest">
          Top 5 Oportunidades
        </h2>
        <p className="text-[#a1a1aa] text-sm font-sans max-w-xl mx-auto">
          Acciones y ETFs globales seleccionados algorítmicamente por sobreventa extrema extrema y validados por nuestra Inteligencia Artificial.
        </p>
        <p className="text-xs font-mono text-[#71717a] mt-4 uppercase">
          Última actualización: {new Date(fecha).toLocaleString()}
        </p>
      </div>

      <div className="space-y-4">
        {oportunidades.map((op, idx) => {
          const isExpanded = expandedIndex === idx;
          const isHighRisk = op.riesgo.toUpperCase().includes('ALTO');
          
          return (
            <div 
              key={idx} 
              className={`bg-[#09090b] border ${isExpanded ? 'border-[#60a5fa]' : 'border-[#27272a] hover:border-[#3f3f46]'} rounded-sm overflow-hidden transition-colors cursor-pointer`}
              onClick={() => setExpandedIndex(isExpanded ? null : idx)}
            >
              {/* Header */}
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-[#18181b] p-3 rounded font-mono font-bold text-xl text-[#e4e4e7] w-16 text-center border border-[#27272a]">
                    #{idx + 1}
                  </div>
                  <div>
                    <h3 className="font-mono text-2xl font-bold text-[#e4e4e7]">{op.ticker}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider ${isHighRisk ? 'bg-[#7f1d1d] text-[#fca5a5]' : 'bg-[#064e3b] text-[#6ee7b7]'}`}>
                        Riesgo {op.riesgo}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="hidden sm:flex text-right gap-6 font-mono">
                  <div>
                    <p className="text-[10px] text-[#71717a] uppercase tracking-widest">Entrada Ideal</p>
                    <p className="text-[#34d399] font-bold text-lg">{op.precio_entrada_ideal}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[#71717a] uppercase tracking-widest">Target Mínimo</p>
                    <p className="text-[#60a5fa] font-bold text-lg">{op.target_price}</p>
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="p-6 bg-[#18181b] border-t border-[#27272a] animate-in slide-in-from-top-2">
                  <div className="flex sm:hidden justify-between mb-6 font-mono border-b border-[#27272a] pb-4">
                    <div>
                      <p className="text-[10px] text-[#71717a] uppercase tracking-widest">Entrada</p>
                      <p className="text-[#34d399] font-bold text-lg">{op.precio_entrada_ideal}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-[#71717a] uppercase tracking-widest">Target</p>
                      <p className="text-[#60a5fa] font-bold text-lg">{op.target_price}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[#d946ef]">
                      <Sparkles className="w-4 h-4" />
                      <h4 className="text-xs font-mono font-bold uppercase tracking-widest">Tesis de Inversión</h4>
                    </div>
                    <p className="text-sm font-sans text-[#d4d4d8] leading-relaxed pl-6 border-l-2 border-[#27272a]">
                      {op.justificacion}
                    </p>
                  </div>
                  
                  {isHighRisk && (
                    <div className="mt-6 flex items-start gap-3 bg-[#2a1215] border border-[#7f1d1d] p-4 rounded-sm text-[#fca5a5]">
                      <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <p className="text-xs font-sans">
                        Este activo presenta una alta volatilidad. Asegúrate de gestionar el tamaño de tu posición de acuerdo a tu tolerancia al riesgo.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
