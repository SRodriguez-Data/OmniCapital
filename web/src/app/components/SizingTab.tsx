'use client';

import React, { useState } from 'react';
import { Calculator, Sparkles, Loader2, TrendingUp } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';

interface RebalanceRecommendation {
  ticker: string;
  nombre?: string;
  origen: 'EN_CARTERA' | 'OPORTUNIDAD';
  accion: 'AUMENTAR' | 'MANTENER' | 'REDUCIR';
  sharesToBuy: number;
  price: number;
  expectedCost: number;
  pesoAntes: number;
  pesoDespues: number;
  rationale: string;
}

interface RebalanceResult {
  recommendations: RebalanceRecommendation[];
  excluidos: { ticker: string; motivo: string }[];
  currency: 'USD' | 'CLP';
  budget: number;
  totalCost: number;
  resumen: string | null;
  modelo: string | null;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function SizingTab() {
  const { items } = usePortfolio();
  const [budget, setBudget] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'CLP'>('USD');
  const [fraccionar, setFraccionar] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RebalanceResult | null>(null);

  const fmt = (n: number, cur: 'USD' | 'CLP') => cur === 'CLP'
    ? `$${Math.round(n).toLocaleString('es-CL')} CLP`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;

  const calculateRebalance = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      if (items.length === 0) throw new Error('Tu portafolio está vacío. Agrega activos primero.');

      const res = await fetch('/api/rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget: Number(budget), currency, fraccionar, items })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al calcular rebalanceo');
      }

      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };
  const recommendations = result?.recommendations;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none p-6">
        <div className="flex items-center gap-3 mb-6 border-b border-zinc-200 dark:border-[#27272a] pb-4">
          <Calculator className="w-6 h-6 text-[#60a5fa]" />
          <div>
            <h2 className="text-lg font-sans font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7] uppercase tracking-wider flex items-center gap-2">
              Optimizador de Rebalanceo IA <Sparkles className="w-4 h-4 text-[#d946ef]" />
            </h2>
            <p className="text-zinc-600 dark:text-[#a1a1aa] text-xs font-sans">
              Reparte tu nuevo capital sin vender nada: cada activo recibe un peso objetivo según su riesgo (menos volatilidad, más peso) y la señal de tu informe, y se compra solo lo que está bajo ese objetivo. Precios reales; nunca supera tu presupuesto.
            </p>
          </div>
        </div>

        <form onSubmit={calculateRebalance} className="space-y-4">
          <div>
            <label className="block text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] mb-1">Nuevo Capital a Invertir</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-[#71717a]">$</span>
                <input
                  type="number"
                  required
                  min="0"
                  step="any"
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] text-zinc-900 dark:text-[#e4e4e7] p-3 pl-8 font-mono text-lg focus:outline-none focus:border-[#60a5fa]"
                  placeholder={currency === 'CLP' ? '1000000' : '1000'}
                />
              </div>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value as 'USD' | 'CLP')}
                className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] text-zinc-900 dark:text-[#e4e4e7] px-3 font-mono focus:outline-none focus:border-[#60a5fa]"
              >
                <option value="USD">USD</option>
                <option value="CLP">CLP</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-[#a1a1aa] cursor-pointer select-none">
            <input type="checkbox" checked={fraccionar} onChange={e => setFraccionar(e.target.checked)} className="accent-[#60a5fa]" />
            Permitir fracciones de acciones de EE.UU. (Racional y la mayoría de los corredores lo permiten; las chilenas siempre van enteras)
          </label>

          <button 
            type="submit"
            disabled={loading || !budget}
            className="w-full mt-6 flex items-center justify-center gap-2 bg-[#60a5fa] hover:bg-[#3b82f6] disabled:bg-[#27272a] disabled:text-zinc-500 dark:text-[#71717a] text-[#09090b] px-6 py-4 font-bold font-mono transition-colors"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'GENERAR ASIGNACIÓN ÓPTIMA'}
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-[#f87171]/10 border border-[#f87171]/50 text-[#f87171] p-4 rounded text-sm font-mono">
          [ERROR] {error}
        </div>
      )}

      {result && recommendations && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-[#27272a] bg-white dark:bg-[#18181b]">
              <h3 className="text-sm font-mono text-zinc-900 dark:text-[#e4e4e7] uppercase tracking-widest flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#34d399]" />
                Órdenes de Compra Sugeridas
              </h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm font-sans">
                <thead className="bg-white dark:bg-[#18181b] text-zinc-500 dark:text-[#71717a] font-mono text-xs uppercase">
                  <tr>
                    <th className="px-6 py-3 font-medium">Activo</th>
                    <th className="px-6 py-3 font-medium text-right">Cantidad</th>
                    <th className="px-6 py-3 font-medium text-right">Precio Actual</th>
                    <th className="px-6 py-3 font-medium text-right">Costo</th>
                    <th className="px-6 py-3 font-medium text-right">Peso</th>
                    <th className="px-6 py-3 font-medium">Por qué</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a]">
                  {recommendations.map((rec, i) => (
                    <tr key={i} className="hover:bg-white dark:hover:bg-[#18181b]/50 transition-colors">
                      <td className="px-6 py-4 font-sans font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7]">
                        {rec.ticker}
                        {rec.origen === 'OPORTUNIDAD' && (
                          <span className="ml-2 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300">Nueva</span>
                        )}
                        {rec.nombre && <p className="text-[11px] font-normal text-zinc-500 dark:text-[#71717a] max-w-[180px] truncate">{rec.nombre}</p>}
                      </td>
                      <td className="px-6 py-4 font-mono text-[#34d399] text-right">+{rec.sharesToBuy.toLocaleString('es-CL', { maximumFractionDigits: 4 })}</td>
                      <td className="px-6 py-4 font-mono text-zinc-600 dark:text-[#a1a1aa] text-right">{fmt(rec.price, result.currency)}</td>
                      <td className="px-6 py-4 font-mono text-zinc-600 dark:text-[#a1a1aa] text-right">{fmt(rec.expectedCost, result.currency)}</td>
                      <td className="px-6 py-4 font-mono text-zinc-600 dark:text-[#a1a1aa] text-right whitespace-nowrap">{pct(rec.pesoAntes)} → {pct(rec.pesoDespues)}</td>
                      <td className="px-6 py-4 text-zinc-600 dark:text-[#a1a1aa] text-xs">{rec.rationale}</td>
                    </tr>
                  ))}
                  {recommendations.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-zinc-500 dark:text-[#71717a] font-mono">
                        No se sugirieron compras: el capital no alcanza para una acción completa de los activos elegidos. Prueba con un monto mayor o permite fracciones.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          {result.resumen && (
            <div className="bg-blue-50 dark:bg-blue-900/10 border-l-4 border-l-blue-500 border-y border-r border-blue-200 dark:border-blue-900/30 p-4 rounded-md">
              <p className="text-sm text-blue-900 dark:text-blue-100 leading-relaxed">{result.resumen}</p>
              {result.modelo && <p className="text-[10px] font-mono text-blue-600/70 dark:text-blue-400/60 mt-2 uppercase">Redactado por IA ({result.modelo}) · el plan es calculado</p>}
            </div>
          )}

          {result.excluidos.length > 0 && (
            <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] p-4 rounded text-xs text-zinc-600 dark:text-[#a1a1aa]">
              <p className="font-mono uppercase text-zinc-500 dark:text-[#71717a] mb-2">No se compran</p>
              <ul className="space-y-1">
                {result.excluidos.map(e => <li key={e.ticker}><span className="font-bold text-zinc-900 dark:text-[#e4e4e7]">{e.ticker}</span>: {e.motivo}</li>)}
              </ul>
            </div>
          )}

          <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] p-4 text-xs text-zinc-500 dark:text-[#71717a] font-mono text-center">
            Total Asignado: <span className="text-zinc-900 dark:text-[#e4e4e7] font-bold">{fmt(result.totalCost, result.currency)}</span> de {fmt(result.budget, result.currency)} · Sobrante: {fmt(result.budget - result.totalCost, result.currency)}
          </div>
        </div>
      )}

    </div>
  );
}
