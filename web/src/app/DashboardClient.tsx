'use client';

import React, { useState } from 'react';
import { Activity, ShieldAlert, BarChart3, Target, Globe, MapPin, Briefcase } from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis
} from 'recharts';

interface Candidate {
  ticker: string;
  price: number;
  rsi: number;
  distancia_ema200: number;
  score: number;
  bollinger_upper?: number;
  bollinger_lower?: number;
  ema200_abs?: number;
  signal?: 'BUY' | 'SELL' | 'HOLD';
}

interface AiReport {
  fecha: string;
  candidatos_json: any; // Can be array (old) or {us: Candidate[], cl: Candidate[]} (new)
  vision_radar: string;
  seleccion_fondo: string;
  setup_tecnico: string;
  contexto_macro?: string;
  insights_tickers?: Record<string, string>;
}

export default function DashboardClient({ 
  initialData, 
  aiReport,
  correlationMatrix,
  efficientFrontier
}: { 
  initialData: any[], 
  aiReport: AiReport | null,
  correlationMatrix: Record<string, Record<string, number>> | null,
  efficientFrontier: any[] | null
}) {
  const [activeTab, setActiveTab] = useState<'US' | 'CL' | 'PORTFOLIO'>('PORTFOLIO');
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  // Parse candidates from AI report
  const rawCandidates = aiReport?.candidatos_json;
  let candidatesUS: Candidate[] = [];
  let candidatesCL: Candidate[] = [];
  
  if (Array.isArray(rawCandidates)) {
    candidatesUS = rawCandidates.filter(c => !c.ticker.endsWith('.SN'));
    candidatesCL = rawCandidates.filter(c => c.ticker.endsWith('.SN'));
  } else if (rawCandidates && typeof rawCandidates === 'object') {
    candidatesUS = rawCandidates.us || [];
    candidatesCL = rawCandidates.cl || [];
  }

  const renderTable = (data: Candidate[]) => (
    <div className="overflow-x-auto w-full">
      <table className="w-full text-left text-sm font-mono border-collapse">
        <thead className="bg-[#18181b] text-[#a1a1aa] text-xs uppercase border-b border-[#3f3f46]">
          <tr>
            <th className="py-2 px-3 font-semibold">Ticker</th>
            <th className="py-2 px-3 font-semibold text-right">Price</th>
            <th className="py-2 px-3 font-semibold text-right">RSI</th>
            <th className="py-2 px-3 font-semibold text-right">EMA200 Dist</th>
            <th className="py-2 px-3 font-semibold text-right">Min Buy (LBB)</th>
            <th className="py-2 px-3 font-semibold text-right">Target (UBB)</th>
            <th className="py-2 px-3 font-semibold text-center">Signal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#27272a]">
          {data.map((row) => {
            const isSelected = selectedTicker === row.ticker;
            return (
              <React.Fragment key={row.ticker}>
                <tr 
                  onClick={() => setSelectedTicker(isSelected ? null : row.ticker)}
                  className={`cursor-pointer transition-colors hover:bg-[#27272a] ${isSelected ? 'bg-[#27272a]' : ''}`}
                >
                  <td className="py-2 px-3 font-bold text-[#e4e4e7]">{row.ticker}</td>
                  <td className="py-2 px-3 text-right text-[#d4d4d8]">${(row.price || 0).toFixed(2)}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={row.rsi < 30 ? 'text-[#34d399] font-bold' : row.rsi > 70 ? 'text-[#f87171] font-bold' : 'text-[#a1a1aa]'}>
                      {row.rsi?.toFixed(1) || 'N/A'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span className={(row.distancia_ema200 || 0) < 0 ? 'text-[#f87171]' : 'text-[#34d399]'}>
                      {((row.distancia_ema200 || 0) * 100).toFixed(2)}%
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right text-[#93c5fd]">
                    {row.bollinger_lower ? `$${row.bollinger_lower.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-3 text-right text-[#fde047]">
                    {row.bollinger_upper ? `$${row.bollinger_upper.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {row.signal === 'BUY' && <span className="bg-[#065f46] text-[#34d399] px-2 py-0.5 rounded text-xs font-bold">BUY</span>}
                    {row.signal === 'SELL' && <span className="bg-[#7f1d1d] text-[#f87171] px-2 py-0.5 rounded text-xs font-bold">SELL</span>}
                    {row.signal === 'HOLD' && <span className="bg-[#3f3f46] text-[#a1a1aa] px-2 py-0.5 rounded text-xs font-bold">HOLD</span>}
                    {!row.signal && <span className="text-[#52525b]">-</span>}
                  </td>
                </tr>
                {isSelected && (
                  <tr>
                    <td colSpan={7} className="p-0 border-b border-[#3f3f46]">
                      <div className="bg-[#18181b] p-4 text-[#d4d4d8] text-sm border-l-2 border-[#60a5fa]">
                        <p className="font-sans mb-1 font-semibold text-[#93c5fd]">Institutional Analyst Note ({row.ticker}):</p>
                        <p className="font-sans leading-relaxed text-[#a1a1aa]">
                          {aiReport?.insights_tickers?.[row.ticker] || "No coverage available for this asset."}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {data.length === 0 && (
            <tr>
              <td colSpan={7} className="py-8 text-center text-[#71717a] font-sans">
                No tactical anomalies detected in this market segment today.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6 font-sans bg-[#09090b] text-[#fafafa]">
      
      {/* TABS */}
      <div className="flex border-b border-[#27272a] mb-6">
        <button 
          onClick={() => setActiveTab('PORTFOLIO')}
          className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors ${activeTab === 'PORTFOLIO' ? 'border-b-2 border-[#60a5fa] text-[#60a5fa]' : 'text-[#a1a1aa] hover:text-[#e4e4e7]'}`}
        >
          <Briefcase className="w-4 h-4" /> My Portfolio
        </button>
        <button 
          onClick={() => setActiveTab('US')}
          className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors ${activeTab === 'US' ? 'border-b-2 border-[#60a5fa] text-[#60a5fa]' : 'text-[#a1a1aa] hover:text-[#e4e4e7]'}`}
        >
          <Globe className="w-4 h-4" /> US Markets
        </button>
        <button 
          onClick={() => setActiveTab('CL')}
          className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors ${activeTab === 'CL' ? 'border-b-2 border-[#60a5fa] text-[#60a5fa]' : 'text-[#a1a1aa] hover:text-[#e4e4e7]'}`}
        >
          <MapPin className="w-4 h-4" /> Chile Markets
        </button>
      </div>

      {/* TAB CONTENT: US OR CHILE RADAR */}
      {(activeTab === 'US' || activeTab === 'CL') && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            {/* Table Area */}
            <div className="col-span-1 lg:col-span-3 border border-[#27272a] bg-[#09090b] shadow-sm rounded-sm overflow-hidden">
              <div className="bg-[#18181b] p-3 border-b border-[#27272a] flex items-center justify-between">
                <h2 className="font-semibold text-sm text-[#e4e4e7] flex items-center gap-2">
                  <Target className="w-4 h-4 text-[#60a5fa]" /> 
                  Tactical Anomalies ({activeTab === 'US' ? 'Global/US' : 'Bolsa de Santiago'})
                </h2>
              </div>
              {renderTable(activeTab === 'US' ? candidatesUS : candidatesCL)}
            </div>

            {/* AI Summary Panel */}
            {aiReport && (
              <div className="col-span-1 space-y-4">
                <div className="border border-[#27272a] bg-[#18181b] p-4 rounded-sm">
                  <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider mb-2">Macro Context</h3>
                  <p className="text-sm text-[#d4d4d8] leading-relaxed">
                    {aiReport.contexto_macro || "Macro data unavailable."}
                  </p>
                </div>
                <div className="border border-[#27272a] bg-[#18181b] p-4 rounded-sm">
                  <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider mb-2">Market Risk & Setup</h3>
                  <p className="text-sm text-[#d4d4d8] leading-relaxed">
                    {aiReport.setup_tecnico || "Risk assessment unavailable."}
                  </p>
                </div>
                <div className="border border-[#27272a] bg-[#18181b] p-4 rounded-sm border-l-4 border-l-[#60a5fa]">
                  <h3 className="text-xs font-bold text-[#60a5fa] uppercase tracking-wider mb-2">Top Conviction</h3>
                  <p className="text-sm text-[#d4d4d8] leading-relaxed">
                    {aiReport.seleccion_fondo || "No conviction generated."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: PORTFOLIO (MARKOWITZ & MATRIX) */}
      {activeTab === 'PORTFOLIO' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            
            {/* Correlation Matrix */}
            <div className="border border-[#27272a] bg-[#09090b] shadow-sm rounded-sm overflow-hidden">
              <div className="bg-[#18181b] p-3 border-b border-[#27272a]">
                <h2 className="font-semibold text-sm text-[#e4e4e7]">Portfolio Correlation Matrix (100D)</h2>
              </div>
              <div className="p-4 overflow-x-auto">
                {correlationMatrix ? (
                  <table className="w-full text-center text-xs font-mono border-collapse">
                    <thead>
                      <tr>
                        <th className="p-2 border border-[#27272a] bg-[#18181b]"></th>
                        {Object.keys(correlationMatrix).map(col => (
                          <th key={col} className="p-2 border border-[#27272a] bg-[#18181b] text-[#a1a1aa] font-semibold">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(correlationMatrix).map(row => (
                        <tr key={row}>
                          <td className="p-2 border border-[#27272a] bg-[#18181b] text-[#a1a1aa] font-semibold">{row}</td>
                          {Object.keys(correlationMatrix[row]).map(col => {
                            const val = correlationMatrix[row][col];
                            let bgColor = 'bg-[#09090b] text-[#a1a1aa]';
                            if (val > 0.7 && val < 0.99) bgColor = 'bg-[#064e3b] text-[#34d399]';
                            else if (val >= 0.99) bgColor = 'bg-[#18181b] text-[#52525b]'; // Self
                            else if (val < -0.3) bgColor = 'bg-[#7f1d1d] text-[#f87171]';
                            
                            return (
                              <td key={`${row}-${col}`} className={`p-2 border border-[#27272a] ${bgColor}`}>
                                {val.toFixed(2)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[#71717a] text-sm text-center py-8">Correlation matrix is generating...</p>
                )}
              </div>
            </div>

            {/* Efficient Frontier */}
            <div className="border border-[#27272a] bg-[#09090b] shadow-sm rounded-sm overflow-hidden flex flex-col">
              <div className="bg-[#18181b] p-3 border-b border-[#27272a]">
                <h2 className="font-semibold text-sm text-[#e4e4e7]">Efficient Frontier (Monte Carlo)</h2>
              </div>
              <div className="flex-1 w-full min-h-[400px] p-4">
                {efficientFrontier ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                      <XAxis type="number" dataKey="riesgo" name="Risk (Vol)" unit="%" stroke="#52525b" domain={['auto', 'auto']} tick={{fontSize: 12, fill: '#a1a1aa', fontFamily: 'monospace'}} />
                      <YAxis type="number" dataKey="retorno" name="Expected Return" unit="%" stroke="#52525b" domain={['auto', 'auto']} tick={{fontSize: 12, fill: '#a1a1aa', fontFamily: 'monospace'}} />
                      <ZAxis type="number" range={[20, 20]} />
                      <RechartsTooltip 
                        cursor={{strokeDasharray: '3 3', stroke: '#52525b'}}
                        contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#e4e4e7', fontFamily: 'monospace', fontSize: '12px' }}
                        formatter={(value: any, name: string) => [`${value}%`, name]}
                      />
                      <Scatter data={efficientFrontier}>
                        {efficientFrontier.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.sharpe > 1.5 ? '#34d399' : (entry.sharpe > 1 ? '#60a5fa' : '#52525b')} 
                            opacity={0.8} 
                          />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-[#71717a] text-sm text-center py-8">Markowitz simulation running...</p>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
