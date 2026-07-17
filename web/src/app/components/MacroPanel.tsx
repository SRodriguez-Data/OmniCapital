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
      <div className="bg-[#09090b] border-b border-[#27272a] py-2 px-6 flex gap-6 overflow-x-auto text-xs font-mono text-[#71717a]">
        Cargando indicadores macroeconómicos...
      </div>
    );
  }

  return (
    <div className="bg-[#09090b] border-b border-[#27272a] py-2 px-6 flex gap-6 overflow-x-auto hide-scrollbar whitespace-nowrap">
      {data.map((item, i) => {
        const isVix = item.symbol === '^VIX';
        // For VIX, "up" is bad (fear). For everything else, "up" is generally green/positive (or neutral).
        // Let's color code VIX specifically: if VIX > 20, we can add a warning.
        // For now, simple logic: change > 0 is green, < 0 is red. Exception VIX: change > 0 is red, < 0 is green.
        const isUp = item.change > 0;
        
        let colorClass = "text-[#a1a1aa]";
        if (isVix) {
          colorClass = isUp ? "text-[#f87171]" : "text-[#34d399]";
        } else {
          colorClass = isUp ? "text-[#34d399]" : (item.change < 0 ? "text-[#f87171]" : "text-[#a1a1aa]");
        }

        return (
          <div key={i} className="flex items-center gap-2 text-xs font-mono">
            <span className="text-[#a1a1aa] font-bold">{item.displayName}:</span>
            <span className="text-[#e4e4e7]">{item.price.toFixed(2)}</span>
            <span className={`flex items-center ${colorClass}`}>
              {isUp ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
              {Math.abs(item.changePercent * 100).toFixed(2)}%
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
