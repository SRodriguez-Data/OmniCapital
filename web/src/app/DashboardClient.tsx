'use client';

import React, { useState } from 'react';
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

const MarkowitzTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const pesos = data.pesos || {};
    return (
      <div className="bg-[#18181b] border border-[#3f3f46] p-3 text-sm font-mono text-[#e4e4e7] shadow-xl">
        <p className="font-bold text-[#60a5fa] mb-2 border-b border-[#3f3f46] pb-1">
          Simulated Portfolio
        </p>
        <p className="mb-1"><span className="text-[#a1a1aa]">Return:</span> {data.retorno}%</p>
        <p className="mb-1"><span className="text-[#a1a1aa]">Risk:</span> {data.riesgo}%</p>
        <p className="mb-2"><span className="text-[#a1a1aa]">Sharpe:</span> {data.sharpe}</p>
        <p className="font-bold text-[#a1a1aa] border-b border-[#27272a] mb-1">Weights:</p>
        <div className="grid grid-cols-2 gap-x-4">
          {Object.entries(pesos).map(([ticker, weight]) => (
            <p key={ticker} className="flex justify-between">
              <span>{ticker}</span>
              <span className="text-[#34d399] ml-2">{weight as number}%</span>
            </p>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

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
        <thead className="bg-[#18181b] text-[#a1a1aa] text-[11px] uppercase border-y border-[#3f3f46]">
          <tr>
            <th className="py-2 px-3 font-semibold">TICKER</th>
            <th className="py-2 px-3 font-semibold text-right">LAST PX</th>
            <th className="py-2 px-3 font-semibold text-right">MIN BUY (LBB)</th>
            <th className="py-2 px-3 font-semibold text-right">LIMIT PX (EMA200)</th>
            <th className="py-2 px-3 font-semibold text-right">MAX SELL (UBB)</th>
            <th className="py-2 px-3 font-semibold text-center">SIGNAL</th>
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
                  <td className="py-2 px-3 text-right text-[#d4d4d8] font-bold">
                    ${(row.price || 0).toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right text-[#34d399]">
                    {row.bollinger_lower ? `$${row.bollinger_lower.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-3 text-right text-[#60a5fa]">
                    {row.ema200_abs ? `$${row.ema200_abs.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-3 text-right text-[#f87171]">
                    {row.bollinger_upper ? `$${row.bollinger_upper.toFixed(2)}` : '-'}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {row.signal === 'BUY' && <span className="bg-[#065f46] text-[#34d399] px-2 py-0.5 rounded text-xs font-bold border border-[#047857]">BUY</span>}
                    {row.signal === 'SELL' && <span className="bg-[#7f1d1d] text-[#f87171] px-2 py-0.5 rounded text-xs font-bold border border-[#b91c1c]">SELL</span>}
                    {row.signal === 'HOLD' && <span className="bg-[#3f3f46] text-[#a1a1aa] px-2 py-0.5 rounded text-xs font-bold border border-[#52525b]">HOLD</span>}
                    {!row.signal && <span className="text-[#52525b]">-</span>}
                  </td>
                </tr>
                {isSelected && (
                  <tr>
                    <td colSpan={6} className="p-0 border-b border-[#3f3f46]">
                      <div className="bg-[#18181b] p-4 text-[#d4d4d8] text-sm border-l-2 border-[#60a5fa] grid grid-cols-2 gap-4">
                        <div>
                          <p className="font-sans mb-1 font-semibold text-[#93c5fd]">Analyst Coverage ({row.ticker}):</p>
                          <p className="font-sans leading-relaxed text-[#a1a1aa]">
                            {aiReport?.insights_tickers?.[row.ticker] || "No fundamental/tactical coverage available for this asset today."}
                          </p>
                        </div>
                        <div className="font-mono text-xs text-[#a1a1aa] bg-[#09090b] p-3 border border-[#27272a] rounded">
                          <p className="mb-2 text-[#e4e4e7] border-b border-[#27272a] pb-1 uppercase">Technical Overrides</p>
                          <p className="flex justify-between"><span>RSI (14D)</span> <span className={row.rsi < 30 ? 'text-[#34d399]' : row.rsi > 70 ? 'text-[#f87171]' : ''}>{row.rsi?.toFixed(1)}</span></p>
                          <p className="flex justify-between"><span>Dist. EMA200</span> <span className={(row.distancia_ema200 || 0) < 0 ? 'text-[#f87171]' : 'text-[#34d399]'}>{((row.distancia_ema200 || 0) * 100).toFixed(2)}%</span></p>
                          <p className="flex justify-between mt-2 pt-1 border-t border-[#27272a]"><span>Quant Score</span> <span className="text-[#60a5fa] font-bold">{row.score?.toFixed(1)}</span></p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {data.length === 0 && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-[#71717a] font-sans">
                NO TACTICAL DATA AVAILABLE IN THIS REGION
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6 font-sans bg-[#000000] text-[#fafafa] min-h-[800px] p-2">
      
      {/* TABS (BLOOMBERG STYLE) */}
      <div className="flex border-b-2 border-[#27272a] bg-[#09090b]">
        <button 
          onClick={() => setActiveTab('US')}
          className={`flex-1 md:flex-none px-6 py-2 font-mono font-bold text-xs uppercase tracking-wider transition-colors ${activeTab === 'US' ? 'bg-[#18181b] border-t-2 border-[#60a5fa] text-[#e4e4e7]' : 'text-[#71717a] hover:bg-[#18181b] hover:text-[#a1a1aa]'}`}
        >
          [01] US Markets
        </button>
        <button 
          onClick={() => setActiveTab('CL')}
          className={`flex-1 md:flex-none px-6 py-2 font-mono font-bold text-xs uppercase tracking-wider transition-colors border-l border-[#27272a] ${activeTab === 'CL' ? 'bg-[#18181b] border-t-2 border-[#60a5fa] text-[#e4e4e7]' : 'text-[#71717a] hover:bg-[#18181b] hover:text-[#a1a1aa]'}`}
        >
          [02] Chile Markets
        </button>
        <button 
          onClick={() => setActiveTab('PORTFOLIO')}
          className={`flex-1 md:flex-none px-6 py-2 font-mono font-bold text-xs uppercase tracking-wider transition-colors border-l border-[#27272a] ${activeTab === 'PORTFOLIO' ? 'bg-[#18181b] border-t-2 border-[#60a5fa] text-[#e4e4e7]' : 'text-[#71717a] hover:bg-[#18181b] hover:text-[#a1a1aa]'}`}
        >
          [03] My Portfolio
        </button>
      </div>

      {/* TAB CONTENT: US OR CHILE RADAR */}
      {(activeTab === 'US' || activeTab === 'CL') && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            
            {/* Table Area */}
            <div className="col-span-1 lg:col-span-3 border border-[#27272a] bg-[#09090b] shadow-sm rounded-sm overflow-hidden">
              <div className="bg-[#18181b] p-2 border-b border-[#27272a]">
                <h2 className="font-mono font-bold text-xs text-[#a1a1aa] uppercase tracking-widest">
                  {activeTab === 'US' ? 'EQUITY REGION: GLOBAL / US' : 'EQUITY REGION: SANTIAGO (CHILE)'} - TACTICAL OPPORTUNITIES
                </h2>
              </div>
              {renderTable(activeTab === 'US' ? candidatesUS : candidatesCL)}
            </div>

            {/* AI Summary Panel */}
            {aiReport && (
              <div className="col-span-1 space-y-3 font-sans">
                <div className="border border-[#27272a] bg-[#09090b] rounded-sm">
                  <div className="bg-[#18181b] p-2 border-b border-[#27272a]">
                    <h3 className="text-[10px] font-mono font-bold text-[#71717a] uppercase tracking-widest">Macro Context</h3>
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-[#d4d4d8] leading-relaxed">
                      {aiReport.contexto_macro || "Macro data unavailable."}
                    </p>
                  </div>
                </div>
                
                <div className="border border-[#27272a] bg-[#09090b] rounded-sm">
                  <div className="bg-[#18181b] p-2 border-b border-[#27272a]">
                    <h3 className="text-[10px] font-mono font-bold text-[#71717a] uppercase tracking-widest">Market Risk & Setup</h3>
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-[#d4d4d8] leading-relaxed">
                      {aiReport.setup_tecnico || "Risk assessment unavailable."}
                    </p>
                  </div>
                </div>
                
                <div className="border border-[#27272a] bg-[#09090b] rounded-sm border-l-2 border-l-[#34d399]">
                  <div className="bg-[#18181b] p-2 border-b border-[#27272a]">
                    <h3 className="text-[10px] font-mono font-bold text-[#34d399] uppercase tracking-widest">Top Fund Selection</h3>
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-[#d4d4d8] leading-relaxed">
                      {aiReport.seleccion_fondo || "No conviction generated."}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: PORTFOLIO (MARKOWITZ & MATRIX) */}
      {activeTab === 'PORTFOLIO' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            
            {/* Correlation Matrix */}
            <div className="border border-[#27272a] bg-[#09090b] shadow-sm rounded-sm overflow-hidden">
              <div className="bg-[#18181b] p-2 border-b border-[#27272a]">
                <h2 className="font-mono font-bold text-xs text-[#a1a1aa] uppercase tracking-widest">Correlation Matrix (100D)</h2>
              </div>
              <div className="p-4 overflow-x-auto">
                {correlationMatrix && Object.keys(correlationMatrix).length > 0 ? (
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
                  <div className="flex flex-col items-center justify-center py-12 text-[#71717a] font-mono">
                    <p>Correlation matrix empty or generating...</p>
                    <p className="text-[10px] mt-2">Check Backend Python script.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Efficient Frontier */}
            <div className="border border-[#27272a] bg-[#09090b] shadow-sm rounded-sm overflow-hidden flex flex-col">
              <div className="bg-[#18181b] p-2 border-b border-[#27272a]">
                <h2 className="font-mono font-bold text-xs text-[#a1a1aa] uppercase tracking-widest">Markowitz Efficient Frontier</h2>
              </div>
              <div className="flex-1 w-full min-h-[400px] p-4 relative">
                {efficientFrontier && efficientFrontier.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
                      <XAxis type="number" dataKey="riesgo" name="Risk (Vol)" unit="%" stroke="#52525b" domain={['auto', 'auto']} tick={{fontSize: 12, fill: '#a1a1aa', fontFamily: 'monospace'}} />
                      <YAxis type="number" dataKey="retorno" name="Expected Return" unit="%" stroke="#52525b" domain={['auto', 'auto']} tick={{fontSize: 12, fill: '#a1a1aa', fontFamily: 'monospace'}} />
                      <ZAxis type="number" range={[20, 20]} />
                      <RechartsTooltip 
                        cursor={{strokeDasharray: '3 3', stroke: '#52525b'}}
                        content={<MarkowitzTooltip />}
                      />
                      <Scatter data={efficientFrontier}>
                        {efficientFrontier.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.sharpe > 1.5 ? '#34d399' : (entry.sharpe > 1.0 ? '#60a5fa' : '#52525b')} 
                            opacity={0.9} 
                          />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-[#71717a] font-mono">
                    <p>Markowitz simulation data unavailable.</p>
                    <p className="text-[10px] mt-2">Verify DB 'frontera_eficiente' table.</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
