'use client';

import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';

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
  const [loading, setLoading] = useState(true);
  
  // Form state
  const [ticker, setTicker] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [precio, setPrecio] = useState('');
  const [moneda, setMoneda] = useState<'USD'|'CLP'>('USD');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchPortfolio();
  }, []);

  const fetchPortfolio = async () => {
    try {
      const res = await fetch('/api/portfolio');
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      }
    } catch (error) {
      console.error("Error fetching portfolio", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      }
    } catch (error) {
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/portfolio?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchPortfolio();
      }
    } catch (error) {
      console.error(error);
    }
  };

  const dataUSD = items.filter(i => i.moneda === 'USD').map(i => ({ name: i.ticker, value: i.cantidad * i.precio_compra }));
  const dataCLP = items.filter(i => i.moneda === 'CLP').map(i => ({ name: i.ticker, value: i.cantidad * i.precio_compra }));

  if (loading) return <div className="text-center p-12 font-mono text-[#a1a1aa]">Loading portfolio...</div>;

  return (
    <div className="space-y-6">
      
      {/* ADD NEW ITEM FORM */}
      <div className="bg-[#18181b] border border-[#27272a] p-4 rounded flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 w-full">
          <label className="block text-xs font-mono text-[#71717a] mb-1">Ticker / Activo</label>
          <input 
            type="text" 
            placeholder="Ej: VOO, SQM-B.SN" 
            value={ticker}
            onChange={e => setTicker(e.target.value)}
            className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-2 text-sm font-mono focus:outline-none focus:border-[#60a5fa]"
          />
        </div>
        <div className="w-full md:w-32">
          <label className="block text-xs font-mono text-[#71717a] mb-1">Cantidad</label>
          <input 
            type="number" 
            placeholder="0.0" 
            value={cantidad}
            onChange={e => setCantidad(e.target.value)}
            className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-2 text-sm font-mono focus:outline-none focus:border-[#60a5fa]"
          />
        </div>
        <div className="w-full md:w-32">
          <label className="block text-xs font-mono text-[#71717a] mb-1">Precio Compra</label>
          <input 
            type="number" 
            placeholder="0.0" 
            value={precio}
            onChange={e => setPrecio(e.target.value)}
            className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-2 text-sm font-mono focus:outline-none focus:border-[#60a5fa]"
          />
        </div>
        <div className="w-full md:w-24">
          <label className="block text-xs font-mono text-[#71717a] mb-1">Moneda</label>
          <select 
            value={moneda}
            onChange={e => setMoneda(e.target.value as 'USD'|'CLP')}
            className="w-full bg-[#09090b] border border-[#3f3f46] text-[#e4e4e7] p-2 text-sm font-mono focus:outline-none focus:border-[#60a5fa]"
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* USD PIE CHART */}
        <div className="bg-[#18181b] border border-[#27272a] rounded p-4 h-80 flex flex-col">
          <h2 className="text-xs font-mono font-bold text-[#60a5fa] uppercase border-b border-[#27272a] pb-2 mb-2">Distribución Capital (USD)</h2>
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
            ) : <p className="text-center mt-20 text-[#71717a] font-mono text-sm">No hay posiciones en USD</p>}
          </div>
        </div>

        {/* CLP PIE CHART */}
        <div className="bg-[#18181b] border border-[#27272a] rounded p-4 h-80 flex flex-col">
          <h2 className="text-xs font-mono font-bold text-[#34d399] uppercase border-b border-[#27272a] pb-2 mb-2">Distribución Capital (CLP)</h2>
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
            ) : <p className="text-center mt-20 text-[#71717a] font-mono text-sm">No hay posiciones en CLP</p>}
          </div>
        </div>
      </div>

      {/* PORTFOLIO TABLE */}
      <div className="bg-[#09090b] border border-[#27272a] rounded overflow-hidden">
        <table className="w-full text-left text-sm font-mono border-collapse">
          <thead className="bg-[#18181b] text-[#a1a1aa] text-[11px] uppercase border-b border-[#3f3f46]">
            <tr>
              <th className="py-2 px-4 font-semibold">Ticker</th>
              <th className="py-2 px-4 font-semibold text-right">Cant.</th>
              <th className="py-2 px-4 font-semibold text-right">Precio Compra</th>
              <th className="py-2 px-4 font-semibold text-right">Moneda</th>
              <th className="py-2 px-4 font-semibold text-right">Capital</th>
              <th className="py-2 px-4 font-semibold text-center">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#27272a]">
            {items.map((row) => (
              <tr key={row.id} className="hover:bg-[#18181b] transition-colors">
                <td className="py-2 px-4 font-bold text-[#e4e4e7]">{row.ticker}</td>
                <td className="py-2 px-4 text-right text-[#a1a1aa]">{row.cantidad}</td>
                <td className="py-2 px-4 text-right text-[#a1a1aa]">${row.precio_compra.toFixed(2)}</td>
                <td className="py-2 px-4 text-right text-[#71717a]">{row.moneda}</td>
                <td className="py-2 px-4 text-right font-bold text-[#e4e4e7]">${(row.cantidad * row.precio_compra).toLocaleString()}</td>
                <td className="py-2 px-4 text-center">
                  <button onClick={() => handleDelete(row.id)} className="text-[#f87171] hover:text-[#b91c1c] text-xs font-bold border border-[#7f1d1d] px-2 py-1 rounded transition-colors">
                    QUITAR
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-[#71717a]">Portafolio vacío.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
