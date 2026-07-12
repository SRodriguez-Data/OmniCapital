'use client';

import React, { useMemo } from 'react';
import { Activity, TrendingUp, TrendingDown, ShieldAlert, BarChart3 } from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell 
} from 'recharts';

interface MarketData {
  id: number;
  date: string;
  ticker: string;
  close: number;
  rsi: number;
  pvc_ema200: number;
  vol_20d: number;
}

export default function DashboardClient({ initialData }: { initialData: MarketData[] }) {
  
  // Calculate Quant Metrics
  const opportunities = useMemo(() => {
    // Filter logic: RSI < 50, EMA200 distance > -0.15 (15% drop max)
    return initialData
      .filter(d => d.rsi < 50 && d.pvc_ema200 > -0.15 && d.pvc_ema200 < 0.05)
      .map(d => ({
        ...d,
        score: (50 - d.rsi) + (d.pvc_ema200 * 100) // Lower RSI and better EMA proximity = higher score
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [initialData]);

  // Data for Chart
  const chartData = useMemo(() => {
    return opportunities.map(o => ({
      name: o.ticker,
      RSI: parseFloat(o.rsi.toFixed(1)),
      EMA_Dist: parseFloat((o.pvc_ema200 * 100).toFixed(1))
    }));
  }, [opportunities]);

  return (
    <div className="space-y-6">
      
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-surface-elevated bg-surface p-6 shadow-lg transition-transform hover:scale-105">
          <div className="flex items-center gap-3">
            <Activity className="h-8 w-8 text-brand" />
            <div>
              <p className="text-sm text-text-secondary">Universo Escaneado</p>
              <h3 className="text-2xl font-bold">{initialData.length} Activos</h3>
            </div>
          </div>
        </div>
        
        <div className="rounded-xl border border-surface-elevated bg-surface p-6 shadow-lg transition-transform hover:scale-105">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-8 w-8 text-bullish" />
            <div>
              <p className="text-sm text-text-secondary">Oportunidades Asimétricas</p>
              <h3 className="text-2xl font-bold">{opportunities.length}</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Table of Opportunities */}
        <div className="col-span-1 lg:col-span-2 rounded-xl border border-surface-elevated bg-surface p-6 shadow-lg">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
            <TrendingUp className="text-brand" /> Radar de Anomalías (Buy the Dip)
          </h2>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-elevated text-text-secondary">
                <tr>
                  <th className="pb-3 font-medium">Activo</th>
                  <th className="pb-3 font-medium">Precio</th>
                  <th className="pb-3 font-medium">RSI (14)</th>
                  <th className="pb-3 font-medium">Distancia EMA200</th>
                  <th className="pb-3 font-medium">Quant Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-elevated">
                {opportunities.map((row) => (
                  <tr key={row.ticker} className="transition-colors hover:bg-surface-elevated/50">
                    <td className="py-3 font-semibold text-brand-light">{row.ticker}</td>
                    <td className="py-3">${row.close.toFixed(2)}</td>
                    <td className={`py-3 font-medium ${row.rsi < 30 ? 'text-bullish' : ''}`}>
                      {row.rsi.toFixed(1)}
                    </td>
                    <td className="py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                        row.pvc_ema200 < 0 ? 'bg-bearish/10 text-bearish' : 'bg-bullish/10 text-bullish'
                      }`}>
                        {(row.pvc_ema200 * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 font-bold">{row.score.toFixed(1)}</td>
                  </tr>
                ))}
                {opportunities.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-text-secondary">
                      No hay oportunidades con los filtros técnicos actuales.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RSI Chart */}
        <div className="col-span-1 rounded-xl border border-surface-elevated bg-surface p-6 shadow-lg">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
            <BarChart3 className="text-brand" /> Top RSI Castigados
          </h2>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <XAxis type="number" domain={[0, 100]} stroke="#a0a0a0" />
                <YAxis dataKey="name" type="category" stroke="#a0a0a0" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#121212', borderColor: '#1e1e1e', borderRadius: '8px' }}
                  itemStyle={{ color: '#00f0ff' }}
                />
                <Bar dataKey="RSI" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.RSI < 30 ? '#10b981' : '#009099'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      
    </div>
  );
}
