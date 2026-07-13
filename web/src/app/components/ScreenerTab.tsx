'use client';

import React, { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';

interface MarketData {
  ticker: string;
  name: string;
  currentPrice: number;
  currency: string;
  bollingerLower: number;
  bollingerUpper: number;
  ema200: number | null;
  volatility: number;
  riskLevel: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  error?: string;
}

export default function ScreenerTab() {
  const [ticker, setTicker] = useState('');
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) return;
    
    setLoading(true);
    setError('');
    setData(null);

    try {
      const res = await fetch(`/api/market?ticker=${encodeURIComponent(ticker)}`);
      const json = await res.json();
      
      if (!res.ok) {
        setError(json.error || 'Ticker no encontrado o sin suficientes datos.');
      } else {
        setData(json);
      }
    } catch (e) {
      setError('Error de red al consultar el mercado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-[#18181b] border border-[#27272a] p-6 rounded-sm text-center">
        <h2 className="text-lg font-mono text-[#e4e4e7] mb-2">Global Technical Screener</h2>
        <p className="text-[#a1a1aa] text-sm font-sans mb-6">Search any global equity or ETF to calculate instant Value Zones.</p>
        
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 max-w-xl mx-auto">
          <input 
            type="text" 
            placeholder="Ej: AAPL, TSLA, SQM-B.SN"
            value={ticker}
            onChange={e => setTicker(e.target.value)}
            className="flex-1 bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 font-mono focus:outline-none focus:border-[#60a5fa] text-center sm:text-left uppercase"
          />
          <button 
            type="submit"
            disabled={loading || !ticker}
            className="bg-[#60a5fa] hover:bg-[#3b82f6] text-[#09090b] px-6 py-3 font-bold font-mono transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            ANALYZE
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-[#7f1d1d] border border-[#b91c1c] text-[#fca5a5] p-4 text-sm font-mono text-center">
          {error}
        </div>
      )}

      {data && (
        <div className="bg-[#09090b] border border-[#27272a] rounded-sm overflow-hidden">
          <div className="bg-[#18181b] p-4 border-b border-[#27272a] flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
              <h3 className="font-mono text-2xl font-bold text-[#e4e4e7]">{data.ticker}</h3>
              <p className="text-xs font-sans text-[#a1a1aa]">{data.name}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-3xl font-bold text-[#e4e4e7]">
                ${data.currentPrice.toFixed(2)} <span className="text-sm text-[#71717a]">{data.currency}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#27272a]">
            
            <div className="p-6 flex flex-col items-center text-center">
              <p className="text-[10px] font-mono text-[#71717a] uppercase tracking-widest mb-2">Ideal Buy Limit (LBB)</p>
              <p className="font-mono text-2xl font-bold text-[#34d399]">${data.bollingerLower.toFixed(2)}</p>
              <p className="text-xs text-[#a1a1aa] mt-2 font-sans">Wait for price to drop below this level for optimal entry.</p>
            </div>

            <div className="p-6 flex flex-col items-center text-center bg-[#18181b]">
              <p className="text-[10px] font-mono text-[#71717a] uppercase tracking-widest mb-2">Fair Value (EMA200)</p>
              <p className="font-mono text-2xl font-bold text-[#60a5fa]">{data.ema200 ? `$${data.ema200.toFixed(2)}` : 'N/A'}</p>
              <p className="text-xs text-[#a1a1aa] mt-2 font-sans">Long-term mean regression baseline.</p>
            </div>

            <div className="p-6 flex flex-col items-center text-center">
              <p className="text-[10px] font-mono text-[#71717a] uppercase tracking-widest mb-2">Max Sell Target (UBB)</p>
              <p className="font-mono text-2xl font-bold text-[#f87171]">${data.bollingerUpper.toFixed(2)}</p>
              <p className="text-xs text-[#a1a1aa] mt-2 font-sans">Take profit zone if price over-extends.</p>
            </div>

          </div>

          <div className="p-4 border-t border-[#27272a] bg-[#18181b] flex flex-col sm:flex-row justify-between items-center gap-4 text-xs font-mono">
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[#71717a]">Volatility:</span>
                <span className="text-[#e4e4e7]">{(data.volatility * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#71717a]">Risk Profile:</span>
                <span className={data.riskLevel === 'HIGH' ? 'text-[#f87171]' : data.riskLevel === 'LOW' ? 'text-[#34d399]' : 'text-[#60a5fa]'}>
                  {data.riskLevel}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-[#71717a]">Instant Signal:</span>
              <span className={`px-3 py-1 font-bold border rounded-sm ${
                data.signal === 'BUY' ? 'bg-[#064e3b] text-[#34d399] border-[#047857]' :
                data.signal === 'SELL' ? 'bg-[#7f1d1d] text-[#f87171] border-[#b91c1c]' :
                'bg-[#27272a] text-[#e4e4e7] border-[#52525b]'
              }`}>
                {data.signal}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
