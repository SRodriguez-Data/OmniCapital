'use client';

import React, { useEffect, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import { usePortfolio } from '../context/PortfolioContext';

export type TimePeriod = '1S' | '1M' | '3M' | '6M' | 'YTD' | '1A' | 'TOTAL';

export default function AssetSparkline({ ticker, purchaseDate, period = 'TOTAL' }: { ticker: string, purchaseDate: string, period?: TimePeriod }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { isDemo } = usePortfolio();

  useEffect(() => {
    async function fetchData() {
      if (!purchaseDate) {
        setLoading(false);
        return;
      }

      if (isDemo) {
        // Generar mock para sparkline
        const mockData = [];
        let p = 100;
        let date = new Date(purchaseDate);
        const today = new Date();
        const days = Math.min(300, Math.floor((today.getTime() - date.getTime()) / (1000 * 3600 * 24)));
        
        for (let i = 0; i <= days; i++) {
          mockData.push({ date: date.toISOString().split('T')[0], price: p });
          p += (Math.random() - 0.45) * 5; // Ligeramente alcista
          date.setDate(date.getDate() + 1);
        }
        setData(mockData);
        setLoading(false);
        return;
      }

      try {
        // Obtenemos un historial de 1 año como mínimo para poder filtrar periodos cortos
        const res = await fetch(`/api/portfolio/asset-history?ticker=${encodeURIComponent(ticker)}&purchase_date=${purchaseDate}`);
        if (res.ok) {
          const history = await res.json();
          setData(history);
        }
      } catch (error) {
        console.error("Error fetching asset history", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [ticker, purchaseDate, isDemo]);

  if (loading) return <div className="h-32 flex items-center justify-center text-xs font-mono text-zinc-500">Cargando gráfico...</div>;
  if (data.length === 0) return <div className="h-32 flex items-center justify-center text-xs font-mono text-zinc-500">Sin datos desde la fecha de compra</div>;

  let filteredData = data;
  if (period !== 'TOTAL' && data.length > 0) {
    const lastDate = new Date(data[data.length - 1].date);
    let cutoff = new Date(lastDate);
    if (period === '1S') cutoff.setDate(cutoff.getDate() - 7);
    else if (period === '1M') cutoff.setMonth(cutoff.getMonth() - 1);
    else if (period === '3M') cutoff.setMonth(cutoff.getMonth() - 3);
    else if (period === '6M') cutoff.setMonth(cutoff.getMonth() - 6);
    else if (period === 'YTD') cutoff = new Date(lastDate.getFullYear(), 0, 1);
    else if (period === '1A') cutoff.setFullYear(cutoff.getFullYear() - 1);
    
    filteredData = data.filter(d => new Date(d.date) >= cutoff);
    if (filteredData.length < 2) filteredData = data.slice(-2);
  }

  const isPositive = filteredData[filteredData.length - 1].price >= filteredData[0].price;
  const strokeColor = isPositive ? "#34d399" : "#f87171";

  return (
    <div className="h-40 w-full flex flex-col">
      <div className="flex justify-between items-center mb-2 px-2">
        <span className="text-xs font-mono text-zinc-500">P&L ({period}): {ticker}</span>
        <span className={`text-xs font-bold font-mono ${isPositive ? 'text-[#34d399]' : 'text-[#f87171]'}`}>
          {((filteredData[filteredData.length - 1].price - filteredData[0].price) / filteredData[0].price * 100).toFixed(2)}%
        </span>
      </div>
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id={`color${ticker}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <YAxis domain={['auto', 'auto']} hide />
            <Tooltip 
              contentStyle={{backgroundColor: '#09090b', borderColor: '#27272a', fontFamily: 'monospace', fontSize: '10px'}} 
              itemStyle={{color: '#e4e4e7'}}
              labelStyle={{color: '#71717a'}}
              formatter={(val: any) => [`$${Number(val).toFixed(2)}`, 'Precio']}
            />
            <Area 
              type="monotone" 
              dataKey="price" 
              stroke={strokeColor} 
              fill={`url(#color${ticker})`} 
              strokeWidth={2} 
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
