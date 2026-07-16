'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2, Sparkles } from 'lucide-react';

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

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

export default function ScreenerTab() {
  const [ticker, setTicker] = useState('');
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Autocomplete state
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLFormElement>(null);

  // Debounced search
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (ticker.length >= 2 && showDropdown) {
        setIsSearching(true);
        fetch(`/api/search?q=${encodeURIComponent(ticker)}`)
          .then(res => res.json())
          .then(data => {
            if (Array.isArray(data)) setSearchResults(data);
          })
          .catch(() => setSearchResults([]))
          .finally(() => setIsSearching(false));
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [ticker, showDropdown]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectTicker = (selectedTicker: string) => {
    setTicker(selectedTicker);
    setShowDropdown(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) return;
    setShowDropdown(false);
    
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
        <h2 className="text-lg font-mono text-[#e4e4e7] mb-2">Buscador Técnico Global + IA</h2>
        <p className="text-[#a1a1aa] text-sm font-sans mb-6">Busca cualquier acción o ETF global para calcular sus zonas de valor al instante.</p>
        
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 max-w-xl mx-auto relative" ref={dropdownRef}>
          <div className="flex-1 relative">
            <input 
              type="text" 
              placeholder="Ej: AAPL, TSLA, SQM-B.SN, CHILE.SN"
              value={ticker}
              onChange={e => {
                setTicker(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => { if(ticker.length >= 2) setShowDropdown(true); }}
              className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 font-mono focus:outline-none focus:border-[#60a5fa] text-left uppercase"
            />
            
            {/* AUTOCOMPLETE DROPDOWN */}
            {showDropdown && (ticker.length >= 2) && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#18181b] border border-[#3f3f46] rounded-sm shadow-xl z-50 max-h-60 overflow-y-auto">
                {isSearching ? (
                  <div className="p-3 text-xs text-[#a1a1aa] font-mono text-center">Buscando...</div>
                ) : searchResults.length > 0 ? (
                  <ul className="text-left font-mono text-sm">
                    {searchResults.map((item, idx) => (
                      <li 
                        key={idx} 
                        onClick={() => handleSelectTicker(item.symbol)}
                        className="p-3 hover:bg-[#27272a] cursor-pointer border-b border-[#27272a] last:border-0"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-[#60a5fa]">{item.symbol}</span>
                          <span className="text-[10px] text-[#71717a] bg-[#09090b] px-1 rounded">{item.exchange}</span>
                        </div>
                        <div className="text-xs text-[#a1a1aa] truncate">{item.name}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="p-3 text-xs text-[#71717a] font-mono text-center">No se encontraron resultados</div>
                )}
              </div>
            )}
          </div>

          <button 
            type="submit"
            disabled={loading || !ticker}
            className="bg-[#60a5fa] hover:bg-[#3b82f6] text-[#09090b] px-6 py-3 font-bold font-mono transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            ANALIZAR
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-[#7f1d1d] border border-[#b91c1c] text-[#fca5a5] p-4 text-sm font-mono text-center">
          {error}
        </div>
      )}

      {data && (
        <div className="bg-[#09090b] border border-[#27272a] rounded-sm overflow-hidden flex flex-col gap-0">
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
              <p className="text-[10px] font-mono text-[#71717a] uppercase tracking-widest mb-2">Límite Compra (LBB)</p>
              <p className="font-mono text-2xl font-bold text-[#34d399]">${data.bollingerLower.toFixed(2)}</p>
              <p className="text-xs text-[#a1a1aa] mt-2 font-sans">Espera a que el precio baje de este nivel para una entrada óptima.</p>
            </div>

            <div className="p-6 flex flex-col items-center text-center bg-[#18181b]">
              <p className="text-[10px] font-mono text-[#71717a] uppercase tracking-widest mb-2">Valor Justo (EMA 200)</p>
              <p className="font-mono text-2xl font-bold text-[#60a5fa]">{data.ema200 ? `$${data.ema200.toFixed(2)}` : 'N/A'}</p>
              <p className="text-xs text-[#a1a1aa] mt-2 font-sans">Línea base de regresión a la media a largo plazo.</p>
            </div>

            <div className="p-6 flex flex-col items-center text-center">
              <p className="text-[10px] font-mono text-[#71717a] uppercase tracking-widest mb-2">Venta Máxima (UBB)</p>
              <p className="font-mono text-2xl font-bold text-[#f87171]">${data.bollingerUpper.toFixed(2)}</p>
              <p className="text-xs text-[#a1a1aa] mt-2 font-sans">Zona de toma de ganancias por sobre-extensión.</p>
            </div>

          </div>

          <div className="p-4 border-t border-[#27272a] bg-[#18181b] flex flex-col sm:flex-row justify-between items-center gap-4 text-xs font-mono">
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[#71717a]">Volatilidad:</span>
                <span className="text-[#e4e4e7]">{(data.volatility * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#71717a]">Perfil de Riesgo:</span>
                <span className={data.riskLevel === 'ALTO' ? 'text-[#f87171]' : data.riskLevel === 'BAJO' ? 'text-[#34d399]' : 'text-[#60a5fa]'}>
                  {data.riskLevel}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-[#71717a]">Señal Técnica:</span>
              <span className={`px-3 py-1 font-bold border rounded-sm ${
                data.signal === 'COMPRAR' ? 'bg-[#064e3b] text-[#34d399] border-[#047857]' :
                data.signal === 'VENDER' ? 'bg-[#7f1d1d] text-[#f87171] border-[#b91c1c]' :
                'bg-[#27272a] text-[#e4e4e7] border-[#52525b]'
              }`}>
                {data.signal}
              </span>
            </div>
          </div>

          {/* AI ANALYSIS SECTION */}
          {data.aiAnalysis && (
            <div className="p-5 border-t border-[#27272a] bg-[#09090b]">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-[#d946ef]" />
                <h4 className="text-xs font-mono font-bold text-[#d946ef] uppercase tracking-widest">Resumen Ejecutivo de IA</h4>
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
