'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
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
import SimulacionTab from './components/SimulacionTab';
import { ThemeToggle } from './components/ThemeToggle';
import { RESORTE, SUAVE } from './components/Movimiento';
import { Briefcase, Activity, Search, Calculator, Target, DollarSign, History, LogOut, Database, Landmark, FlaskConical, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { usePortfolio } from './context/PortfolioContext';

type Pestana = 'PORTFOLIO' | 'RECOMENDACIONES' | 'BUSCADOR' | 'CALCULADORA' | 'TOP5' | 'DIVIDENDOS' | 'BACKTEST' | 'SIMULACION' | 'DATA_WAREHOUSE';

// `corto` es el nombre en el celular, donde no caben los largos. Las clases van completas para que Tailwind las vea
const PESTANAS: { id: Pestana; codigo: string; nombre: string; corto: string; icono: LucideIcon; texto: string; linea: string }[] = [
  { id: 'DATA_WAREHOUSE', codigo: '00', nombre: 'DATA WAREHOUSE', corto: 'Datos', icono: Database, texto: 'text-orange-600 dark:text-orange-400', linea: 'bg-orange-500' },
  { id: 'PORTFOLIO', codigo: '01', nombre: 'Mi Portafolio', corto: 'Portafolio', icono: Briefcase, texto: 'text-blue-600 dark:text-blue-400', linea: 'bg-blue-500' },
  { id: 'RECOMENDACIONES', codigo: '02', nombre: 'Mi Diagnóstico IA', corto: 'Diagnóstico', icono: Activity, texto: 'text-indigo-600 dark:text-indigo-400', linea: 'bg-indigo-500' },
  { id: 'TOP5', codigo: '03', nombre: 'Top 5 Oportunidades', corto: 'Top 5', icono: Target, texto: 'text-fuchsia-600 dark:text-fuchsia-400', linea: 'bg-fuchsia-500' },
  { id: 'DIVIDENDOS', codigo: '04', nombre: 'Ingresos Pasivos', corto: 'Dividendos', icono: DollarSign, texto: 'text-emerald-600 dark:text-emerald-400', linea: 'bg-emerald-500' },
  { id: 'BUSCADOR', codigo: '05', nombre: 'Buscador Límite', corto: 'Buscador', icono: Search, texto: 'text-cyan-600 dark:text-cyan-400', linea: 'bg-cyan-500' },
  { id: 'CALCULADORA', codigo: '06', nombre: 'Optimizador', corto: 'Optimizador', icono: Calculator, texto: 'text-amber-600 dark:text-amber-400', linea: 'bg-amber-500' },
  { id: 'BACKTEST', codigo: '07', nombre: 'Backtesting', corto: 'Backtest', icono: History, texto: 'text-rose-600 dark:text-rose-400', linea: 'bg-rose-500' },
  { id: 'SIMULACION', codigo: '08', nombre: 'Simulación', corto: 'Simulación', icono: FlaskConical, texto: 'text-purple-600 dark:text-purple-400', linea: 'bg-purple-500' },
];
const posicion = (id: Pestana) => PESTANAS.findIndex(p => p.id === id);

// La pestaña nueva entra desde el lado hacia donde se avanzó en el menú y la anterior sale hacia el otro
const CAMBIO: Variants = {
  entra: (dir: number) => ({ opacity: 0, x: dir * 40 }),
  quieta: { opacity: 1, x: 0, transition: { duration: 0.32, ease: SUAVE } },
  sale: (dir: number) => ({ opacity: 0, x: dir * -40, transition: { duration: 0.16, ease: 'easeIn' } }),
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<Pestana>('DATA_WAREHOUSE');
  const [direccion, setDireccion] = useState(0);
  const [session, setSession] = useState<{ user: { id: string; email?: string } } | null>(null);
  const router = useRouter();
  const { isDemo } = usePortfolio();
  const ancla = useRef<HTMLDivElement>(null);
  const botones = useRef<Partial<Record<Pestana, HTMLButtonElement | null>>>({});

  useEffect(() => {
    // Si estamos en modo demo o modo cartola, no exigir sesión real
    if (typeof window !== 'undefined') {
      const demoMode = localStorage.getItem('isDemo') === 'true';
      const cartolaMode = localStorage.getItem('isCartolaMode') === 'true';
      if (demoMode || cartolaMode) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- modo sin login, leído de localStorage tras hidratar
        setSession({ user: { id: demoMode ? 'demo' : 'cartola' } });
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

  // En el celular el menú se desliza: la pestaña elegida queda centrada y a la vista
  useEffect(() => {
    botones.current[activeTab]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeTab]);

  const cambiarPestana = (id: Pestana) => {
    if (id === activeTab) return;
    setDireccion(posicion(id) > posicion(activeTab) ? 1 : -1);
    setActiveTab(id);
    // Si se estaba leyendo más abajo, la pestaña nueva se muestra desde su comienzo
    const tope = ancla.current?.offsetTop ?? 0;
    if (window.scrollY > tope) window.scrollTo({ top: tope, behavior: 'smooth' });
  };

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
    return (
      <div className="min-h-screen bg-zinc-100 dark:bg-[#09090b] flex flex-col items-center justify-center gap-5">
        <motion.div
          className="w-14 h-14 bg-gradient-to-tr from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center shadow-inner shadow-emerald-500/20"
          animate={{ scale: [1, 1.1, 1], rotate: [0, -6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Landmark className="w-7 h-7" />
        </motion.div>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500 animate-pulse">Cargando Terminal...</p>
      </div>
    );
  }

  const actual = PESTANAS[posicion(activeTab)];

  return (
    <main className="min-h-screen overflow-x-clip bg-zinc-100 dark:bg-[#09090b] text-zinc-900 dark:text-[#fafafa] font-sans transition-colors duration-300 pb-[env(safe-area-inset-bottom)]">
      <motion.header
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: SUAVE }}
        className="border-b border-zinc-200 dark:border-[#27272a] bg-white dark:bg-[#18181b] px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3 shadow-sm dark:shadow-none transition-colors duration-300"
      >
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <motion.div
            initial={{ scale: 0.4, rotate: -30, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ ...RESORTE, delay: 0.15 }}
            whileHover={{ rotate: -10, scale: 1.08 }}
            className="shrink-0 w-9 h-9 md:w-10 md:h-10 bg-gradient-to-tr from-emerald-100 to-teal-100 dark:from-emerald-900/40 dark:to-teal-900/40 text-emerald-600 dark:text-emerald-400 rounded-xl flex items-center justify-center shadow-inner shadow-emerald-500/20"
          >
            <Landmark className="w-5 h-5" />
          </motion.div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-600 to-teal-500 dark:from-emerald-400 dark:to-teal-300 bg-clip-text text-transparent">
              OmniCapital
            </h1>
            <p className="hidden sm:block text-zinc-500 dark:text-[#a1a1aa] text-[10px] font-mono uppercase tracking-[0.15em] mt-0.5">
              Wealth Management Platform V3.1
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <ThemeToggle />
          <NotificationBell />
          <button
            onClick={handleSignOut}
            aria-label="Salir"
            className="flex items-center gap-2 p-2 sm:px-3 sm:py-1.5 text-xs font-mono font-bold text-zinc-500 hover:text-red-500 transition-colors border border-zinc-200 dark:border-[#27272a] hover:border-red-500 rounded"
          >
            <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">SALIR</span>
          </button>
        </div>
      </motion.header>

      {isDemo && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 text-xs font-mono text-center py-2 px-4 border-b border-amber-300/60"
        >
          Modo demo: estás viendo un portafolio de ejemplo, no el tuyo. Para salir, usa el botón de salir.
        </motion.div>
      )}
      <MacroPanel />

      <div ref={ancla} />
      {/* MENÚ DE PESTAÑAS: queda pegado arriba al bajar; en el celular se desliza con el dedo */}
      <motion.nav
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: SUAVE, delay: 0.1 }}
        className="sticky top-0 z-30 border-b border-zinc-200 dark:border-[#27272a] bg-white/90 dark:bg-[#09090b]/90 backdrop-blur-md shadow-sm dark:shadow-none transition-colors duration-300"
      >
        <div className="relative">
          <div className="flex overflow-x-auto whitespace-nowrap scrollbar-hide">
            {PESTANAS.map(p => {
              const activa = p.id === activeTab;
              const Icono = p.icono;
              return (
                <button
                  key={p.id}
                  ref={el => { botones.current[p.id] = el; }}
                  onClick={() => cambiarPestana(p.id)}
                  aria-current={activa ? 'page' : undefined}
                  className={`relative flex-shrink-0 flex items-center justify-center gap-2 px-4 md:px-6 py-3 md:py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors ${activa ? p.texto : 'text-zinc-500 dark:text-[#71717a] hover:text-zinc-900 dark:hover:text-[#a1a1aa]'}`}
                >
                  {activa && (
                    <>
                      <motion.span layoutId="pestana-fondo" transition={RESORTE} className="absolute inset-0 bg-zinc-100 dark:bg-[#18181b]" />
                      <motion.span layoutId="pestana-linea" transition={RESORTE} className={`absolute inset-x-0 bottom-0 h-0.5 ${p.linea}`} />
                    </>
                  )}
                  <motion.span
                    className="relative"
                    animate={activa ? { scale: [1, 1.3, 1], rotate: [0, -12, 0] } : { scale: 1, rotate: 0 }}
                    transition={{ duration: 0.45, ease: SUAVE }}
                  >
                    <Icono className="w-4 h-4" />
                  </motion.span>
                  <span className="relative md:hidden">{p.corto}</span>
                  <span className="relative hidden md:inline">[{p.codigo}] {p.nombre}</span>
                </button>
              );
            })}
          </div>
          {/* Sombra en el borde derecho: avisa que hay más pestañas al deslizar */}
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white dark:from-[#09090b] md:hidden" />
        </div>
      </motion.nav>

      <AnimatePresence mode="wait" custom={direccion}>
        <motion.div
          key={actual.id}
          custom={direccion}
          variants={CAMBIO}
          initial="entra"
          animate="quieta"
          exit="sale"
          className="entrada-escalonada p-3 sm:p-4 md:p-6 max-w-[1600px] mx-auto"
        >
          {activeTab === 'DATA_WAREHOUSE' && <DataWarehouseTab onPortfolioUpdate={() => cambiarPestana('PORTFOLIO')} />}
          {activeTab === 'PORTFOLIO' && <PortfolioTab />}
          {activeTab === 'RECOMENDACIONES' && <RecommendationsTab />}
          {activeTab === 'TOP5' && <TopOportunidadesTab />}
          {activeTab === 'DIVIDENDOS' && <DividendsTab />}
          {activeTab === 'BUSCADOR' && <ScreenerTab />}
          {activeTab === 'CALCULADORA' && <SizingTab />}
          {activeTab === 'BACKTEST' && <BacktestTab />}
          {activeTab === 'SIMULACION' && <SimulacionTab />}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}
