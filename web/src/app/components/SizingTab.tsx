'use client';

import React, { useState } from 'react';
import { Calculator, Sparkles, Loader2, TrendingUp } from 'lucide-react';

interface RebalanceRecommendation {
  ticker: string;
  sharesToBuy: number;
  expectedCost: number;
  rationale: string;
}

export default function SizingTab() {
  const [budget, setBudget] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recommendations, setRecommendations] = useState<RebalanceRecommendation[] | null>(null);

  const calculateRebalance = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setRecommendations(null);

    try {
      const res = await fetch('/api/rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget: Number(budget) })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Error al calcular rebalanceo');
      }

      setRecommendations(data.recommendations);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      <div className="bg-[#18181b] border border-[#27272a] rounded p-6">
        <div className="flex items-center gap-3 mb-6 border-b border-[#27272a] pb-4">
          <Calculator className="w-6 h-6 text-[#60a5fa]" />
          <div>
            <h2 className="text-lg font-mono text-[#e4e4e7] uppercase tracking-wider flex items-center gap-2">
              Optimizador de Rebalanceo IA <Sparkles className="w-4 h-4 text-[#d946ef]" />
            </h2>
            <p className="text-[#a1a1aa] text-xs font-sans">
              Google Gemini analizará tu portafolio actual y los precios del mercado para recomendarte matemáticamente cómo invertir tu nuevo capital.
            </p>
          </div>
        </div>

        <form onSubmit={calculateRebalance} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-[#71717a] mb-1">Nuevo Capital a Invertir (USD o CLP)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#71717a]">$</span>
              <input 
                type="number" 
                required
                value={budget}
                onChange={e => setBudget(e.target.value)}
                className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 pl-8 font-mono text-lg focus:outline-none focus:border-[#60a5fa]"
                placeholder="1000"
              />
            </div>
          </div>

          <button 
            type="submit"
            disabled={loading || !budget}
            className="w-full mt-6 flex items-center justify-center gap-2 bg-[#60a5fa] hover:bg-[#3b82f6] disabled:bg-[#27272a] disabled:text-[#71717a] text-[#09090b] px-6 py-4 font-bold font-mono transition-colors"
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

      {recommendations && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-[#09090b] border border-[#27272a] rounded overflow-hidden">
            <div className="px-6 py-4 border-b border-[#27272a] bg-[#18181b]">
              <h3 className="text-sm font-mono text-[#e4e4e7] uppercase tracking-widest flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#34d399]" />
                Órdenes de Compra Sugeridas
              </h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm font-sans">
                <thead className="bg-[#18181b] text-[#71717a] font-mono text-xs uppercase">
                  <tr>
                    <th className="px-6 py-3 font-medium">Activo</th>
                    <th className="px-6 py-3 font-medium text-right">Cantidad</th>
                    <th className="px-6 py-3 font-medium text-right">Costo Estimado</th>
                    <th className="px-6 py-3 font-medium">Justificación IA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#27272a]">
                  {recommendations.map((rec, i) => (
                    <tr key={i} className="hover:bg-[#18181b]/50 transition-colors">
                      <td className="px-6 py-4 font-mono font-bold text-[#e4e4e7]">{rec.ticker}</td>
                      <td className="px-6 py-4 font-mono text-[#34d399] text-right">+{rec.sharesToBuy}</td>
                      <td className="px-6 py-4 font-mono text-[#a1a1aa] text-right">${rec.expectedCost.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                      <td className="px-6 py-4 text-[#a1a1aa] text-xs">{rec.rationale}</td>
                    </tr>
                  ))}
                  {recommendations.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-[#71717a] font-mono">
                        No se sugirieron compras. Quizás el capital es insuficiente para adquirir acciones completas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="bg-[#18181b] border border-[#27272a] p-4 text-xs text-[#71717a] font-mono text-center">
            Total Asignado: <span className="text-[#e4e4e7] font-bold">${recommendations.reduce((acc, r) => acc + r.expectedCost, 0).toLocaleString()}</span> de ${budget} ingresados.
          </div>
        </div>
      )}

    </div>
  );
}
