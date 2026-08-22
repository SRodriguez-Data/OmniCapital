'use client';

import React, { useState, useEffect } from 'react';
import PortfolioTab from './components/PortfolioTab';
import RecommendationsTab from './components/RecommendationsTab';
import ScreenerTab from './components/ScreenerTab';
import SizingTab from './components/SizingTab';
import TopOportunidadesTab from './components/TopOportunidadesTab';
import DividendsTab from './components/DividendsTab';
import MacroPanel from './components/MacroPanel';
import NotificationBell from './components/NotificationBell';
import BacktestTab from './components/BacktestTab';
import DataWarehouseTab from './components/DataWarehouseTab';
import { ThemeToggle } from './components/ThemeToggle';
import { PortfolioProvider } from './context/PortfolioContext';
import { Briefcase, Activity, Search, Calculator, Target, DollarSign, History, LogOut, Database } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'PORTFOLIO' | 'RECOMENDACIONES' | 'BUSCADOR' | 'CALCULADORA' | 'TOP5' | 'DIVIDENDOS' | 'BACKTEST' | 'DATA_WAREHOUSE'>('DATA_WAREHOUSE');
  const [session, setSession] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    // Si estamos en modo demo o modo cartola, no exigir sesión real
    if (typeof window !== 'undefined') {
      const demoMode = localStorage.getItem('isDemo') === 'true';
      const cartolaMode = localStorage.getItem('isCartolaMode') === 'true';
      if (demoMode || cartolaMode) {
        setSession({ user: { id: demoMode ? 'demo' : 'cartola', email: 'user@jurado.com' } });
        return; 
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push('/login');
      } else {
        setSession(session);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (typeof window !== 'undefined' && (localStorage.getItem('isDemo') === 'true' || localStorage.getItem('isCartolaMode') === 'true')) return;
      
      if (!session) {
        router.push('/login');
      } else {
        setSession(session);
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      if (localStorage.getItem('isDemo') === 'true' || localStorage.getItem('isCartolaMode') === 'true') {
        localStorage.removeItem('isDemo');
        localStorage.removeItem('isCartolaMode');
        router.push('/login');
        return;
      }
    }
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (!session) {
    return <div className="min-h-screen bg-[#09090b] flex items-center justify-center font-mono text-zinc-500">Cargando Terminal...</div>;
  }

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-[#09090b] text-zinc-900 dark:text-[#fafafa] font-sans transition-colors duration-300">
      <header className="border-b border-zinc-200 dark:border-[#27272a] bg-white dark:bg-[#18181b] px-6 py-4 flex flex-col md:flex-row items-center justify-between shadow-sm dark:shadow-none transition-colors duration-300">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7] font-sans">
            QUANTUM TRADER V2.9
          </h1>
          <p className="text-zinc-500 dark:text-[#a1a1aa] text-xs font-mono uppercase tracking-widest mt-1">
            Terminal Institucional Interactiva
          </p>
        </div>
        <div className="mt-4 md:mt-0 flex items-center gap-4">
          <ThemeToggle />
          <NotificationBell />
          <button 
            onClick={handleSignOut}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-bold text-zinc-500 hover:text-red-500 transition-colors border border-zinc-200 dark:border-[#27272a] hover:border-red-500 rounded"
          >
            <LogOut className="w-4 h-4" /> SALIR
          </button>
        </div>
      </header>

      <MacroPanel />
      
      {/* TABS MENU */}
      <div className="flex overflow-x-auto whitespace-nowrap border-b border-zinc-200 dark:border-[#27272a] bg-white dark:bg-[#09090b] scrollbar-hide transition-colors duration-300 shadow-sm dark:shadow-none">
        <button 
          onClick={() => setActiveTab('DATA_WAREHOUSE')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors border-r border-zinc-200 dark:border-[#27272a] ${activeTab === 'DATA_WAREHOUSE' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-orange-500 text-orange-600 dark:text-orange-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <Database className="w-4 h-4" /> [00] DATA WAREHOUSE
        </button>
        <button 
          onClick={() => setActiveTab('PORTFOLIO')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors ${activeTab === 'PORTFOLIO' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <Briefcase className="w-4 h-4" /> [01] Mi Portafolio
        </button>
        <button 
          onClick={() => setActiveTab('RECOMENDACIONES')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors border-l border-zinc-200 dark:border-[#27272a] ${activeTab === 'RECOMENDACIONES' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <Activity className="w-4 h-4" /> [02] Mi Diagnóstico IA
        </button>
        <button 
          onClick={() => setActiveTab('TOP5')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors border-l border-zinc-200 dark:border-[#27272a] ${activeTab === 'TOP5' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-fuchsia-500 text-fuchsia-600 dark:text-fuchsia-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <Target className="w-4 h-4" /> [03] Top 5 Oportunidades
        </button>
        <button 
          onClick={() => setActiveTab('DIVIDENDOS')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors border-l border-zinc-200 dark:border-[#27272a] ${activeTab === 'DIVIDENDOS' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <DollarSign className="w-4 h-4" /> [04] Ingresos Pasivos
        </button>
        <button 
          onClick={() => setActiveTab('BUSCADOR')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors border-l border-zinc-200 dark:border-[#27272a] ${activeTab === 'BUSCADOR' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-cyan-500 text-cyan-600 dark:text-cyan-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <Search className="w-4 h-4" /> [05] Buscador Límite
        </button>
        <button 
          onClick={() => setActiveTab('CALCULADORA')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors border-l border-zinc-200 dark:border-[#27272a] ${activeTab === 'CALCULADORA' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-amber-500 text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <Calculator className="w-4 h-4" /> [06] Optimizador IA
        </button>
        <button 
          onClick={() => setActiveTab('BACKTEST')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors border-l border-zinc-200 dark:border-[#27272a] ${activeTab === 'BACKTEST' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-rose-500 text-rose-600 dark:text-rose-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <History className="w-4 h-4" /> [07] Backtesting
        </button>
      </div>

      <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
        {activeTab === 'DATA_WAREHOUSE' && <DataWarehouseTab onPortfolioUpdate={() => setActiveTab('PORTFOLIO')} />}
        {activeTab === 'PORTFOLIO' && <PortfolioTab />}
        {activeTab === 'RECOMENDACIONES' && <RecommendationsTab />}
        {activeTab === 'TOP5' && <TopOportunidadesTab />}
        {activeTab === 'DIVIDENDOS' && <DividendsTab />}
        {activeTab === 'BUSCADOR' && <ScreenerTab />}
        {activeTab === 'CALCULADORA' && <SizingTab />}
        {activeTab === 'BACKTEST' && <BacktestTab />}
      </div>
    </main>
  );
}
