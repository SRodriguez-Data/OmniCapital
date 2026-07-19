/* eslint-disable react/no-unescaped-entities */
/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, Building2 } from 'lucide-react';

interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

interface SymbolSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (symbol: string) => void;
}

export default function SymbolSearchModal({ isOpen, onClose, onSelect }: SymbolSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (query.length >= 2) {
        setLoading(true);
        fetch(`/api/search?q=${encodeURIComponent(query)}`)
          .then(res => res.json())
          .then(data => {
            if (Array.isArray(data)) setResults(data);
            else setResults([]);
          })
          .catch(() => setResults([]))
          .finally(() => setLoading(false));
      } else {
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none-lg shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        
        {/* Search Header */}
        <div className="flex items-center px-4 py-4 border-b border-zinc-200 dark:border-[#27272a] bg-zinc-50 dark:bg-[#09090b]">
          <Search className="w-5 h-5 text-[#60a5fa] mr-3" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar por símbolo o nombre de empresa (Ej: AAPL, Tesla, CHILE.SN)"
            className="flex-1 bg-transparent text-zinc-900 dark:text-[#e4e4e7] text-lg font-sans font-bold tracking-tight focus:outline-none placeholder-[#71717a]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button 
            onClick={onClose}
            className="ml-3 p-2 hover:bg-[#27272a] rounded-full transition-colors text-zinc-600 dark:text-[#a1a1aa] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center p-8 text-zinc-600 dark:text-[#a1a1aa] font-mono text-sm">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Buscando mercados...
            </div>
          )}

          {!loading && query.length > 0 && query.length < 2 && (
            <div className="p-8 text-center text-zinc-500 dark:text-[#71717a] font-mono text-sm">
              Escribe al menos 2 caracteres...
            </div>
          )}

          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="p-8 text-center text-zinc-500 dark:text-[#71717a] font-mono text-sm">
              No se encontraron instrumentos para "{query}"
            </div>
          )}

          {!loading && results.length > 0 && (
            <ul className="py-2">
              {results.map((item, idx) => (
                <li 
                  key={idx}
                  onClick={() => {
                    onSelect(item.symbol);
                    onClose();
                  }}
                  className="flex items-center justify-between px-6 py-4 hover:bg-[#27272a] cursor-pointer group transition-colors border-b border-zinc-200 dark:border-[#27272a] last:border-0"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-[#27272a] group-hover:bg-[#3f3f46] p-2 rounded transition-colors">
                      <Building2 className="w-5 h-5 text-[#60a5fa]" />
                    </div>
                    <div>
                      <h4 className="font-mono text-lg font-bold text-zinc-900 dark:text-[#e4e4e7] group-hover:text-white transition-colors">
                        {item.symbol}
                      </h4>
                      <p className="font-sans text-sm text-zinc-600 dark:text-[#a1a1aa] truncate max-w-[200px] sm:max-w-md">
                        {item.name}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#09090b] bg-[#a1a1aa] px-2 py-1 rounded font-bold">
                      {item.exchange}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-3 bg-zinc-50 dark:bg-[#09090b] border-t border-zinc-200 dark:border-[#27272a] text-center">
          <p className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">
            Desarrollado para Quantum Trader V2
          </p>
        </div>
      </div>
    </div>
  );
}
