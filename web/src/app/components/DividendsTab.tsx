'use client';

import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';
import { DollarSign, Percent, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface DividendItem {
  id: string;
  ticker: string;
  cantidad: number;
  moneda: 'USD' | 'CLP';
  dividendYield: number;
  dividendRate: number;
  projectedAnnualIncome: number;
}

const COLORS = ['#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#38bdf8', '#4ade80'];

export default function DividendsTab() {
  const [items, setItems] = useState<DividendItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchDividends() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/dividends', {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } catch (error) {
      console.error("Error fetching dividends", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDividends();
  }, []);

  if (loading) return <div className="text-center p-12 font-mono text-zinc-600 dark:text-[#a1a1aa]">Calculando proyecciones de dividendos...</div>;

  if (items.length === 0) {
    return (
      <div className="text-center p-12 bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none-sm max-w-4xl mx-auto">
        <DollarSign className="w-8 h-8 text-zinc-600 dark:text-[#a1a1aa] mx-auto mb-4" />
        <h3 className="text-lg font-sans font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7] mb-2">Sin Ingresos por Dividendos</h3>
        <p className="text-sm font-sans text-zinc-600 dark:text-[#a1a1aa]">Tus activos actuales no registran pagos de dividendos recientes, o el portafolio está vacío.</p>
      </div>
    );
  }

  // Calculate totals per currency
  const totalIncomeUSD = items.filter(i => i.moneda === 'USD').reduce((sum, i) => sum + i.projectedAnnualIncome, 0);
  const totalIncomeCLP = items.filter(i => i.moneda === 'CLP').reduce((sum, i) => sum + i.projectedAnnualIncome, 0);

  // Calculate weighted average yield (rough estimate based on income proportion)
  const weightedYield = items.reduce((sum, i) => sum + i.dividendYield, 0) / items.length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      
      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] p-6 rounded-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <DollarSign className="w-16 h-16 text-[#34d399]" />
          </div>
          <p className="text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] uppercase tracking-widest mb-1">Ingreso Anual Estimado (USD)</p>
          <h2 className="text-3xl font-bold font-mono text-[#34d399]">${totalIncomeUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</h2>
        </div>

        <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] p-6 rounded-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <DollarSign className="w-16 h-16 text-[#60a5fa]" />
          </div>
          <p className="text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] uppercase tracking-widest mb-1">Ingreso Anual Estimado (CLP)</p>
          <h2 className="text-3xl font-bold font-mono text-[#60a5fa]">${totalIncomeCLP.toLocaleString(undefined, {maximumFractionDigits: 0})}</h2>
        </div>

        <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] p-6 rounded-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Percent className="w-16 h-16 text-[#f472b6]" />
          </div>
          <p className="text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] uppercase tracking-widest mb-1">Yield Promedio de Pagadores</p>
          <h2 className="text-3xl font-bold font-mono text-[#f472b6]">{(weightedYield * 100).toFixed(2)}%</h2>
        </div>
      </div>

      {/* CHART */}
      <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none p-6 h-96 flex flex-col">
        <h2 className="text-xs font-sans font-medium font-bold text-zinc-900 dark:text-[#e4e4e7] uppercase border-b border-zinc-200 dark:border-[#27272a] pb-4 mb-6 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#60a5fa]" />
          Proyección de Pagos por Activo
        </h2>
        <div className="flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={items} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="ticker" stroke="#71717a" fontSize={10} tickMargin={10} axisLine={false} tickLine={false} />
              <YAxis stroke="#71717a" fontSize={10} tickFormatter={(val) => `$${val}`} axisLine={false} tickLine={false} />
              <RechartsTooltip 
                cursor={{fill: '#27272a', opacity: 0.4}}
                contentStyle={{backgroundColor: '#09090b', borderColor: '#27272a', fontFamily: 'monospace'}} 
                itemStyle={{color: '#e4e4e7'}} 
                labelStyle={{color: '#60a5fa', fontWeight: 'bold', marginBottom: '4px'}}
                formatter={(value: any, name: any, props: any) => {
                  const item = props.payload;
                  return [
                    `$${Number(value).toLocaleString(undefined, {minimumFractionDigits: item.moneda === 'USD' ? 2 : 0, maximumFractionDigits: item.moneda === 'USD' ? 2 : 0})} ${item.moneda}`,
                    'Ingreso Anual Proyectado'
                  ];
                }}
              />
              <Bar dataKey="projectedAnnualIncome" radius={[4, 4, 0, 0]}>
                {items.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TABLE */}
      <div className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded overflow-hidden mt-6">
        <table className="w-full text-left text-sm font-mono border-collapse">
          <thead className="bg-white dark:bg-[#18181b] text-zinc-600 dark:text-[#a1a1aa] text-[11px] uppercase border-b border-zinc-300 dark:border-[#3f3f46]">
            <tr>
              <th className="py-3 px-4 font-semibold">Ticker</th>
              <th className="py-3 px-4 font-semibold text-right">Cantidad</th>
              <th className="py-3 px-4 font-semibold text-right">Dividendo Anual (Acción)</th>
              <th className="py-3 px-4 font-semibold text-right">Dividend Yield</th>
              <th className="py-3 px-4 font-semibold text-right">Ingreso Anual Proyectado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a]">
            {items.map((row) => (
              <tr key={row.id} className="hover:bg-white dark:bg-[#18181b] transition-colors">
                <td className="py-3 px-4 font-bold text-zinc-900 dark:text-[#e4e4e7]">{row.ticker}</td>
                <td className="py-3 px-4 text-right text-zinc-600 dark:text-[#a1a1aa]">{row.cantidad}</td>
                <td className="py-3 px-4 text-right text-zinc-600 dark:text-[#a1a1aa]">
                  ${row.dividendRate.toFixed(row.moneda === 'USD' ? 2 : 0)} {row.moneda}
                </td>
                <td className="py-3 px-4 text-right font-bold text-[#f472b6]">
                  {(row.dividendYield * 100).toFixed(2)}%
                </td>
                <td className="py-3 px-4 text-right font-bold text-[#34d399]">
                  ${row.projectedAnnualIncome.toLocaleString(undefined, {minimumFractionDigits: row.moneda === 'USD' ? 2 : 0, maximumFractionDigits: row.moneda === 'USD' ? 2 : 0})} {row.moneda}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
    </div>
  );
}
