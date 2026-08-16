/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import SymbolSearchModal from './SymbolSearchModal';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface PortfolioItem {
  id: string;
  ticker: string;
  cantidad: number;
  precio_compra: number;
  moneda: 'USD' | 'CLP';
}

const COLORS_USD = ['#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'];
const COLORS_CLP = ['#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b'];

export default function PortfolioTab() {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Form state
  const [ticker, setTicker] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [precio, setPrecio] = useState('');
  const [moneda, setMoneda] = useState<'USD'|'CLP'>('USD');
  const [submitting, setSubmitting] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [range, setRange] = useState<'1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'>('1M');

  async function fetchPortfolio() {
    try {
      if (typeof window !== 'undefined' && localStorage.getItem('isDemo') === 'true') {
        setItems([
          { id: 'demo-1', ticker: 'AAPL', cantidad: 10, precio_compra: 150, moneda: 'USD' },
          { id: 'demo-2', ticker: 'TSLA', cantidad: 5, precio_compra: 200, moneda: 'USD' },
          { id: 'demo-3', ticker: 'MSFT', cantidad: 8, precio_compra: 300, moneda: 'USD' },
          { id: 'demo-4', ticker: 'SQM-B.SN', cantidad: 50, precio_compra: 40000, moneda: 'CLP' }
        ]);
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/portfolio', {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } catch (error) {
      console.error("Error fetching portfolio", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchHistory(selectedRange = range) {
    try {
      if (typeof window !== 'undefined' && localStorage.getItem('isDemo') === 'true') {
        const mockHistory = [];
        let currentDate = new Date();
        currentDate.setDate(currentDate.getDate() - 30);
        let baseValue = 10000;
        let basePnL = 500;
        for(let i=0; i<30; i++) {
          currentDate.setDate(currentDate.getDate() + 1);
          baseValue += (Math.random() - 0.4) * 200; // Ligera tendencia alcista
          basePnL += (Math.random() - 0.4) * 50;
          mockHistory.push({
            date: currentDate.toISOString().split('T')[0],
            totalValue: baseValue,
            profitLoss: basePnL
          });
        }
        setHistoryData(mockHistory);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/portfolio/history?range=${selectedRange}`, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryData(data);
      }
    } catch (error) {
      console.error("Error fetching history", error);
    }
  }

  useEffect(() => {
    fetchPortfolio();
  }, []);

  useEffect(() => {
    fetchHistory(range);
  }, [range]);

  const handleSelectTicker = (selectedTicker: string) => {
    setTicker(selectedTicker);
    if (selectedTicker.endsWith('.SN')) {
      setMoneda('CLP');
    } else {
      setMoneda('USD');
    }
    setIsModalOpen(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof window !== 'undefined' && localStorage.getItem('isDemo') === 'true') {
      alert("⛔ Operación de escritura bloqueada. El modo Jurado (Demo) es de solo lectura y tus datos están aislados por seguridad.");
      setTicker(''); setCantidad(''); setPrecio('');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          cantidad: Number(cantidad),
          precio_compra: Number(precio),
          moneda
        })
      });
      if (res.ok) {
        setTicker(''); setCantidad(''); setPrecio('');
        await fetchPortfolio();
        await fetchHistory(); // refresh history as well
      }
    } catch {
      console.error("Error al añadir");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (typeof window !== 'undefined' && localStorage.getItem('isDemo') === 'true') {
      alert("⛔ Operación de eliminación bloqueada. El modo Jurado (Demo) es de solo lectura.");
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/portfolio?id=${id}`, { 
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      if (res.ok) {
        await fetchPortfolio();
        await fetchHistory();
      }
    } catch {
      console.error("Error al eliminar");
    }
  };

  const dataUSD = items.filter(i => i.moneda === 'USD').map(i => ({ name: i.ticker, value: i.cantidad * i.precio_compra }));
  const dataCLP = items.filter(i => i.moneda === 'CLP').map(i => ({ name: i.ticker, value: i.cantidad * i.precio_compra }));

  if (loading) return <div className="text-center p-12 font-mono text-zinc-600 dark:text-[#a1a1aa]">Cargando portafolio...</div>;

  return (
    <div className="space-y-6">
      
      {/* ADD NEW ITEM FORM */}
      <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] p-4 rounded flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 w-full">
          <label className="block text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] mb-1">Ticker / Activo</label>
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] hover:border-blue-500 dark:hover:border-[#60a5fa] text-zinc-500 dark:text-[#71717a] hover:text-zinc-900 dark:text-[#e4e4e7] p-2 text-sm font-mono rounded-lg text-left uppercase transition-colors flex items-center justify-between"
          >
            <span className={ticker ? "text-zinc-900 dark:text-[#e4e4e7] font-bold" : ""}>
              {ticker || "Buscar Símbolo..."}
            </span>
            <Search className="w-4 h-4 text-[#60a5fa]" />
          </button>
        </div>
        
        <div className="w-full md:w-32">
          <label className="block text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] mb-1">Cantidad</label>
          <input 
            type="number" 
            placeholder="0.0" 
            value={cantidad}
            onChange={e => setCantidad(e.target.value)}
            className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] text-zinc-900 dark:text-[#e4e4e7] p-2 text-sm font-mono rounded-lg focus:outline-none focus:border-[#60a5fa]"
          />
        </div>
        <div className="w-full md:w-32">
          <label className="block text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] mb-1">Precio Compra</label>
          <input 
            type="number" 
            placeholder="0.0" 
            value={precio}
            onChange={e => setPrecio(e.target.value)}
            className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] text-zinc-900 dark:text-[#e4e4e7] p-2 text-sm font-mono rounded-lg focus:outline-none focus:border-[#60a5fa]"
          />
        </div>
        <div className="w-full md:w-24">
          <label className="block text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] mb-1">Moneda</label>
          <select 
            value={moneda}
            onChange={e => setMoneda(e.target.value as 'USD'|'CLP')}
            className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] text-zinc-900 dark:text-[#e4e4e7] p-2 text-sm font-mono rounded-lg focus:outline-none focus:border-[#60a5fa]"
          >
            <option value="USD">USD</option>
            <option value="CLP">CLP</option>
          </select>
        </div>
        <button 
          onClick={handleAdd}
          disabled={submitting || !ticker || !cantidad || !precio}
          className="w-full md:w-auto bg-[#2563eb] hover:bg-[#1d4ed8] text-white px-6 py-2 text-sm font-bold font-mono transition-colors disabled:opacity-50"
        >
          {submitting ? 'AÑADIENDO...' : '+ AÑADIR'}
        </button>
      </div>

      <SymbolSearchModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onSelect={handleSelectTicker} 
      />

      {/* HISTORICAL P&L CHART */}
      {historyData.length > 0 && (
        <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none p-6 h-96 flex flex-col">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-zinc-200 dark:border-[#27272a] pb-4 mb-6 gap-4">
            <div>
              <h2 className="text-xs font-sans font-medium font-bold text-zinc-900 dark:text-[#e4e4e7] uppercase">Evolución P&L</h2>
              <div className="flex gap-2 mt-2">
                {['1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'].map(r => (
                  <button
                    key={r}
                    onClick={() => setRange(r as any)}
                    className={`text-[10px] px-2 py-1 rounded font-mono font-bold transition-colors ${range === r ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'bg-zinc-100 dark:bg-[#27272a] text-zinc-500 dark:text-[#a1a1aa] hover:bg-zinc-200 dark:hover:bg-[#3f3f46]'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[10px] text-zinc-500 dark:text-[#71717a] font-mono uppercase">P&L ({range})</p>
              <p className={`text-lg font-bold font-mono ${historyData[historyData.length - 1].profitLoss >= 0 ? 'text-[#34d399]' : 'text-[#f87171]'}`}>
                ${historyData[historyData.length - 1].profitLoss.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </p>
            </div>
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={historyData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" stroke="#71717a" fontSize={10} tickFormatter={(tick) => tick.substring(5)} tickMargin={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={10} tickFormatter={(val) => `$${val.toLocaleString()}`} axisLine={false} tickLine={false} width={80} domain={['auto', 'auto']} />
                <RechartsTooltip 
                  contentStyle={{backgroundColor: '#09090b', borderColor: '#27272a', fontFamily: 'monospace'}} 
                  itemStyle={{color: '#e4e4e7'}} 
                  labelStyle={{color: '#71717a'}}
                  formatter={(value: any, name: any) => [`$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, name]}
                />
                <Area 
                  type="monotone" 
                  dataKey="totalValue" 
                  stroke={(historyData[historyData.length - 1]?.profitLoss >= 0) ? "#34d399" : "#f87171"} 
                  fill={(historyData[historyData.length - 1]?.profitLoss >= 0) ? "url(#colorProfit)" : "url(#colorLoss)"} 
                  strokeWidth={2} 
                  name="Valor Portafolio" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* USD PIE CHART */}
        <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none p-4 h-80 flex flex-col">
          <h2 className="text-xs font-sans font-medium font-bold text-[#60a5fa] uppercase border-b border-zinc-200 dark:border-[#27272a] pb-2 mb-2">Distribución Capital (USD)</h2>
          <div className="flex-1">
            {dataUSD.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dataUSD} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2}>
                    {dataUSD.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS_USD[index % COLORS_USD.length]} />)}
                  </Pie>
                  <RechartsTooltip contentStyle={{backgroundColor: '#09090b', borderColor: '#27272a', fontFamily: 'monospace'}} itemStyle={{color: '#e4e4e7'}} formatter={(val) => `$${Number(val).toLocaleString()}`} />
                  <Legend wrapperStyle={{fontFamily: 'monospace', fontSize: '12px', color: '#a1a1aa'}} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-center mt-20 text-zinc-500 dark:text-[#71717a] font-mono text-sm">No hay posiciones en USD</p>}
          </div>
        </div>

        {/* CLP PIE CHART */}
        <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none p-4 h-80 flex flex-col">
          <h2 className="text-xs font-sans font-medium font-bold text-[#34d399] uppercase border-b border-zinc-200 dark:border-[#27272a] pb-2 mb-2">Distribución Capital (CLP)</h2>
          <div className="flex-1">
            {dataCLP.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dataCLP} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2}>
                    {dataCLP.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS_CLP[index % COLORS_CLP.length]} />)}
                  </Pie>
                  <RechartsTooltip contentStyle={{backgroundColor: '#09090b', borderColor: '#27272a', fontFamily: 'monospace'}} itemStyle={{color: '#e4e4e7'}} formatter={(val) => `$${Number(val).toLocaleString()}`} />
                  <Legend wrapperStyle={{fontFamily: 'monospace', fontSize: '12px', color: '#a1a1aa'}} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-center mt-20 text-zinc-500 dark:text-[#71717a] font-mono text-sm">No hay posiciones en CLP</p>}
          </div>
        </div>
      </div>

      {/* PORTFOLIO TABLE */}
      <div className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded overflow-hidden">
        <table className="w-full text-left text-sm font-mono border-collapse">
          <thead className="bg-white dark:bg-[#18181b] text-zinc-600 dark:text-[#a1a1aa] text-[11px] uppercase border-b border-zinc-300 dark:border-[#3f3f46]">
            <tr>
              <th className="py-2 px-4 font-semibold">Ticker</th>
              <th className="py-2 px-4 font-semibold text-right">Cant.</th>
              <th className="py-2 px-4 font-semibold text-right">Precio Compra</th>
              <th className="py-2 px-4 font-semibold text-right">Moneda</th>
              <th className="py-2 px-4 font-semibold text-right">Capital</th>
              <th className="py-2 px-4 font-semibold text-center">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a]">
            {items.map((row) => (
              <tr key={row.id} className="hover:bg-white dark:bg-[#18181b] transition-colors">
                <td className="py-2 px-4 font-bold text-zinc-900 dark:text-[#e4e4e7]">{row.ticker}</td>
                <td className="py-2 px-4 text-right text-zinc-600 dark:text-[#a1a1aa]">{row.cantidad}</td>
                <td className="py-2 px-4 text-right text-zinc-600 dark:text-[#a1a1aa]">${row.precio_compra.toFixed(2)}</td>
                <td className="py-2 px-4 text-right text-zinc-500 dark:text-[#71717a]">{row.moneda}</td>
                <td className="py-2 px-4 text-right font-bold text-zinc-900 dark:text-[#e4e4e7]">${(row.cantidad * row.precio_compra).toLocaleString()}</td>
                <td className="py-2 px-4 text-center">
                  <button onClick={() => handleDelete(row.id)} className="text-[#f87171] hover:text-[#b91c1c] text-xs font-bold border border-[#7f1d1d] px-2 py-1 rounded transition-colors">
                    QUITAR
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-zinc-500 dark:text-[#71717a]">Portafolio vacío.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
