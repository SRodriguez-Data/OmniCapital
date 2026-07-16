'use client';

import React, { useState } from 'react';
import { Calculator } from 'lucide-react';

export default function SizingTab() {
  const [capital, setCapital] = useState('');
  const [riskPercent, setRiskPercent] = useState('1'); // 1% risk rule standard
  const [ticker, setTicker] = useState('');
  
  const [price, setPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');

  const [result, setResult] = useState<{shares: number, positionSize: number, riskAmount: number} | null>(null);

  const calculateSizing = (e: React.FormEvent) => {
    e.preventDefault();
    
    const cap = Number(capital);
    const risk = Number(riskPercent);
    const px = Number(price);
    const sl = Number(stopLoss);

    if (cap > 0 && risk > 0 && px > 0 && sl > 0 && px > sl) {
      const riskAmount = cap * (risk / 100);
      const riskPerShare = px - sl;
      const shares = Math.floor(riskAmount / riskPerShare);
      const positionSize = shares * px;

      setResult({
        shares,
        positionSize,
        riskAmount
      });
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      
      <div className="bg-[#18181b] border border-[#27272a] rounded p-6">
        <div className="flex items-center gap-3 mb-6 border-b border-[#27272a] pb-4">
          <Calculator className="w-6 h-6 text-[#60a5fa]" />
          <div>
            <h2 className="text-lg font-mono text-[#e4e4e7] uppercase tracking-wider">Calculadora de Tamaño de Posición</h2>
            <p className="text-[#a1a1aa] text-xs font-sans">Gestiona tu riesgo estrictamente usando el método Fraccional Fijo.</p>
          </div>
        </div>

        <form onSubmit={calculateSizing} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-[#71717a] mb-1">Capital Total de la Cuenta</label>
              <input 
                type="number" 
                required
                value={capital}
                onChange={e => setCapital(e.target.value)}
                className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 font-mono focus:outline-none focus:border-[#60a5fa]"
                placeholder="Ej: 10000"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-[#71717a] mb-1">Riesgo Máx. por Operación (%)</label>
              <input 
                type="number" 
                required
                step="0.1"
                value={riskPercent}
                onChange={e => setRiskPercent(e.target.value)}
                className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 font-mono focus:outline-none focus:border-[#60a5fa]"
                placeholder="1.0"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-[#71717a] mb-1">Ticker (Opcional)</label>
              <input 
                type="text" 
                value={ticker}
                onChange={e => setTicker(e.target.value)}
                className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 font-mono uppercase focus:outline-none focus:border-[#60a5fa]"
                placeholder="AAPL"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-[#71717a] mb-1">Precio de Entrada</label>
              <input 
                type="number" 
                required
                step="0.01"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 font-mono focus:outline-none focus:border-[#60a5fa]"
                placeholder="150.00"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-[#71717a] mb-1">Precio Stop Loss</label>
              <input 
                type="number" 
                required
                step="0.01"
                value={stopLoss}
                onChange={e => setStopLoss(e.target.value)}
                className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 font-mono focus:outline-none focus:border-[#60a5fa]"
                placeholder="140.00"
              />
            </div>
          </div>

          <button 
            type="submit"
            className="w-full mt-6 bg-[#60a5fa] hover:bg-[#3b82f6] text-[#09090b] px-6 py-3 font-bold font-mono transition-colors"
          >
            CALCULAR POSICIÓN
          </button>
        </form>
      </div>

      {result && (
        <div className="bg-[#09090b] border border-[#27272a] rounded p-6 shadow-lg">
          <h3 className="text-center text-xs font-mono text-[#71717a] uppercase tracking-widest mb-6">Recomendación para {ticker || 'Activo'}</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-[#27272a] text-center">
            
            <div className="flex flex-col items-center">
              <span className="text-[#a1a1aa] text-xs font-mono mb-2">Pérdida Máxima</span>
              <span className="text-2xl font-bold font-mono text-[#f87171]">${result.riskAmount.toFixed(2)}</span>
            </div>

            <div className="flex flex-col items-center pt-4 md:pt-0">
              <span className="text-[#a1a1aa] text-xs font-mono mb-2">Acciones a Comprar</span>
              <span className="text-4xl font-bold font-mono text-[#34d399]">{result.shares}</span>
            </div>

            <div className="flex flex-col items-center pt-4 md:pt-0">
              <span className="text-[#a1a1aa] text-xs font-mono mb-2">Capital Invertido</span>
              <span className="text-2xl font-bold font-mono text-[#60a5fa]">${result.positionSize.toFixed(2)}</span>
            </div>
            
          </div>
          
          <p className="mt-6 text-xs text-[#71717a] font-sans text-center">
            Al comprar {result.shares} acciones, si el precio cae hasta tu Stop Loss (${stopLoss}), solo perderás exactamente ${result.riskAmount.toFixed(2)} ({riskPercent}% de tu capital total).
          </p>
        </div>
      )}

    </div>
  );
}
