/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import SymbolSearchModal from './SymbolSearchModal';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import AssetSparkline from './AssetSparkline';

const COLORS_USD = ['#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'];
const COLORS_CLP = ['#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b'];

export default function PortfolioTab() {
  const { items, loading, isDemo, isCartolaMode, refreshPortfolio, setItems } = usePortfolio();
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  
  // Form state
  const [ticker, setTicker] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [precio, setPrecio] = useState('');
  const [moneda, setMoneda] = useState<'USD'|'CLP'>('USD');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [usdClpRate, setUsdClpRate] = useState<number>(930);

  useEffect(() => {
    async function fetchLivePrices() {
      if (items.length === 0) return;
      const tickers = items.map(i => i.ticker).join(',');
      try {
        const res = await fetch(`/api/portfolio/live?symbols=${encodeURIComponent(tickers)}`);
        if (res.ok) {
          const data = await res.json();
          setLivePrices(data);
        }
      } catch (err) {
        console.error("Error fetching live prices", err);
      }
    }
    fetchLivePrices();

    // Fetch real USDCLP rate
    fetch('https://mindicador.cl/api/dolar')
      .then(res => res.json())
      .then(data => {
         if (data && data.serie && data.serie.length > 0) {
           setUsdClpRate(data.serie[0].valor);
         }
      })
      .catch(() => console.log('Failed to fetch USDCLP'));
  }, [items]);

  // Calculamos KPIs
  let totalInvestedUSD = 0;
  let totalCurrentUSD = 0;
  let totalInvestedCLP = 0;
  let totalCurrentCLP = 0;

  items.forEach(item => {
    const cp = livePrices[item.ticker];
    if (item.moneda === 'USD') {
      totalInvestedUSD += item.cantidad * item.precio_compra;
      if (cp !== undefined) totalCurrentUSD += item.cantidad * cp;
      else totalCurrentUSD += item.cantidad * item.precio_compra;
    } else {
      totalInvestedCLP += item.cantidad * item.precio_compra;
      if (cp !== undefined) totalCurrentCLP += item.cantidad * cp;
      else totalCurrentCLP += item.cantidad * item.precio_compra;
    }
  });

  const totalPnL_USD = totalCurrentUSD - totalInvestedUSD;
  const totalPnL_Percent_USD = totalInvestedUSD > 0 ? (totalPnL_USD / totalInvestedUSD) * 100 : 0;

  const totalPnL_CLP = totalCurrentCLP - totalInvestedCLP;
  const totalPnL_Percent_CLP = totalInvestedCLP > 0 ? (totalPnL_CLP / totalInvestedCLP) * 100 : 0;

  const totalInvestedCombinedCLP = totalInvestedCLP + (totalInvestedUSD * usdClpRate);
  const totalCurrentCombinedCLP = totalCurrentCLP + (totalCurrentUSD * usdClpRate);
  const totalPnL_CombinedCLP = totalCurrentCombinedCLP - totalInvestedCombinedCLP;
  const totalPnL_Percent_CombinedCLP = totalInvestedCombinedCLP > 0 ? (totalPnL_CombinedCLP / totalInvestedCombinedCLP) * 100 : 0;

  const chartDataUSD = items.filter(i => i.moneda === 'USD').map((i, index) => ({
    name: i.ticker,
    value: livePrices[i.ticker] ? i.cantidad * livePrices[i.ticker] : i.cantidad * i.precio_compra,
    fill: COLORS_USD[index % COLORS_USD.length]
  }));

  const chartDataCLP = items.filter(i => i.moneda === 'CLP').map((i, index) => ({
    name: i.ticker,
    value: livePrices[i.ticker] ? i.cantidad * livePrices[i.ticker] : i.cantidad * i.precio_compra,
    fill: COLORS_CLP[index % COLORS_CLP.length]
  }));

  const toggleRow = (id: string) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const pnlColorUSD = totalPnL_USD >= 0 ? 'text-[#34d399]' : 'text-[#f87171]';
  const pnlColorCLP = totalPnL_CLP >= 0 ? 'text-[#34d399]' : 'text-[#f87171]';
  const pnlColorCombined = totalPnL_CombinedCLP >= 0 ? 'text-[#34d399]' : 'text-[#f87171]';

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
    if (isDemo || isCartolaMode) {
      if (isDemo) {
        alert("⛔ Operación de escritura bloqueada. El modo Jurado (Demo) es de solo lectura y tus datos están aislados por seguridad.");
      } else {
        const newItem = {
          id: `cartola-manual-${Math.random().toString(36).substr(2, 9)}`,
          ticker: ticker.toUpperCase(),
          cantidad: Number(cantidad),
          precio_compra: Number(precio),
          moneda,
          purchase_date: purchaseDate || new Date().toISOString().split('T')[0]
        };
        setItems(prev => [...prev, newItem]);
      }
      setTicker(''); setCantidad(''); setPrecio(''); setPurchaseDate('');
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
          moneda,
          purchase_date: purchaseDate
        })
      });
      if (res.ok) {
        setTicker(''); setCantidad(''); setPrecio(''); setPurchaseDate('');
        await refreshPortfolio();
      }
    } catch {
      console.error("Error al añadir");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (isDemo || isCartolaMode) {
      if (isDemo) {
        alert("⛔ Operación de eliminación bloqueada. El modo Jurado (Demo) es de solo lectura.");
      } else {
        setItems(prev => prev.filter(item => item.id !== id));
      }
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/portfolio?id=${id}`, { 
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      if (res.ok) {
        await refreshPortfolio();
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
        <div className="w-full md:w-36">
          <label className="block text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] mb-1">Fecha Compra</label>
          <input 
            type="date" 
            value={purchaseDate}
            onChange={e => setPurchaseDate(e.target.value)}
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
          disabled={submitting || !ticker || !cantidad || !precio || !purchaseDate}
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
      {items.length > 0 && (
        <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none p-6 h-96 flex flex-col">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-zinc-200 dark:border-[#27272a] pb-4 mb-6 gap-4">
            <div>
              <h2 className="text-xs font-sans font-medium font-bold text-zinc-900 dark:text-[#e4e4e7] uppercase">Evolución P&L Global (Real)</h2>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[10px] text-zinc-500 dark:text-[#71717a] font-mono uppercase">P&L Actual Consolidado (CLP)</p>
              <div className="flex items-baseline justify-end gap-2">
                <p className={`text-lg font-bold font-mono ${pnlColorCombined}`}>
                  {totalPnL_CombinedCLP >= 0 ? '+' : ''}${totalPnL_CombinedCLP.toLocaleString('es-CL', {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                </p>
                <p className={`text-xs font-bold font-mono ${pnlColorCombined} bg-opacity-10 px-1 py-0.5 rounded`}>
                  {totalPnL_Percent_CombinedCLP >= 0 ? '+' : ''}{totalPnL_Percent_CombinedCLP.toFixed(2)}%
                </p>
              </div>
            </div>
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={[{ date: 'Compra Inicial', totalValue: totalInvestedCombinedCLP }, { date: 'Actual', totalValue: totalCurrentCombinedCLP }]} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
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
                <XAxis dataKey="date" stroke="#71717a" fontSize={10} tickMargin={10} axisLine={false} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={10} tickFormatter={(val) => `$${val.toLocaleString('es-CL')}`} axisLine={false} tickLine={false} width={80} domain={['auto', 'auto']} />
                <RechartsTooltip 
                  contentStyle={{backgroundColor: '#09090b', borderColor: '#27272a', fontFamily: 'monospace'}} 
                  itemStyle={{color: '#e4e4e7'}} 
                  labelStyle={{color: '#71717a'}}
                  formatter={(value: any, name: any) => [`$${Number(value).toLocaleString('es-CL', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`, name]}
                />
                <Area 
                  type="monotone" 
                  dataKey="totalValue" 
                  stroke={totalPnL_CombinedCLP >= 0 ? "#34d399" : "#f87171"} 
                  fill={totalPnL_CombinedCLP >= 0 ? "url(#colorProfit)" : "url(#colorLoss)"} 
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* USD Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-[#60a5fa] uppercase tracking-wider mb-1">Valor Total (USD)</span>
            <span className="text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa]">${totalCurrentUSD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-1">Invertido (USD)</span>
            <span className="text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa]">${totalInvestedUSD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-1">P&L (USD)</span>
            <div className="flex items-baseline gap-2">
              <span className={`text-xl font-bold font-sans ${pnlColorUSD}`}>
                {totalPnL_USD >= 0 ? '+' : ''}{totalPnL_USD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </span>
              <span className={`text-xs font-bold font-mono ${pnlColorUSD} bg-opacity-10 px-1 py-0.5 rounded`}>
                {totalPnL_Percent_USD >= 0 ? '+' : ''}{totalPnL_Percent_USD.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* CLP Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-[#34d399] uppercase tracking-wider mb-1">Valor Total (CLP)</span>
            <span className="text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa]">${totalCurrentCLP.toLocaleString('es-CL', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>
          </div>
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-1">Invertido (CLP)</span>
            <span className="text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa]">${totalInvestedCLP.toLocaleString('es-CL', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>
          </div>
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-1">P&L (CLP)</span>
            <div className="flex items-baseline gap-2">
              <span className={`text-xl font-bold font-sans ${pnlColorCLP}`}>
                {totalPnL_CLP >= 0 ? '+' : ''}{totalPnL_CLP.toLocaleString('es-CL', {minimumFractionDigits: 0, maximumFractionDigits: 0})}
              </span>
              <span className={`text-xs font-bold font-mono ${pnlColorCLP} bg-opacity-10 px-1 py-0.5 rounded`}>
                {totalPnL_Percent_CLP >= 0 ? '+' : ''}{totalPnL_Percent_CLP.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* PORTFOLIO TABLE */}
      <div className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded overflow-hidden">
        <table className="w-full text-left text-sm font-mono border-collapse">
          <thead className="bg-white dark:bg-[#18181b] text-zinc-600 dark:text-[#a1a1aa] text-[11px] uppercase border-b border-zinc-300 dark:border-[#3f3f46]">
            <tr>
              <th className="py-2 px-4 font-semibold w-10"></th>
              <th className="py-2 px-4 font-semibold">Ticker</th>
              <th className="py-2 px-4 font-semibold text-right">Cant.</th>
              <th className="py-2 px-4 font-semibold text-right">Fecha Compra</th>
              <th className="py-2 px-4 font-semibold text-right">Precio Compra</th>
              <th className="py-2 px-4 font-semibold text-right">Precio Actual</th>
              <th className="py-2 px-4 font-semibold text-right">Moneda</th>
              <th className="py-2 px-4 font-semibold text-right">Invertido</th>
              <th className="py-2 px-4 font-semibold text-right">Valor Actual</th>
              <th className="py-2 px-4 font-semibold text-right">P&L</th>
              <th className="py-2 px-4 font-semibold text-center">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a]">
            {items.map((row) => {
              const currentPrice = livePrices[row.ticker];
              const invested = row.cantidad * row.precio_compra;
              const currentVal = currentPrice !== undefined ? row.cantidad * currentPrice : undefined;
              const pnlVal = currentVal !== undefined ? currentVal - invested : undefined;
              const pnlPct = pnlVal !== undefined && invested > 0 ? (pnlVal / invested) * 100 : undefined;
              const isWin = pnlVal !== undefined && pnlVal >= 0;
              
              return (
                <React.Fragment key={row.id}>
                  <tr className="hover:bg-white dark:bg-[#18181b] transition-colors cursor-pointer" onClick={() => toggleRow(row.id)}>
                    <td className="py-2 px-4 text-center">
                      {expandedRows[row.id] ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                    </td>
                    <td className="py-2 px-4 font-bold text-zinc-900 dark:text-[#e4e4e7]">{row.ticker}</td>
                    <td className="py-2 px-4 text-right">{row.cantidad.toLocaleString('en-US', {maximumFractionDigits: 4})}</td>
                    <td className="py-2 px-4 text-right">{row.purchase_date || '-'}</td>
                    <td className="py-2 px-4 text-right">${row.precio_compra.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td className="py-2 px-4 text-right">
                      {currentPrice !== undefined ? `$${currentPrice.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : <span className="text-zinc-500">N/A</span>}
                    </td>
                    <td className="py-2 px-4 text-right text-xs text-zinc-500">{row.moneda}</td>
                    <td className="py-2 px-4 text-right">${invested.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    <td className="py-2 px-4 text-right">
                      {currentVal !== undefined ? `$${currentVal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : <span className="text-zinc-500">N/A</span>}
                    </td>
                    <td className={`py-2 px-4 text-right font-bold ${currentVal !== undefined ? (isWin ? 'text-[#34d399]' : 'text-[#f87171]') : 'text-zinc-500'}`}>
                      {pnlPct !== undefined ? `${isWin ? '+' : ''}${pnlPct.toFixed(2)}%` : 'N/A'}
                    </td>
                    <td className="py-2 px-4 text-center">
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(row.id); }} className="text-[#f87171] hover:text-[#b91c1c] text-xs font-bold border border-[#7f1d1d] px-2 py-1 rounded transition-colors">
                        QUITAR
                      </button>
                    </td>
                  </tr>
                  {expandedRows[row.id] && (
                    <tr className="bg-zinc-100 dark:bg-[#111113]">
                      <td colSpan={11} className="p-4 border-t border-zinc-200 dark:border-[#27272a]">
                        <AssetSparkline ticker={row.ticker} purchaseDate={row.purchase_date} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={11} className="py-8 text-center text-zinc-500 dark:text-[#71717a]">Portafolio vacío.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
