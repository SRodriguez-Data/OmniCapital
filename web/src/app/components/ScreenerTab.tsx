'use client';

import React, { useState } from 'react';
import { Search, Loader2, Sparkles } from 'lucide-react';
import SymbolSearchModal from './SymbolSearchModal';

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
  signal: 'COMPRAR' | 'VENDER' | 'MANTENER';
  aiAnalysis?: string;
  error?: string;
}

export default function ScreenerTab() {
  const [ticker, setTicker] = useState('');
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSearch = async (searchTicker: string) => {
    if (!searchTicker) return;
    setTicker(searchTicker);
    setLoading(true);
    setError('');
    setData(null);

    try {
      const res = await fetch(`/api/market?ticker=${encodeURIComponent(searchTicker)}`);
      const json = await res.json();
      
      if (!res.ok) {
        setError(json.error || 'Ticker no encontrado o sin suficientes datos.');
      } else {
        setData(json);
      }
    } catch {
      setError('Error de red al consultar el mercado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] p-6 rounded-sm text-center">
        <h2 className="text-lg font-sans font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7] mb-2">Buscador Técnico Global + IA</h2>
        <p className="text-zinc-600 dark:text-[#a1a1aa] text-sm font-sans mb-6">Busca cualquier acción o ETF global para calcular sus zonas de valor al instante.</p>
        
        <div className="flex flex-col sm:flex-row gap-2 max-w-xl mx-auto">
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex-1 bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] hover:border-blue-500 dark:hover:border-[#60a5fa] text-zinc-500 dark:text-[#71717a] hover:text-zinc-900 dark:text-[#e4e4e7] p-3 font-mono rounded-lg text-left uppercase transition-colors flex items-center gap-3"
          >
            <Search className="w-5 h-5 text-[#60a5fa]" />
            {ticker ? <span className="text-zinc-900 dark:text-[#e4e4e7] font-bold">{ticker}</span> : 'Buscar un ticker o instrumento...'}
          </button>
          
          <button 
            onClick={() => handleSearch(ticker)}
            disabled={loading || !ticker}
            className="bg-[#60a5fa] hover:bg-[#3b82f6] text-[#09090b] px-6 py-3 font-bold font-mono transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            ANALIZAR
          </button>
        </div>
      </div>

      <SymbolSearchModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSelect={(t) => handleSearch(t)} 
      />

      {error && (
        <div className="bg-[#7f1d1d] border border-[#b91c1c] text-[#fca5a5] p-4 text-sm font-mono text-center">
          {error}
        </div>
      )}

      {data && (
        <div className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded-sm overflow-hidden flex flex-col gap-0">
          <div className="bg-white dark:bg-[#18181b] p-4 border-b border-zinc-200 dark:border-[#27272a] flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
              <h3 className="font-mono text-2xl font-bold text-zinc-900 dark:text-[#e4e4e7]">{data.ticker}</h3>
              <p className="text-xs font-sans text-zinc-600 dark:text-[#a1a1aa]">{data.name}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-3xl font-bold text-zinc-900 dark:text-[#e4e4e7]">
                ${data.currentPrice.toFixed(2)} <span className="text-sm text-zinc-500 dark:text-[#71717a]">{data.currency}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-zinc-200 dark:divide-[#27272a]">
            
            <div className="p-6 flex flex-col items-center text-center">
              <p className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a] uppercase tracking-widest mb-2">Límite Compra (LBB)</p>
              <p className="font-mono text-2xl font-bold text-[#34d399]">${data.bollingerLower.toFixed(2)}</p>
              <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] mt-2 font-sans">Espera a que el precio baje de este nivel para una entrada óptima.</p>
            </div>

            <div className="p-6 flex flex-col items-center text-center bg-white dark:bg-[#18181b]">
              <p className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a] uppercase tracking-widest mb-2">Valor Justo (EMA 200)</p>
              <p className="font-mono text-2xl font-bold text-[#60a5fa]">{data.ema200 ? `$${data.ema200.toFixed(2)}` : 'N/A'}</p>
              <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] mt-2 font-sans">Línea base de regresión a la media a largo plazo.</p>
            </div>

            <div className="p-6 flex flex-col items-center text-center">
              <p className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a] uppercase tracking-widest mb-2">Venta Máxima (UBB)</p>
              <p className="font-mono text-2xl font-bold text-[#f87171]">${data.bollingerUpper.toFixed(2)}</p>
              <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] mt-2 font-sans">Zona de toma de ganancias por sobre-extensión.</p>
            </div>

          </div>

          <div className="p-4 border-t border-zinc-200 dark:border-[#27272a] bg-white dark:bg-[#18181b] flex flex-col sm:flex-row justify-between items-center gap-4 text-xs font-sans font-medium">
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 dark:text-[#71717a]">Volatilidad:</span>
                <span className="text-zinc-900 dark:text-[#e4e4e7]">{(data.volatility * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 dark:text-[#71717a]">Perfil de Riesgo:</span>
                <span className={data.riskLevel === 'ALTO' ? 'text-[#f87171]' : data.riskLevel === 'BAJO' ? 'text-[#34d399]' : 'text-[#60a5fa]'}>
                  {data.riskLevel}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 dark:text-[#71717a]">Señal Técnica:</span>
              <span className={`px-3 py-1 font-bold border rounded-sm ${
                data.signal === 'COMPRAR' ? 'bg-[#064e3b] text-[#34d399] border-[#047857]' :
                data.signal === 'VENDER' ? 'bg-[#7f1d1d] text-[#f87171] border-[#b91c1c]' :
                'bg-[#27272a] text-zinc-900 dark:text-[#e4e4e7] border-[#52525b]'
              }`}>
                {data.signal}
              </span>
            </div>
          </div>

          {/* AI ANALYSIS SECTION */}
          {data.aiAnalysis && (
            <div className="p-5 border-t border-zinc-200 dark:border-[#27272a] bg-zinc-50 dark:bg-[#09090b]">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-[#d946ef]" />
                <h4 className="text-xs font-sans font-medium font-bold text-[#d946ef] uppercase tracking-widest">Resumen Ejecutivo de IA</h4>
              </div>
              <p className="text-sm font-sans text-[#d4d4d8] leading-relaxed">
                {data.aiAnalysis}
              </p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
