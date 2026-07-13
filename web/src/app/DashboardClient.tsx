'use client';

import React, { useMemo } from 'react';
import { Activity, TrendingUp, ShieldAlert, BarChart3, BrainCircuit, Target, Lightbulb, AlertTriangle } from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell 
} from 'recharts';
import { motion } from 'framer-motion';

interface MarketData {
  id?: number;
  date?: string;
  ticker: string;
  close?: number;
  price?: number;
  rsi: number;
  pvc_ema200?: number;
  distancia_ema200?: number;
  vol_20d?: number;
  score?: number;
}

interface AiReport {
  fecha: string;
  candidatos_json: MarketData[];
  vision_radar: string;
  seleccion_fondo: string;
  setup_tecnico: string;
}

export default function DashboardClient({ 
  initialData, 
  aiReport 
}: { 
  initialData: MarketData[], 
  aiReport: AiReport | null 
}) {
  
  // Use AI Report candidates if available, otherwise calculate from raw DB data
  const opportunities = useMemo(() => {
    if (aiReport && aiReport.candidatos_json && aiReport.candidatos_json.length > 0) {
      return aiReport.candidatos_json;
    }
    
    return initialData
      .filter(d => d.rsi < 50 && (d.pvc_ema200 || 0) > -0.15)
      .map(d => ({
        ...d,
        price: d.close || 0,
        distancia_ema200: d.pvc_ema200 || 0,
        score: (50 - d.rsi) + ((d.pvc_ema200 || 0) * 100)
      }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 5);
  }, [initialData, aiReport]);

  const chartData = useMemo(() => {
    return opportunities.map(o => ({
      name: o.ticker,
      RSI: parseFloat(o.rsi.toFixed(1)),
      EMA_Dist: parseFloat(((o.distancia_ema200 || 0) * 100).toFixed(1))
    }));
  }, [opportunities]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1, 
      transition: { staggerChildren: 0.1 } 
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { type: "spring", stiffness: 100 } }
  };

  return (
    <motion.div 
      className="space-y-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      
      {/* AI HERO SECTION */}
      {aiReport && (
        <motion.div variants={itemVariants} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Top Pick / Selection */}
          <div className="col-span-1 lg:col-span-2 relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-slate-900/80 p-8 shadow-2xl backdrop-blur-xl">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-emerald-500/20 blur-2xl"></div>
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-emerald-500/20 p-3 rounded-xl border border-emerald-500/40">
                <BrainCircuit className="h-6 w-6 text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">
                La Selección del Fondo
              </h2>
            </div>
            <p className="text-gray-300 text-lg leading-relaxed font-light">
              {aiReport.seleccion_fondo}
            </p>
          </div>

          {/* Radar Vision */}
          <div className="col-span-1 rounded-2xl border border-blue-500/20 bg-blue-950/20 p-6 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-3 mb-4">
              <Lightbulb className="h-5 w-5 text-blue-400" />
              <h3 className="text-xl font-semibold text-blue-100">Visión del Radar</h3>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              {aiReport.vision_radar}
            </p>
          </div>

        </motion.div>
      )}

      {/* QUANT METRICS */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="group rounded-2xl border border-white/5 bg-white/5 p-6 shadow-lg backdrop-blur-sm transition-all hover:bg-white/10">
          <div className="flex items-center gap-4">
            <div className="bg-blue-500/10 p-3 rounded-full group-hover:scale-110 transition-transform">
              <Activity className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-400">Universo Escaneado</p>
              <h3 className="text-3xl font-extrabold text-white">{initialData.length}</h3>
            </div>
          </div>
        </div>
        
        <div className="group rounded-2xl border border-white/5 bg-white/5 p-6 shadow-lg backdrop-blur-sm transition-all hover:bg-white/10">
          <div className="flex items-center gap-4">
            <div className="bg-purple-500/10 p-3 rounded-full group-hover:scale-110 transition-transform">
              <ShieldAlert className="h-6 w-6 text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-400">Anomalías de Alta Convicción</p>
              <h3 className="text-3xl font-extrabold text-white">{opportunities.length}</h3>
            </div>
          </div>
        </div>

        {aiReport && (
          <div className="group rounded-2xl border border-rose-500/20 bg-rose-950/20 p-6 shadow-lg backdrop-blur-sm transition-all hover:bg-rose-950/40">
            <div className="flex items-center gap-3 mb-2">
              <AlertTriangle className="h-5 w-5 text-rose-400" />
              <h3 className="text-sm font-semibold text-rose-200">Setup & Riesgo</h3>
            </div>
            <p className="text-rose-100/70 text-xs leading-relaxed line-clamp-3">
              {aiReport.setup_tecnico}
            </p>
          </div>
        )}
      </motion.div>

      {/* TABLES AND CHARTS */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        
        {/* Table of Opportunities */}
        <div className="col-span-1 lg:col-span-2 rounded-2xl border border-white/10 bg-[#111111]/80 p-6 shadow-2xl backdrop-blur-md">
          <h2 className="mb-6 flex items-center gap-3 text-xl font-bold text-white">
            <Target className="text-emerald-400 h-6 w-6" /> 
            Top Anomalías Técnicas
          </h2>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-gray-400">
                <tr>
                  <th className="pb-4 font-semibold uppercase tracking-wider text-xs">Activo</th>
                  <th className="pb-4 font-semibold uppercase tracking-wider text-xs">Precio</th>
                  <th className="pb-4 font-semibold uppercase tracking-wider text-xs">RSI (14)</th>
                  <th className="pb-4 font-semibold uppercase tracking-wider text-xs">Distancia EMA200</th>
                  <th className="pb-4 font-semibold uppercase tracking-wider text-xs">Quant Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {opportunities.map((row, idx) => (
                  <motion.tr 
                    key={row.ticker} 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className="transition-colors hover:bg-white/5"
                  >
                    <td className="py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-bold text-base">{idx + 1}.</span>
                        <span className="font-bold text-white tracking-wide">{row.ticker}</span>
                      </div>
                    </td>
                    <td className="py-4 text-gray-300">${(row.price || row.close || 0).toFixed(2)}</td>
                    <td className="py-4">
                      <span className={`inline-flex items-center rounded-md px-2 py-1 font-bold ${
                        row.rsi < 30 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-gray-300'
                      }`}>
                        {row.rsi.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                        (row.distancia_ema200 || row.pvc_ema200 || 0) < 0 
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' 
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {((row.distancia_ema200 || row.pvc_ema200 || 0) * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-4 font-black text-blue-400">
                      {(row.score || 0).toFixed(1)}
                    </td>
                  </motion.tr>
                ))}
                {opportunities.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-gray-500 font-medium">
                      El motor cuántico no ha detectado anomalías de alta probabilidad hoy.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RSI Chart */}
        <div className="col-span-1 rounded-2xl border border-white/10 bg-[#111111]/80 p-6 shadow-2xl backdrop-blur-md flex flex-col">
          <h2 className="mb-6 flex items-center gap-2 text-xl font-bold text-white">
            <BarChart3 className="text-blue-400 h-6 w-6" /> Nivel de Sobreventa
          </h2>
          <div className="flex-1 w-full min-h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <XAxis type="number" domain={[0, 100]} stroke="#4b5563" tick={{fill: '#9ca3af'}} />
                <YAxis dataKey="name" type="category" stroke="#4b5563" tick={{fill: '#d1d5db', fontWeight: 'bold'}} />
                <Tooltip 
                  cursor={{fill: 'rgba(255,255,255,0.05)'}}
                  contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', backdropFilter: 'blur(8px)' }}
                  itemStyle={{ color: '#34d399', fontWeight: 'bold' }}
                />
                <Bar dataKey="RSI" radius={[0, 6, 6, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.RSI < 30 ? '#10b981' : '#3b82f6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </motion.div>
      
    </motion.div>
  );
}
