'use client';

import React, { useEffect, useState } from 'react';
import { ShieldAlert, Sparkles, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import ReactMarkdown from 'react-markdown';
import { usePortfolio } from '../context/PortfolioContext';
import { evidenciaTop5 } from '@/lib/evidencia';
import TopIdeasV2 from './TopIdeasV2';
import {
  type Candidato, type Historiales, type HistorialMetodo, SECTOR, fechaCorta, historialAnterior, lineaHistorial, normalizeYield,
  textoDeuda, textoPE, textoResultados,
} from './topFormato';

interface TopOpportunity {
  ticker: string;
  precio_entrada_ideal: string;
  target_price: string;
  riesgo: string;
  price: number;
  rsi: number | null;
  distancia_ema200: number | null;
  score: number | null;
  sinSenal: boolean;
  pe: string;
  div_str: string;
  deuda: string;
  resultados: { texto: string; pronto: boolean } | null;
  sector: string | null;
}

// Escaneos antiguos del bot guardaron el dividend yield multiplicado dos veces por 100 ("346.00%" en vez de 3,46%)
// Los tickers chilenos (.SN) cotizan en pesos; el resto en dólares
const precioDe = (ticker: string, n: number) => ticker.endsWith('.SN')
  ? `$${Math.round(n).toLocaleString('es-CL')}`
  : `US$${n.toFixed(2)}`;

// Historial del método anterior (escaneos antes del método v2)
function HistorialReal({ h }: { h: HistorialMetodo }) {
  const linea = (m: 'EE.UU.' | 'Chile') => lineaHistorial(h, m);
  return (
    <div className="mt-4 text-left text-xs font-sans text-zinc-600 dark:text-[#a1a1aa] border-t border-zinc-200 dark:border-[#27272a] pt-3 space-y-1">
      <p className="font-semibold text-zinc-800 dark:text-[#e4e4e7]">
        Historial real de las ideas publicadas aquí (desde {fechaCorta(h.desde)}, {h.escaneos} escaneos, comprando al cierre del día del escaneo)
      </p>
      <p>{linea('EE.UU.')}</p>
      <p>{linea('Chile')}</p>
      {h.excluidas_precio_congelado > 0 && (
        <p className="text-[11px] text-zinc-500 dark:text-[#71717a]">
          {h.excluidas_precio_congelado} ideas no se pudieron medir porque Yahoo tiene congelado su precio (casi todas chilenas).
        </p>
      )}
    </div>
  );
}

// Cómo le fue a este mismo método en los últimos 10 años (laboratorio de evidencia)
function HistorialMetodo() {
  const filas = (['EE.UU.', 'Chile'] as const).map(m => ({ m, e: evidenciaTop5(m) })).filter(x => x.e);
  if (!filas.length) return null;
  const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
  return (
    <div className="mt-4 text-left text-xs font-sans text-zinc-600 dark:text-[#a1a1aa] border-t border-zinc-200 dark:border-[#27272a] pt-3 space-y-1">
      <p className="font-semibold text-zinc-800 dark:text-[#e4e4e7]">Cómo le fue a este método ({filas[0].e!.anios}, 5 ideas por mes, 3 meses después, frente a su mercado)</p>
      {filas.map(({ m, e }) => (
        <p key={m}>
          {m}: {pct(e!.exceso)} en promedio, pero en la idea típica {pct(e!.mediana)}; le ganó al mercado {(e!.acierto * 100).toFixed(0)}% de las veces (una acción cualquiera: {(e!.base * 100).toFixed(0)}%).
        </p>
      ))}
      <p className="text-[11px] text-zinc-500 dark:text-[#71717a]">
        El promedio lo suben unos pocos rebotes grandes, y la medición favorece a las acciones que se recuperaron (las que siguieron cayendo y salieron del índice no están en los datos). Úsalas como ideas para investigar.
      </p>
    </div>
  );
}

export default function TopOportunidadesTab() {
  const { items } = usePortfolio();
  const [oportunidades, setOportunidades] = useState<TopOpportunity[]>([]);
  const [fecha, setFecha] = useState<string>('');
  const [historial, setHistorial] = useState<HistorialMetodo | null>(null);
  // Escaneo con el método actual (v2): otra vista, con su evidencia
  const [v2, setV2] = useState<{ us: Candidato[]; cl: Candidato[]; historial: Historiales | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [theses, setTheses] = useState<Record<string, { loading: boolean; content: string; error?: string }>>({});

  useEffect(() => {
    async function fetchTop5() {
      try {
        // El último escaneo del bot (GitHub Actions) es público: también se muestra en modo demo
        const { data, error } = await supabase
          .from('analisis_ia')
          .select('fecha, candidatos_json')
          .order('fecha', { ascending: false })
          .limit(1);

        if (!error && data && data.length > 0) {
          const report = data[0];
          setFecha(report.fecha);
          setHistorial(historialAnterior(report.candidatos_json?.historial));
          if (report.candidatos_json?.metodo === 'v2') {
            setV2({ us: report.candidatos_json.us ?? [], cl: report.candidatos_json.cl ?? [], historial: report.candidatos_json.historial ?? null });
            return;
          }
          
          let top5: TopOpportunity[] = [];
          if (report.candidatos_json) {
            const us: Candidato[] = report.candidatos_json.us || [];
            const cl: Candidato[] = report.candidatos_json.cl || [];
            const combined = [...us, ...cl];
            // Los sin señal técnica (RSI nulo: precios congelados en la fuente) no tienen score: van al final
            const sorted = combined.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)).slice(0, 5);

            // Garantizar al menos una acción chilena (.SN)
            const hasChilean = sorted.some(c => c.ticker.endsWith('.SN'));
            if (!hasChilean && cl.length > 0) {
               const bestCl = [...cl].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))[0];
               sorted.push(bestCl); // Añadimos como sexta oportunidad
            }

            top5 = sorted.map(c => ({
              ticker: c.ticker,
              precio_entrada_ideal: c.bollinger_lower ? precioDe(c.ticker, c.bollinger_lower) : 'N/D',
              target_price: c.bollinger_upper ? precioDe(c.ticker, c.bollinger_upper) : 'N/D',
              riesgo: c.distancia_ema200 == null ? 'N/D' : c.distancia_ema200 < -0.1 ? 'ALTO' : 'MODERADO',
              price: c.price,
              rsi: c.rsi ?? null,
              distancia_ema200: c.distancia_ema200 ?? null,
              score: c.score,
              sinSenal: c.rsi == null,
              pe: textoPE(c),
              div_str: normalizeYield(c.div_str),
              deuda: textoDeuda(c),
              resultados: textoResultados(c.proximos_resultados),
              sector: c.sector ? [SECTOR[c.sector] ?? c.sector, c.industria].filter(Boolean).join(' · ') : null,
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

    // Verificar caché local primero (v2: las tesis anteriores se escribieron con datos en blanco)
    const cacheKey = `quantum_thesis_v2_${op.ticker}_${fecha}`;
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
          sector: op.sector,
          resultados: op.resultados?.texto,
          portfolio: portfolioSummary
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar tesis');

      // Guardar en caché
      localStorage.setItem(cacheKey, data.thesis);
      setTheses(prev => ({ ...prev, [op.ticker]: { loading: false, content: data.thesis } }));
    } catch (e: unknown) {
      setTheses(prev => ({ ...prev, [op.ticker]: { loading: false, content: '', error: e instanceof Error ? e.message : 'Error al generar tesis' } }));
    }
  };

  useEffect(() => {
    if (expandedIndex !== null && oportunidades[expandedIndex]) {
      generateThesis(oportunidades[expandedIndex]);
    }
    // generateThesis no va en las dependencias a propósito: cambia con cada respuesta y,
    // si la tesis falla, provocaría reintentos infinitos. El usuario reintenta con el botón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedIndex, oportunidades]);

  if (loading) return <div className="text-center p-12 font-mono text-zinc-600 dark:text-[#a1a1aa]">Escaneando el mercado en busca de oportunidades...</div>;

  if (v2) return <TopIdeasV2 us={v2.us} cl={v2.cl} historial={v2.historial} fecha={fecha} />;

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
          Ideas del último escaneo automático: acciones y ETFs con señales técnicas de sobreventa (precio cerca de su banda inferior de Bollinger y RSI bajo). No consideran tu cartera, sus fundamentales ni noticias: son ideas para investigar, no recomendaciones de compra.
        </p>
        <p className="text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] mt-4 uppercase">
          Última actualización: {new Date(fecha).toLocaleString()}
        </p>
        {historial && <HistorialReal h={historial} />}
        <HistorialMetodo />
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
                        Riesgo técnico {op.riesgo}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a]">
                        RSI {op.rsi == null ? 'N/D' : op.rsi.toFixed(1)}
                      </span>
                      {op.sinSenal && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-[#422006] text-[#fcd34d]">
                          Sin señal técnica (datos de precio no confiables)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="hidden sm:flex text-right gap-6 font-mono">
                  <div>
                    <p className="text-[10px] text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">Banda inferior (20 días)</p>
                    <p className="text-[#34d399] font-bold text-lg">{op.precio_entrada_ideal}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">Banda superior (20 días)</p>
                    <p className="text-[#60a5fa] font-bold text-lg">{op.target_price}</p>
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="p-6 bg-white dark:bg-[#18181b] border-t border-zinc-200 dark:border-[#27272a] animate-in slide-in-from-top-2 cursor-auto" onClick={(e) => e.stopPropagation()}>
                  <div className="flex sm:hidden justify-between mb-6 font-mono border-b border-zinc-200 dark:border-[#27272a] pb-4">
                    <div>
                      <p className="text-[10px] text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">Banda inferior</p>
                      <p className="text-[#34d399] font-bold text-lg">{op.precio_entrada_ideal}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">Banda superior</p>
                      <p className="text-[#60a5fa] font-bold text-lg">{op.target_price}</p>
                    </div>
                  </div>

                  {op.sector && <p className="text-xs font-sans text-zinc-500 dark:text-[#a1a1aa] mb-3">{op.sector}</p>}
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 text-sm font-sans">
                    {[
                      ['P/E (precio / utilidad)', op.pe],
                      ['Dividendo anual', op.div_str],
                      ['Deuda / patrimonio', op.deuda],
                      ['Próximos resultados', op.resultados?.texto ?? 'Sin fecha anunciada en Yahoo'],
                    ].map(([label, valor]) => (
                      <div key={label} className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded-sm p-3">
                        <dt className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">{label}</dt>
                        <dd className="mt-1 text-zinc-900 dark:text-[#e4e4e7]">{valor}</dd>
                      </div>
                    ))}
                  </dl>
                  {op.resultados?.pronto && (
                    <div className="mb-6 flex items-start gap-3 bg-amber-50 dark:bg-[#422006] border border-amber-300 dark:border-[#78350f] p-3 rounded-sm text-amber-900 dark:text-[#fcd34d]">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <p className="text-xs font-sans">
                        Publica resultados {op.resultados.texto}. El precio suele moverse fuerte ese día, hacia arriba o hacia abajo: comprar antes es apostar al resultado.
                      </p>
                    </div>
                  )}

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
                          <p className="text-xs font-mono animate-pulse">Generando análisis con IA...</p>
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
                        <p className="text-zinc-500 italic">Haz clic en Generar Análisis para obtener un análisis redactado por IA (no es una predicción).</p>
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
