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
            <h2 className="text-lg font-mono text-[#e4e4e7] uppercase tracking-wider">Position Sizing Calculator</h2>
            <p className="text-[#a1a1aa] text-xs font-sans">Manage your risk strictly using the Fixed Fractional method.</p>
          </div>
        </div>

        <form onSubmit={calculateSizing} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-[#71717a] mb-1">Total Account Capital</label>
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
              <label className="block text-xs font-mono text-[#71717a] mb-1">Max Risk per Trade (%)</label>
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
              <label className="block text-xs font-mono text-[#71717a] mb-1">Entry Price</label>
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
              <label className="block text-xs font-mono text-[#71717a] mb-1">Stop Loss Price</label>
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
            CALCULATE SIZING
          </button>
        </form>
      </div>

      {result && (
        <div className="bg-[#09090b] border border-[#27272a] rounded p-6 shadow-lg">
          <h3 className="text-center text-xs font-mono text-[#71717a] uppercase tracking-widest mb-6">Recommendation for {ticker || 'Asset'}</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-[#27272a] text-center">
            
            <div className="flex flex-col items-center">
              <span className="text-[#a1a1aa] text-xs font-mono mb-2">Max Risk Amount</span>
              <span className="text-2xl font-bold font-mono text-[#f87171]">${result.riskAmount.toFixed(2)}</span>
            </div>

            <div className="flex flex-col items-center pt-4 md:pt-0">
              <span className="text-[#a1a1aa] text-xs font-mono mb-2">Recommended Shares</span>
              <span className="text-4xl font-bold font-mono text-[#34d399]">{result.shares}</span>
            </div>

            <div className="flex flex-col items-center pt-4 md:pt-0">
              <span className="text-[#a1a1aa] text-xs font-mono mb-2">Total Position Size</span>
              <span className="text-2xl font-bold font-mono text-[#60a5fa]">${result.positionSize.toFixed(2)}</span>
            </div>
            
          </div>
          
          <p className="mt-6 text-xs text-[#71717a] font-sans text-center">
            By buying {result.shares} shares, if the price drops to your stop loss (${stopLoss}), you will only lose exactly ${result.riskAmount.toFixed(2)} ({riskPercent}% of your capital).
          </p>
        </div>
      )}

    </div>
  );
}
