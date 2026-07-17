'use client';

import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { History, Loader2, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';

export default function BacktestTab() {
  const [ticker, setTicker] = useState('NVDA');
  const [capital, setCapital] = useState('10000');
  const [years, setYears] = useState('5');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const runBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ticker: ticker.toUpperCase(), 
          capital: Number(capital), 
          years: Number(years) 
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al ejecutar backtest');

      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-[#18181b] border border-[#27272a] p-3 rounded shadow-lg">
          <p className="text-[#a1a1aa] text-xs font-mono mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center gap-2 text-sm font-mono">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-[#e4e4e7]">{entry.name}:</span>
              <span className="font-bold text-white">${entry.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      
      <div className="bg-[#18181b] border border-[#27272a] rounded p-6">
        <div className="flex items-center gap-3 mb-6 border-b border-[#27272a] pb-4">
          <History className="w-6 h-6 text-[#d946ef]" />
          <div>
            <h2 className="text-lg font-mono text-[#e4e4e7] uppercase tracking-wider">Máquina del Tiempo (Backtesting)</h2>
            <p className="text-[#a1a1aa] text-xs font-sans">
              Viaja al pasado. Simula qué hubiera pasado si invertías tu capital en un activo vs el S&P 500.
            </p>
          </div>
        </div>

        <form onSubmit={runBacktest} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-mono text-[#71717a] mb-1">Ticker / Activo</label>
            <input 
              type="text" 
              required
              value={ticker}
              onChange={e => setTicker(e.target.value)}
              className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 font-mono uppercase focus:outline-none focus:border-[#60a5fa]"
              placeholder="NVDA"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-[#71717a] mb-1">Capital Inicial ($)</label>
            <input 
              type="number" 
              required
              value={capital}
              onChange={e => setCapital(e.target.value)}
              className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 font-mono focus:outline-none focus:border-[#60a5fa]"
              placeholder="10000"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-[#71717a] mb-1">Años al Pasado</label>
            <select 
              value={years}
              onChange={e => setYears(e.target.value)}
              className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-3 font-mono focus:outline-none focus:border-[#60a5fa]"
            >
              <option value="1">1 Año</option>
              <option value="3">3 Años</option>
              <option value="5">5 Años</option>
              <option value="10">10 Años</option>
            </select>
          </div>
          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-[#d946ef] hover:bg-[#c026d3] disabled:bg-[#27272a] disabled:text-[#71717a] text-white p-3 font-bold font-mono transition-colors flex items-center justify-center h-[50px]"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'SIMULAR'}
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-[#f87171]/10 border border-[#f87171]/50 text-[#f87171] p-4 rounded text-sm font-mono">
          [ERROR] {error}
        </div>
      )}

      {result && (
        <div className="space-y-6 animate-fade-in">
          {/* Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-[#18181b] border border-[#27272a] p-4 rounded text-center">
              <p className="text-xs font-mono text-[#71717a] uppercase mb-1">Rendimiento {ticker}</p>
              <p className={`text-2xl font-bold font-mono ${result.metrics.targetReturn >= 0 ? 'text-[#34d399]' : 'text-[#f87171]'}`}>
                {result.metrics.targetReturn >= 0 ? '+' : ''}{result.metrics.targetReturn.toFixed(2)}%
              </p>
              <p className="text-[#a1a1aa] text-xs font-mono mt-1">${result.metrics.finalTargetValue.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
            </div>
            <div className="bg-[#18181b] border border-[#27272a] p-4 rounded text-center">
              <p className="text-xs font-mono text-[#71717a] uppercase mb-1">Rendimiento S&P 500</p>
              <p className={`text-2xl font-bold font-mono ${result.metrics.benchmarkReturn >= 0 ? 'text-[#60a5fa]' : 'text-[#f87171]'}`}>
                {result.metrics.benchmarkReturn >= 0 ? '+' : ''}{result.metrics.benchmarkReturn.toFixed(2)}%
              </p>
              <p className="text-[#a1a1aa] text-xs font-mono mt-1">${result.metrics.finalBenchmarkValue.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
            </div>
            <div className="bg-[#18181b] border border-[#27272a] p-4 rounded text-center">
              <p className="text-xs font-mono text-[#71717a] uppercase mb-1">Victoria vs Mercado</p>
              <p className={`text-2xl font-bold font-mono ${result.metrics.targetReturn > result.metrics.benchmarkReturn ? 'text-[#34d399]' : 'text-[#f87171]'}`}>
                {result.metrics.targetReturn > result.metrics.benchmarkReturn ? 'SI' : 'NO'}
              </p>
            </div>
            <div className="bg-[#18181b] border border-[#27272a] p-4 rounded text-center">
              <p className="text-xs font-mono text-[#71717a] uppercase mb-1">Caída Máxima (Drawdown)</p>
              <p className="text-2xl font-bold font-mono text-[#f87171]">
                -{result.metrics.maxDrawdown.toFixed(2)}%
              </p>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-[#18181b] border border-[#27272a] p-4 rounded h-[400px]">
             <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={result.chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTarget" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d946ef" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#d946ef" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorBench" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke="#71717a" 
                  fontSize={10} 
                  tickFormatter={(val) => val.substring(0,4)}
                  minTickGap={30}
                />
                <YAxis 
                  stroke="#71717a" 
                  fontSize={10}
                  tickFormatter={(val) => `$${(val / 1000)}k`}
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', fontFamily: 'monospace' }} />
                <Area 
                  type="monotone" 
                  dataKey="Estrategia" 
                  name={ticker}
                  stroke="#d946ef" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorTarget)" 
                />
                <Area 
                  type="monotone" 
                  dataKey="SP500" 
                  name="S&P 500"
                  stroke="#60a5fa" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorBench)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

    </div>
  );
}
