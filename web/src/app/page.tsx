'use client';

import React, { useState } from 'react';
import { Briefcase, Activity, Search, Calculator } from 'lucide-react';
import PortfolioTab from './components/PortfolioTab';
import RecommendationsTab from './components/RecommendationsTab';
import ScreenerTab from './components/ScreenerTab';
import SizingTab from './components/SizingTab';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'PORTFOLIO' | 'RECOMENDACIONES' | 'BUSCADOR' | 'CALCULADORA'>('PORTFOLIO');

  return (
    <main className="min-h-screen bg-[#09090b] text-[#fafafa] font-sans">
      <header className="border-b border-[#27272a] bg-[#18181b] px-6 py-4 flex flex-col md:flex-row items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#e4e4e7] font-mono">
            QUANTUM TRADER V2
          </h1>
          <p className="text-[#a1a1aa] text-xs font-mono uppercase tracking-widest mt-1">
            Terminal Institucional Interactiva
          </p>
        </div>
      </header>
      
      {/* TABS MENU */}
      <div className="flex flex-wrap border-b-2 border-[#27272a] bg-[#09090b]">
        <button 
          onClick={() => setActiveTab('PORTFOLIO')}
          className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 font-mono font-bold text-xs uppercase tracking-wider transition-colors ${activeTab === 'PORTFOLIO' ? 'bg-[#18181b] border-t-2 border-[#60a5fa] text-[#e4e4e7]' : 'text-[#71717a] hover:bg-[#18181b] hover:text-[#a1a1aa]'}`}
        >
          <Briefcase className="w-4 h-4" /> [01] Mi Portafolio
        </button>
        <button 
          onClick={() => setActiveTab('RECOMENDACIONES')}
          className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 font-mono font-bold text-xs uppercase tracking-wider transition-colors border-l border-[#27272a] ${activeTab === 'RECOMENDACIONES' ? 'bg-[#18181b] border-t-2 border-[#60a5fa] text-[#e4e4e7]' : 'text-[#71717a] hover:bg-[#18181b] hover:text-[#a1a1aa]'}`}
        >
          <Activity className="w-4 h-4" /> [02] Recomendaciones
        </button>
        <button 
          onClick={() => setActiveTab('BUSCADOR')}
          className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 font-mono font-bold text-xs uppercase tracking-wider transition-colors border-l border-[#27272a] ${activeTab === 'BUSCADOR' ? 'bg-[#18181b] border-t-2 border-[#60a5fa] text-[#e4e4e7]' : 'text-[#71717a] hover:bg-[#18181b] hover:text-[#a1a1aa]'}`}
        >
          <Search className="w-4 h-4" /> [03] Buscador Límite
        </button>
        <button 
          onClick={() => setActiveTab('CALCULADORA')}
          className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 font-mono font-bold text-xs uppercase tracking-wider transition-colors border-l border-[#27272a] ${activeTab === 'CALCULADORA' ? 'bg-[#18181b] border-t-2 border-[#60a5fa] text-[#e4e4e7]' : 'text-[#71717a] hover:bg-[#18181b] hover:text-[#a1a1aa]'}`}
        >
          <Calculator className="w-4 h-4" /> [04] Calculadora Riesgo
        </button>
      </div>

      <div className="p-4 md:p-6">
        {activeTab === 'PORTFOLIO' && <PortfolioTab />}
        {activeTab === 'RECOMENDACIONES' && <RecommendationsTab />}
        {activeTab === 'BUSCADOR' && <ScreenerTab />}
        {activeTab === 'CALCULADORA' && <SizingTab />}
      </div>
    </main>
  );
}
