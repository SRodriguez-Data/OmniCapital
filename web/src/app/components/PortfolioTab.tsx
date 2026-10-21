'use client';

import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import SymbolSearchModal from './SymbolSearchModal';
import { Search, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePortfolio } from '../context/PortfolioContext';
import AssetSparkline from './AssetSparkline';
import type { TimePeriod } from './AssetSparkline';
import { fetchUsdClp } from '@/lib/fx';
import { valueOn } from '@/lib/quant';

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
    // En el celular el formulario para añadir parte cerrado: lo primero que se ve son los totales
    const [formAbierto, setFormAbierto] = useState(false);
    const [observedUsdClp, setObservedUsdClp] = useState<number | null>(null);

    const [period, setPeriod] = useState<TimePeriod>('TOTAL');
    const [globalHistory, setGlobalHistory] = useState<{ date: string; prices: Record<string, number>; fx?: number | null }[]>([]);
    const [actionError, setActionError] = useState('');

    // Cada efecto ignora su respuesta si el portafolio cambió mientras esperaba (evita pisar datos nuevos)
    useEffect(() => {
      if (items.length === 0) return;
      let cancelled = false;
      const tickers = items.map(i => i.ticker).join(',');
      fetch(`/api/portfolio/live?symbols=${encodeURIComponent(tickers)}&t=${Date.now()}`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => { if (!cancelled && data && !data.error) setLivePrices(data); })
        .catch(err => console.error('Error fetching live prices', err));
      return () => { cancelled = true; };
    }, [items]);

    useEffect(() => {
      // Dólar observado del día (Banco Central vía mindicador.cl)
      fetchUsdClp().then(rate => { if (rate) setObservedUsdClp(rate); });
    }, []);

    useEffect(() => {
      if (items.length === 0) return;
      let cancelled = false;
      fetch('/api/portfolio/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map(i => ({ ticker: i.ticker, purchase_date: i.purchase_date || null })) })
      })
        .then(res => (res.ok ? res.json() : null))
        .then((data: { dates: string[]; fx: (number | null)[]; series: Record<string, (number | null)[]> } | null) => {
          if (cancelled || !data?.dates) return;
          // La ruta responde en columnas (más liviano); aquí se arma una fila por día
          setGlobalHistory(data.dates.map((date, k) => {
            const prices: Record<string, number> = {};
            for (const [ticker, values] of Object.entries(data.series)) {
              if (values[k] !== null) prices[ticker] = values[k] as number;
            }
            return { date, prices, fx: data.fx[k] };
          }));
        })
        .catch(e => console.error('Error fetching global history', e));
      return () => { cancelled = true; };
    }, [items]);

    // Dólar de hoy: el observado del Banco Central o, si no responde, el último del historial
    const lastHistoryDay = globalHistory[globalHistory.length - 1];
    const usdClpRate = observedUsdClp ?? lastHistoryDay?.fx ?? 950;
    // Precio actual: el en vivo o, si Yahoo no lo trae, el último cierre conocido (nunca el costo)
    const currentPriceOf = (ticker: string): number | undefined => livePrices[ticker] ?? lastHistoryDay?.prices[ticker];

  // Calculamos KPIs
  let totalInvestedUSD = 0;
  let totalCurrentUSD = 0;
  let totalInvestedCLP = 0;
  let totalCurrentCLP = 0;

  items.forEach(item => {
    const cp = currentPriceOf(item.ticker);
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

  const chartDataUSD = items.filter(i => i.moneda === 'USD').map((i, index) => ({
    name: i.ticker,
    value: i.cantidad * (currentPriceOf(i.ticker) ?? i.precio_compra),
    fill: COLORS_USD[index % COLORS_USD.length]
  }));

  const chartDataCLP = items.filter(i => i.moneda === 'CLP').map((i, index) => ({
    name: i.ticker,
    value: i.cantidad * (currentPriceOf(i.ticker) ?? i.precio_compra),
    fill: COLORS_CLP[index % COLORS_CLP.length]
  }));

  const toggleRow = (id: string) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const pnlColorUSD = totalPnL_USD >= 0 ? 'text-[#34d399]' : 'text-[#f87171]';
  const pnlColorCLP = totalPnL_CLP >= 0 ? 'text-[#34d399]' : 'text-[#f87171]';

  let filteredGlobalHistory = globalHistory;
  if (period !== 'TOTAL' && globalHistory.length > 0) {
    const lastDate = new Date(globalHistory[globalHistory.length - 1].date);
    let cutoff = new Date(lastDate);
    if (period === '1S') cutoff.setDate(cutoff.getDate() - 7);
    else if (period === '1M') cutoff.setMonth(cutoff.getMonth() - 1);
    else if (period === '3M') cutoff.setMonth(cutoff.getMonth() - 3);
    else if (period === '6M') cutoff.setMonth(cutoff.getMonth() - 6);
    else if (period === 'YTD') cutoff = new Date(lastDate.getFullYear(), 0, 1);
    else if (period === '1A') cutoff.setFullYear(cutoff.getFullYear() - 1);
    
    filteredGlobalHistory = globalHistory.filter(d => new Date(d.date) >= cutoff);
    if (filteredGlobalHistory.length < 2) filteredGlobalHistory = globalHistory.slice(-2);
  } else if (globalHistory.length > 0) {
    // Si es TOTAL, se muestra desde la compra más antigua (o todo el historial si no hay fechas)
    const dates = items.map(i => i.purchase_date).filter(Boolean).sort();
    if (dates.length > 0) {
      filteredGlobalHistory = globalHistory.filter(d => d.date >= dates[0]);
      if (filteredGlobalHistory.length === 0) filteredGlobalHistory = globalHistory.slice(-2);
    }
  }

  // Dólar de cada fecha según el historial (o el de hoy si no hay dato), para medir el resultado
  // real en pesos: un activo en dólares también gana o pierde por el tipo de cambio.
  const fxSeries = new Map<string, number>();
  globalHistory.forEach(d => { if (d.fx) fxSeries.set(d.date, d.fx); });
  const fxDates = [...fxSeries.keys()];
  const fxOn = (date?: string | null) => (date ? valueOn(fxSeries, fxDates, date) : undefined) ?? usdClpRate;
  const toCLP = (value: number, currency: string, date?: string | null) =>
    currency === 'CLP' ? value : value * (date === undefined ? usdClpRate : fxOn(date));

  // Valor diario real en pesos: cada activo cuenta desde su fecha de compra, con el dólar de ese día
  const chartHistoryData = globalHistory.length > 0
    ? filteredGlobalHistory.map(day => {
        let dailyTotalCLP = 0;
        items.forEach(item => {
          if (item.purchase_date && day.date < item.purchase_date) return;
          const price = day.prices?.[item.ticker] ?? item.precio_compra;
          dailyTotalCLP += toCLP(item.cantidad * price, item.moneda, day.date);
        });
        return { date: day.date, totalValue: dailyTotalCLP };
      })
    : [{ date: 'Compra Inicial', totalValue: totalInvestedCombinedCLP }, { date: 'Actual', totalValue: totalCurrentCombinedCLP }];

  // Precio de partida de cada activo en el período elegido. Si se compró dentro
  // del período, su base es el precio de compra (no el precio de mercado al inicio).
  const periodStart = period !== 'TOTAL' ? filteredGlobalHistory[0] : undefined;
  const boughtInPeriod = (item: { purchase_date: string }) => !periodStart || (!!item.purchase_date && item.purchase_date > periodStart.date);
  const startPriceFor = (item: { ticker: string; precio_compra: number; purchase_date: string }) => {
    if (boughtInPeriod(item)) return item.precio_compra;
    return periodStart?.prices?.[item.ticker] ?? item.precio_compra;
  };

  // Base en pesos: el costo con el dólar del día de compra, o el valor al inicio del período con el dólar de ese día
  const dynamicInvestedCombinedCLP = items.reduce((sum, item) => sum + toCLP(
    item.cantidad * startPriceFor(item),
    item.moneda,
    boughtInPeriod(item) ? item.purchase_date || null : periodStart!.date,
  ), 0);
  // Siempre contra el valor en vivo, para no mostrar un P&L desactualizado de ayer
  const dynamicCurrentCombinedCLP = totalCurrentCombinedCLP;

  const dynamicPnL_CombinedCLP = dynamicCurrentCombinedCLP - dynamicInvestedCombinedCLP;
  const dynamicPnL_Percent_CombinedCLP = dynamicInvestedCombinedCLP > 0 ? (dynamicPnL_CombinedCLP / dynamicInvestedCombinedCLP) * 100 : 0;
  const dynamicPnlColorCombined = dynamicPnL_CombinedCLP >= 0 ? 'text-[#34d399]' : 'text-[#f87171]';

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
    setActionError('');
    if (isDemo || isCartolaMode) {
      if (isDemo) {
        setActionError('El modo Demo es de solo lectura. Crea una cuenta para gestionar tu propio portafolio.');
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
        const dbItemResponse = await res.json();
        setTicker(''); setCantidad(''); setPrecio(''); setPurchaseDate('');
        
        // Si el usuario tiene una mezcla de items locales (cartola) y DB,
        // no llamamos a refreshPortfolio() porque borraría los locales.
        // Simplemente añadimos el nuevo item (o recargamos si no hay locales).
        const hasLocalItems = items.some(i => i.id.startsWith('cartola-'));
        if (hasLocalItems) {
          // Add manually to state to preserve local cartola items
          const newItem = Array.isArray(dbItemResponse) ? dbItemResponse[0] : dbItemResponse;
          if (newItem) setItems(prev => [...prev, newItem]);
        } else {
          await refreshPortfolio();
        }
      } else {
        const body = await res.json().catch(() => ({}));
        setActionError(`No se pudo añadir ${ticker.toUpperCase()}: ${body.error || res.statusText}`);
      }
    } catch {
      setActionError('Error de red al añadir el activo. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setActionError('');
    // Si es un item generado localmente (por cartola), lo borramos del estado y listo
    if (id.startsWith('cartola-') || isDemo || isCartolaMode) {
      if (isDemo) {
        setActionError('El modo Demo es de solo lectura. Crea una cuenta para gestionar tu propio portafolio.');
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
        const hasLocalItems = items.some(i => i.id.startsWith('cartola-'));
        if (hasLocalItems) {
          setItems(prev => prev.filter(item => item.id !== id));
        } else {
          await refreshPortfolio();
        }
      } else {
        const body = await res.json().catch(() => ({}));
        setActionError(`No se pudo quitar el activo: ${body.error || res.statusText}`);
      }
    } catch {
      setActionError('Error de red al quitar el activo. Intenta de nuevo.');
    }
  };

  // Montos en su moneda: CLP sin decimales, USD con 2
  const fmtMoney = (value: number, currency: string) => currency === 'CLP'
    ? `$${value.toLocaleString('es-CL', { maximumFractionDigits: 0 })}`
    : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Distribución según valor de mercado actual (o costo si aún no hay precio en vivo)
  const dataUSD = chartDataUSD;
  const dataCLP = chartDataCLP;

  if (loading) return <div className="text-center p-12 font-mono text-zinc-600 dark:text-[#a1a1aa]">Cargando portafolio...</div>;

  return (
    <div className="flex flex-col gap-6">

      {actionError && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm font-mono border border-red-200 dark:border-red-900/50 flex justify-between items-center gap-4">
          <span>{actionError}</span>
          <button onClick={() => setActionError('')} className="text-xs font-bold hover:underline">CERRAR</button>
        </div>
      )}

      {/* ADD NEW ITEM FORM */}
      <button
        onClick={() => setFormAbierto(!formAbierto)}
        className="md:hidden flex items-center justify-center gap-2 w-full py-2.5 rounded border border-dashed border-blue-400 dark:border-[#3b82f6]/60 text-blue-600 dark:text-[#60a5fa] text-xs font-mono font-bold uppercase"
      >
        <Plus className={`w-4 h-4 transition-transform duration-300 ${formAbierto ? 'rotate-45' : ''}`} /> {formAbierto ? 'Cerrar' : 'Añadir activo'}
      </button>
      <div className={`${formAbierto ? 'flex' : 'hidden'} md:flex bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] p-4 rounded flex-col md:flex-row gap-4 items-end`}>
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
        <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none p-4 md:p-6 h-[28rem] md:h-96 flex flex-col">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-zinc-200 dark:border-[#27272a] pb-4 mb-6 gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-sans font-medium font-bold text-zinc-900 dark:text-[#e4e4e7] uppercase">Evolución P&L Global (Real)</h2>
              <div className="flex bg-zinc-100 dark:bg-[#09090b] rounded-lg p-1 w-fit border border-zinc-200 dark:border-[#27272a]">
                {(['1S', '1M', '3M', '6M', 'YTD', '1A', 'TOTAL'] as TimePeriod[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1 text-xs font-mono rounded-md transition-colors ${period === p ? 'bg-white dark:bg-[#27272a] text-zinc-900 dark:text-[#f4f4f5] shadow-sm border border-zinc-200 dark:border-[#3f3f46]' : 'text-zinc-500 dark:text-[#a1a1aa] hover:text-zinc-700 dark:hover:text-[#e4e4e7]'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[10px] text-zinc-500 dark:text-[#71717a] font-mono uppercase" title="Los activos en dólares se valorizan con el dólar del día de compra (o del inicio del período) y el de hoy, así que incluye la ganancia o pérdida cambiaria">P&L Consolidado en pesos (incl. dólar)</p>
              <div className="flex items-baseline justify-end gap-2">
                <p className={`text-lg font-bold font-mono ${dynamicPnlColorCombined}`}>
                  {dynamicPnL_CombinedCLP >= 0 ? '+' : ''}${dynamicPnL_CombinedCLP.toLocaleString('es-CL', {minimumFractionDigits: 0, maximumFractionDigits: 0})}
                </p>
                <p className={`text-xs font-bold font-mono ${dynamicPnlColorCombined} bg-opacity-10 px-1 py-0.5 rounded`}>
                  {dynamicPnL_Percent_CombinedCLP >= 0 ? '+' : ''}{dynamicPnL_Percent_CombinedCLP.toFixed(2)}%
                </p>
              </div>
            </div>
          </div>
          <div className="flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartHistoryData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
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
                  formatter={(value, name) => [`$${Number(value).toLocaleString('es-CL', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`, name]}
                />
                <Area 
                  type="monotone" 
                  dataKey="totalValue" 
                  stroke={dynamicPnL_CombinedCLP >= 0 ? "#34d399" : "#f87171"} 
                  fill={dynamicPnL_CombinedCLP >= 0 ? "url(#colorProfit)" : "url(#colorLoss)"} 
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
          <h2 className="text-xs font-sans font-medium font-bold text-[#60a5fa] uppercase border-b border-zinc-200 dark:border-[#27272a] pb-2 mb-2">Distribución Actual (USD)</h2>
          <div className="flex-1">
            {dataUSD.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dataUSD} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2}>
                    {dataUSD.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS_USD[index % COLORS_USD.length]} />)}
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
          <h2 className="text-xs font-sans font-medium font-bold text-[#34d399] uppercase border-b border-zinc-200 dark:border-[#27272a] pb-2 mb-2">Distribución Actual (CLP)</h2>
          <div className="flex-1">
            {dataCLP.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={dataCLP} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2}>
                    {dataCLP.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS_CLP[index % COLORS_CLP.length]} />)}
                  </Pie>
                  <RechartsTooltip contentStyle={{backgroundColor: '#09090b', borderColor: '#27272a', fontFamily: 'monospace'}} itemStyle={{color: '#e4e4e7'}} formatter={(val) => `$${Number(val).toLocaleString()}`} />
                  <Legend wrapperStyle={{fontFamily: 'monospace', fontSize: '12px', color: '#a1a1aa'}} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-center mt-20 text-zinc-500 dark:text-[#71717a] font-mono text-sm">No hay posiciones en CLP</p>}
          </div>
        </div>
      </div>

      {/* KPI Cards: en el celular van primero, de a dos por fila */}
      <div className="order-first md:order-none grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6">
        {/* USD Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 [&>div:last-child]:col-span-2 md:[&>div:last-child]:col-span-1">
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-[#60a5fa] uppercase tracking-wider mb-1">Valor Total (USD)</span>
            <span className="text-lg md:text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa]">${totalCurrentUSD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-1">Invertido (USD)</span>
            <span className="text-lg md:text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa]">${totalInvestedUSD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
          </div>
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-1">P&L (USD)</span>
            <div className="flex items-baseline gap-2">
              <span className={`text-lg md:text-xl font-bold font-sans ${pnlColorUSD}`}>
                {totalPnL_USD >= 0 ? '+' : ''}{totalPnL_USD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </span>
              <span className={`text-xs font-bold font-mono ${pnlColorUSD} bg-opacity-10 px-1 py-0.5 rounded`}>
                {totalPnL_Percent_USD >= 0 ? '+' : ''}{totalPnL_Percent_USD.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* CLP Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 [&>div:last-child]:col-span-2 md:[&>div:last-child]:col-span-1">
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-[#34d399] uppercase tracking-wider mb-1">Valor Total (CLP)</span>
            <span className="text-lg md:text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa]">${totalCurrentCLP.toLocaleString('es-CL', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>
          </div>
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-1">Invertido (CLP)</span>
            <span className="text-lg md:text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa]">${totalInvestedCLP.toLocaleString('es-CL', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>
          </div>
          <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-col justify-center">
            <span className="text-[10px] font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-1">P&L (CLP)</span>
            <div className="flex items-baseline gap-2">
              <span className={`text-lg md:text-xl font-bold font-sans ${pnlColorCLP}`}>
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
      <div className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded overflow-x-auto">
        <table className="w-full text-left text-sm font-mono border-collapse whitespace-nowrap">
          <thead className="bg-white dark:bg-[#18181b] text-zinc-600 dark:text-[#a1a1aa] text-[11px] uppercase border-b border-zinc-300 dark:border-[#3f3f46]">
            <tr>
              <th className="py-2 px-4 font-semibold w-10"></th>
              <th className="py-2 px-4 font-semibold">Ticker</th>
              <th className="py-2 px-4 font-semibold text-right">Cant.</th>
              <th className="py-2 px-4 font-semibold text-right">Fecha Compra</th>
              <th className="py-2 px-4 font-semibold text-right">{period === 'TOTAL' ? 'Precio Compra' : 'Precio Inicial'}</th>
              <th className="py-2 px-4 font-semibold text-right">Precio Actual</th>
              <th className="py-2 px-4 font-semibold text-right">Moneda</th>
              <th className="py-2 px-4 font-semibold text-right">{period === 'TOTAL' ? 'Invertido' : 'Valor Inicial'}</th>
              <th className="py-2 px-4 font-semibold text-right">Valor Actual</th>
              <th className="py-2 px-4 font-semibold text-right">P&L</th>
              <th className="py-2 px-4 font-semibold text-center">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a]">
            {items.map((row) => {
              const currentPrice = currentPriceOf(row.ticker);
              const startPrice = startPriceFor(row);
              const invested = row.cantidad * startPrice;
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
                    <td className="py-2 px-4 text-right">{fmtMoney(startPrice, row.moneda)}</td>
                    <td className="py-2 px-4 text-right">
                      {currentPrice !== undefined ? fmtMoney(currentPrice, row.moneda) : <span className="text-zinc-500">N/A</span>}
                    </td>
                    <td className="py-2 px-4 text-right text-xs text-zinc-500">{row.moneda}</td>
                    <td className="py-2 px-4 text-right">{fmtMoney(invested, row.moneda)}</td>
                    <td className="py-2 px-4 text-right">
                      {currentVal !== undefined ? fmtMoney(currentVal, row.moneda) : <span className="text-zinc-500">N/A</span>}
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
                        <AssetSparkline ticker={row.ticker} purchaseDate={row.purchase_date} period={period} />
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
