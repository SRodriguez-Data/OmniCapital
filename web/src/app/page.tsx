'use client';

import React, { useState, useEffect } from 'react';
import PortfolioTab from './components/PortfolioTab';
import SizingTab from './components/SizingTab';
import DividendsTab from './components/DividendsTab';
import BacktestTab from './components/BacktestTab';
import MacroPanel from './components/MacroPanel';
import NotificationBell from './components/NotificationBell';
import DataWarehouseTab from './components/DataWarehouseTab';
import { ThemeToggle } from './components/ThemeToggle';
import { PortfolioProvider } from './context/PortfolioContext';
import { Briefcase, Calculator, DollarSign, History, LogOut, Database, Landmark, Globe } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useLanguage } from './context/LanguageContext';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'PORTFOLIO' | 'CALCULADORA' | 'DIVIDENDOS' | 'BACKTEST' | 'DATA_WAREHOUSE'>('DATA_WAREHOUSE');
  const [session, setSession] = useState<any>(null);
  const router = useRouter();
  const { t, language, toggleLanguage } = useLanguage();

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
    return <div className="min-h-screen bg-[#09090b] flex items-center justify-center font-mono text-zinc-500">{t('app.loading')}</div>;
  }

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-[#09090b] text-zinc-900 dark:text-[#fafafa] font-sans transition-colors duration-300">
      <header className="border-b border-zinc-200 dark:border-[#27272a] bg-white dark:bg-[#18181b] px-6 py-4 flex flex-col md:flex-row items-center justify-between shadow-sm dark:shadow-none transition-colors duration-300">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-gradient-to-tr from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center shadow-inner shadow-emerald-500/20">
            <Landmark className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-600 to-teal-500 dark:from-emerald-400 dark:to-teal-300 bg-clip-text text-transparent">
              {t('app.title')}
            </h1>
            <p className="text-zinc-500 dark:text-[#a1a1aa] text-[10px] font-mono uppercase tracking-[0.15em] mt-0.5">
              {t('app.subtitle')}
            </p>
          </div>
        </div>
        <div className="mt-4 md:mt-0 flex items-center gap-4">
          <button 
            onClick={toggleLanguage}
            className="flex items-center gap-2 px-2 py-1.5 text-xs font-mono font-bold text-zinc-500 hover:text-emerald-500 transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-[#27272a] rounded"
          >
            <Globe className="w-4 h-4" /> {language.toUpperCase()}
          </button>
          <ThemeToggle />
          <NotificationBell />
          <button 
            onClick={handleSignOut}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-bold text-zinc-500 hover:text-red-500 transition-colors border border-zinc-200 dark:border-[#27272a] hover:border-red-500 rounded"
          >
            <LogOut className="w-4 h-4" /> {t('header.logout')}
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
          <Database className="w-4 h-4" /> {t('tab.data_warehouse')}
        </button>
        <button 
          onClick={() => setActiveTab('PORTFOLIO')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors ${activeTab === 'PORTFOLIO' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <Briefcase className="w-4 h-4" /> {t('tab.portfolio')}
        </button>
        <button 
          onClick={() => setActiveTab('CALCULADORA')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors border-l border-zinc-200 dark:border-[#27272a] ${activeTab === 'CALCULADORA' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-amber-500 text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <Calculator className="w-4 h-4" /> {t('tab.calculator')}
        </button>
        <button 
          onClick={() => setActiveTab('DIVIDENDOS')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors border-l border-zinc-200 dark:border-[#27272a] ${activeTab === 'DIVIDENDOS' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <DollarSign className="w-4 h-4" /> {t('tab.dividends')}
        </button>
        <button 
          onClick={() => setActiveTab('BACKTEST')}
          className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors border-l border-zinc-200 dark:border-[#27272a] ${activeTab === 'BACKTEST' ? 'bg-zinc-50 dark:bg-[#18181b] border-b-2 border-rose-500 text-rose-600 dark:text-rose-400' : 'text-zinc-500 dark:text-[#71717a] hover:bg-zinc-50 dark:hover:bg-[#18181b] hover:text-zinc-900 dark:hover:text-[#a1a1aa] border-b-2 border-transparent'}`}
        >
          <History className="w-4 h-4" /> {t('tab.backtest')}
        </button>
      </div>

      <div className="p-4 md:p-6 max-w-[1600px] mx-auto">
        {activeTab === 'DATA_WAREHOUSE' && <DataWarehouseTab onPortfolioUpdate={() => setActiveTab('PORTFOLIO')} />}
        {activeTab === 'PORTFOLIO' && <PortfolioTab />}
        {activeTab === 'CALCULADORA' && <SizingTab />}
        {activeTab === 'DIVIDENDOS' && <DividendsTab />}
        {activeTab === 'BACKTEST' && <BacktestTab />}
      </div>
    </main>
  );
}
