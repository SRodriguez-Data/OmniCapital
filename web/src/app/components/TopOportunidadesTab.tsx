'use client';

import React, { useEffect, useState } from 'react';
import { Target, TrendingUp, ShieldAlert, Sparkles, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import ReactMarkdown from 'react-markdown';
import { usePortfolio } from '../context/PortfolioContext';

interface TopOpportunity {
  ticker: string;
  precio_entrada_ideal: string;
  target_price: string;
  riesgo: string;
  price: number;
  rsi: number;
  distancia_ema200: number;
  score: number;
  pe: string | number;
  div_str: string;
  deuda: string | number;
}

export default function TopOportunidadesTab() {
  const { isDemo, items } = usePortfolio();
  const [oportunidades, setOportunidades] = useState<TopOpportunity[]>([]);
  const [fecha, setFecha] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [theses, setTheses] = useState<Record<string, { loading: boolean; content: string; error?: string }>>({});

  useEffect(() => {
    async function fetchTop5() {
      try {
        if (isDemo) {
          setOportunidades([
            { ticker: 'AMZN', precio_entrada_ideal: '$130.00', target_price: '$160.00', riesgo: 'MODERADO', price: 135.00, rsi: 35, distancia_ema200: -5, score: 85, pe: 45, div_str: '0%', deuda: 0.5 },
            { ticker: 'GOOGL', precio_entrada_ideal: '$120.00', target_price: '$145.00', riesgo: 'BAJO', price: 125.00, rsi: 40, distancia_ema200: -2, score: 80, pe: 25, div_str: '0%', deuda: 0.1 },
            { ticker: 'AAPL', precio_entrada_ideal: '$165.00', target_price: '$190.00', riesgo: 'BAJO', price: 170.00, rsi: 42, distancia_ema200: 1, score: 75, pe: 28, div_str: '0.5%', deuda: 1.1 },
            { ticker: 'TSLA', precio_entrada_ideal: '$180.00', target_price: '$250.00', riesgo: 'ALTO', price: 195.00, rsi: 30, distancia_ema200: -15, score: 90, pe: 65, div_str: '0%', deuda: 0.8 },
            { ticker: 'SQM-B.SN', precio_entrada_ideal: '$38000', target_price: '$50000', riesgo: 'ALTO', price: 40000, rsi: 28, distancia_ema200: -20, score: 95, pe: 8, div_str: '10%', deuda: 0.3 }
          ]);
          setFecha(new Date().toISOString().split('T')[0]);
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from('analisis_ia')
          .select('*')
          .order('fecha', { ascending: false })
          .limit(1)
          .gt('id', '00000000-0000-0000-0000-000000000000'); // Force new query cache buster

        if (!error && data && data.length > 0) {
          const report = data[0];
          setFecha(report.fecha);
          
          let top5: TopOpportunity[] = [];
          if (report.candidatos_json) {
            const us = report.candidatos_json.us || [];
            const cl = report.candidatos_json.cl || [];
            const combined = [...us, ...cl];
            let sorted = combined.sort((a, b) => b.score - a.score).slice(0, 5);
            
            // Garantizar al menos una acción chilena (.SN)
            const hasChilean = sorted.some((c: any) => c.ticker.endsWith('.SN'));
            if (!hasChilean && cl.length > 0) {
               const bestCl = cl.sort((a: any, b: any) => b.score - a.score)[0];
               sorted.push(bestCl); // Añadimos como sexta oportunidad
            }

            top5 = sorted.map((c: any) => ({
              ticker: c.ticker,
              precio_entrada_ideal: c.bollinger_lower ? `$${c.bollinger_lower.toFixed(2)}` : `$${c.price.toFixed(2)}`,
              target_price: c.bollinger_upper ? `$${c.bollinger_upper.toFixed(2)}` : `$${(c.price * 1.1).toFixed(2)}`,
              riesgo: c.distancia_ema200 < -0.1 ? 'ALTO' : 'MODERADO',
              price: c.price,
              rsi: c.rsi,
              distancia_ema200: c.distancia_ema200,
              score: c.score,
              pe: c.pe || 'N/A',
              div_str: c.div_str || '0.00%',
              deuda: c.deuda || 'N/A'
            }));
          }
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

  const generateThesis = async (op: TopOpportunity) => {
    if (theses[op.ticker]?.loading || theses[op.ticker]?.content) return;

    // Verificar caché local primero
    const cacheKey = `quantum_thesis_${op.ticker}_${fecha}`;
    const cachedThesis = localStorage.getItem(cacheKey);
    if (cachedThesis) {
      setTheses(prev => ({ ...prev, [op.ticker]: { loading: false, content: cachedThesis } }));
      return;
    }

    setTheses(prev => ({ ...prev, [op.ticker]: { loading: true, content: '' } }));

    try {
      const portfolioSummary = items.map(i => i.ticker).join(', ');
      
      const res = await fetch('/api/generate-thesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: op.ticker,
          price: op.price,
          rsi: op.rsi,
          ema200: op.distancia_ema200,
          score: op.score,
          pe: op.pe,
          div_str: op.div_str,
          deuda: op.deuda,
          portfolio: portfolioSummary
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar tesis');

      // Guardar en caché
      localStorage.setItem(cacheKey, data.thesis);
      setTheses(prev => ({ ...prev, [op.ticker]: { loading: false, content: data.thesis } }));
    } catch (e: any) {
      setTheses(prev => ({ ...prev, [op.ticker]: { loading: false, content: '', error: e.message } }));
    }
  };

  useEffect(() => {
    if (expandedIndex !== null && oportunidades[expandedIndex]) {
      generateThesis(oportunidades[expandedIndex]);
    }
  }, [expandedIndex, oportunidades]);

  if (loading) return <div className="text-center p-12 font-mono text-zinc-600 dark:text-[#a1a1aa]">Escaneando el mercado en busca de oportunidades...</div>;

  if (oportunidades.length === 0) {
    return (
      <div className="text-center p-12 bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none-sm max-w-4xl mx-auto">
        <AlertTriangle className="w-8 h-8 text-[#f59e0b] mx-auto mb-4" />
        <h3 className="text-lg font-sans font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7] mb-2">Aún no hay oportunidades generadas</h3>
        <p className="text-sm font-sans text-zinc-600 dark:text-[#a1a1aa]">La Inteligencia Artificial está procesando el mercado global y el IPSA. Vuelve en un momento.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] p-6 rounded-sm text-center relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <Sparkles className="w-24 h-24 text-[#60a5fa]" />
        </div>
        <h2 className="text-xl font-sans font-bold tracking-tight text-[#60a5fa] mb-2 uppercase tracking-widest">
          Top Oportunidades
        </h2>
        <p className="text-zinc-600 dark:text-[#a1a1aa] text-sm font-sans max-w-xl mx-auto">
          Acciones y ETFs globales seleccionados algorítmicamente por sobreventa extrema y validados por nuestra Inteligencia Artificial.
        </p>
        <p className="text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] mt-4 uppercase">
          Última actualización: {new Date(fecha).toLocaleString()}
        </p>
      </div>

      <div className="space-y-4">
        {oportunidades.map((op, idx) => {
          const isExpanded = expandedIndex === idx;
          const isHighRisk = op.riesgo.toUpperCase().includes('ALTO');
          const thesis = theses[op.ticker];
          
          return (
            <div 
              key={idx} 
              className={`bg-zinc-50 dark:bg-[#09090b] border ${isExpanded ? 'border-[#60a5fa]' : 'border-zinc-200 dark:border-[#27272a] hover:border-zinc-300 dark:border-[#3f3f46]'} rounded-sm overflow-hidden transition-colors cursor-pointer`}
              onClick={() => setExpandedIndex(isExpanded ? null : idx)}
            >
              {/* Header */}
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-white dark:bg-[#18181b] p-3 rounded font-sans font-bold tracking-tight text-xl text-zinc-900 dark:text-[#e4e4e7] w-16 text-center border border-zinc-200 dark:border-[#27272a]">
                    #{idx + 1}
                  </div>
                  <div>
                    <h3 className="font-mono text-2xl font-bold text-zinc-900 dark:text-[#e4e4e7]">{op.ticker}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider ${isHighRisk ? 'bg-[#7f1d1d] text-[#fca5a5]' : 'bg-[#064e3b] text-[#6ee7b7]'}`}>
                        Riesgo {op.riesgo}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="hidden sm:flex text-right gap-6 font-mono">
                  <div>
                    <p className="text-[10px] text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">Entrada Ideal</p>
                    <p className="text-[#34d399] font-bold text-lg">{op.precio_entrada_ideal}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">Target Mínimo</p>
                    <p className="text-[#60a5fa] font-bold text-lg">{op.target_price}</p>
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="p-6 bg-white dark:bg-[#18181b] border-t border-zinc-200 dark:border-[#27272a] animate-in slide-in-from-top-2 cursor-auto" onClick={(e) => e.stopPropagation()}>
                  <div className="flex sm:hidden justify-between mb-6 font-mono border-b border-zinc-200 dark:border-[#27272a] pb-4">
                    <div>
                      <p className="text-[10px] text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">Entrada</p>
                      <p className="text-[#34d399] font-bold text-lg">{op.precio_entrada_ideal}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">Target</p>
                      <p className="text-[#60a5fa] font-bold text-lg">{op.target_price}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[#d946ef]">
                        <Sparkles className="w-4 h-4" />
                        <h4 className="text-xs font-sans font-medium font-bold uppercase tracking-widest">✨ Tesis de Inversión</h4>
                      </div>
                      {!thesis?.content && !thesis?.loading && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); generateThesis(op); }}
                          className="text-[10px] font-mono px-3 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-white rounded transition-colors"
                        >
                          Generar Análisis
                        </button>
                      )}
                    </div>

                    <div className="text-sm font-sans text-[#d4d4d8] leading-relaxed pl-6 border-l-2 border-zinc-200 dark:border-[#27272a] min-h-[100px]">
                      {thesis?.loading ? (
                        <div className="flex flex-col items-center justify-center h-full space-y-3 py-6 text-zinc-500">
                          <Loader2 className="w-6 h-6 animate-spin text-[#60a5fa]" />
                          <p className="text-xs font-mono animate-pulse">Generando tesis de grado institucional...</p>
                        </div>
                      ) : thesis?.error ? (
                        <div className="text-red-400 p-4 bg-red-950/20 rounded-sm border border-red-900/50 flex flex-col items-center">
                          <AlertTriangle className="w-5 h-5 mb-2" />
                          <p className="text-xs">{thesis.error}</p>
                          <button 
                            onClick={() => generateThesis(op)}
                            className="mt-3 text-[10px] font-mono underline hover:text-red-300"
                          >
                            Reintentar
                          </button>
                        </div>
                      ) : thesis?.content ? (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-li:my-1 text-zinc-800 dark:text-zinc-200">
                          <ReactMarkdown>{thesis.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-zinc-500 italic">Haz clic en Generar Análisis para obtener la tesis predictiva.</p>
                      )}
                    </div>
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
