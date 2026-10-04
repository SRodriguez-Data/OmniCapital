'use client';

import React, { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';

interface MacroIndicator {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  displayName: string;
}

export default function MacroPanel() {
  const [data, setData] = useState<MacroIndicator[]>([]);

  useEffect(() => {
    async function fetchMacro() {
      try {
        const res = await fetch('/api/macro');
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (e) {
        console.error("Error fetching macro panel", e);
      }
    }
    fetchMacro();
    
    // Refresh every 5 minutes
    const interval = setInterval(fetchMacro, 300000);
    return () => clearInterval(interval);
  }, []);

  if (data.length === 0) {
    return (
      <div className="bg-zinc-50 dark:bg-[#09090b] border-b border-zinc-200 dark:border-[#27272a] py-2 px-6 flex gap-6 overflow-x-auto text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a]">
        Cargando indicadores macroeconómicos...
      </div>
    );
  }

  return (
    <div className="bg-zinc-50 dark:bg-[#09090b] border-b border-zinc-200 dark:border-[#27272a] py-2 px-6 flex gap-6 overflow-x-auto hide-scrollbar whitespace-nowrap">
      {data.map((item, i) => {
        const isVix = item.symbol === '^VIX';
        // Para el VIX subir es malo (miedo), así que los colores se invierten.
        const isUp = item.change > 0;
        const isDown = item.change < 0;

        let colorClass = "text-zinc-600 dark:text-[#a1a1aa]";
        if (isUp) colorClass = isVix ? "text-[#f87171]" : "text-[#34d399]";
        else if (isDown) colorClass = isVix ? "text-[#34d399]" : "text-[#f87171]";

        return (
          <div key={i} className="flex items-center gap-2 text-xs font-sans font-medium">
            <span className="text-zinc-600 dark:text-[#a1a1aa] font-bold">{item.displayName}:</span>
            <span className="text-zinc-900 dark:text-[#e4e4e7]">{item.price.toFixed(2)}</span>
            <span className={`flex items-center ${colorClass}`}>
              {isUp && <TrendingUp className="w-3 h-3 mr-1" />}
              {isDown && <TrendingDown className="w-3 h-3 mr-1" />}
              {/* Yahoo entrega regularMarketChangePercent ya en %, no como fracción */}
              {Math.abs(item.changePercent).toFixed(2)}%
            </span>
            {isVix && item.price > 20 && (
              <AlertTriangle className="w-3 h-3 text-[#fbbf24] ml-1 animate-pulse" />
            )}
            <span className="text-[#3f3f46] ml-4">|</span>
          </div>
        );
      })}
    </div>
  );
}
