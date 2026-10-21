'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion';
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
import Bienvenida from './components/Bienvenida';
import { LogoMarca, LogoNombre } from './components/Logo';
import { ThemeToggle } from './components/ThemeToggle';
import { RESORTE, SUAVE } from './components/Movimiento';
import { Briefcase, Activity, Search, Calculator, Target, DollarSign, History, LogOut, Database, FlaskConical, type LucideIcon } from 'lucide-react';
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

// La bienvenida se muestra completa una vez por sesión del navegador; después solo se desvanece
const CLAVE_BIENVENIDA = 'omni-bienvenida';

// La pestaña nueva entra desde el lado hacia donde se avanzó en el menú y la anterior sale hacia el otro.
// La primera (al terminar la bienvenida) sube desde abajo.
const CAMBIO: Variants = {
  entra: (dir: number) => ({ opacity: 0, x: dir * 40, y: dir === 0 ? 28 : 0 }),
  quieta: { opacity: 1, x: 0, y: 0, transition: { duration: 0.5, ease: SUAVE } },
  sale: (dir: number) => ({ opacity: 0, x: dir * -40, transition: { duration: 0.16, ease: 'easeIn' } }),
};
// Entrada del panel cuando se va la bienvenida: el encabezado baja y las pestañas aparecen una tras otra
const ARRIBA: Variants = {
  oculto: { opacity: 0, y: -28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: SUAVE } },
};
const MENU: Variants = {
  oculto: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3, delay: 0.15, staggerChildren: 0.045, delayChildren: 0.25 } },
};
const BOTON: Variants = {
  oculto: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: SUAVE } },
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<Pestana>('DATA_WAREHOUSE');
  const [direccion, setDireccion] = useState(0);
  const [session, setSession] = useState<{ user: { id: string; email?: string } } | null>(null);
  const [minimoCumplido, setMinimoCumplido] = useState(false);
  const [rapida, setRapida] = useState(false);
  const reducido = useReducedMotion();
  const router = useRouter();
  const { isDemo } = usePortfolio();
  const ancla = useRef<HTMLDivElement>(null);
  const botones = useRef<Partial<Record<Pestana, HTMLButtonElement | null>>>({});

  // La bienvenida sigue hasta que termina su animación y hay sesión; ahí entra el panel
  const intro = !(minimoCumplido && session);
  const listo = !intro;

  useEffect(() => {
    let vista = false;
    try { vista = sessionStorage.getItem(CLAVE_BIENVENIDA) === '1'; } catch { /* sin almacenamiento */ }
    const t = window.setTimeout(() => {
      setRapida(vista);
      setMinimoCumplido(true);
      try { sessionStorage.setItem(CLAVE_BIENVENIDA, '1'); } catch { /* sin almacenamiento */ }
    }, vista ? 0 : reducido ? 700 : 2200);
    return () => window.clearTimeout(t);
  }, [reducido]);

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

  const actual = PESTANAS[posicion(activeTab)];
  const estado = listo ? 'visible' : 'oculto';

  return (
    <>
      <AnimatePresence custom={rapida}>
        {intro && <Bienvenida key="bienvenida" />}
      </AnimatePresence>

      {/* El panel se arma debajo de la bienvenida (así sus datos ya vienen cargando) y aparece cuando ella se va */}
      {session && (
        <main className="relative isolate min-h-screen overflow-x-clip bg-zinc-100 dark:bg-[#09090b] text-zinc-900 dark:text-[#fafafa] font-sans transition-colors duration-300 pb-[env(safe-area-inset-bottom)]">
          {/* Luces de color que flotan despacio detrás de todo */}
          <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
            <div className="flotar absolute -top-1/4 -left-1/4 w-[70vw] h-[70vw] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.10),transparent_65%)]" />
            <div className="flotar-lento absolute top-1/3 -right-1/4 w-[60vw] h-[60vw] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.08),transparent_65%)]" />
          </div>

          <motion.header
            variants={ARRIBA}
            initial="oculto"
            animate={estado}
            // z-40: el desenfoque crea su propia capa, y el panel de alertas tiene que quedar sobre el menú de pestañas
            className="relative z-40 border-b border-zinc-200 dark:border-[#27272a] bg-white/80 dark:bg-[#18181b]/75 backdrop-blur-md px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3 shadow-sm dark:shadow-none transition-colors duration-300"
          >
            <div className="flex items-center gap-3 min-w-0">
              <motion.div whileHover={{ rotate: -12, scale: 1.1 }} transition={RESORTE} className="shrink-0">
                <LogoMarca key={listo ? 'dibujo' : 'quieto'} animar={listo} retraso={0.35} duracion={0.9} className="w-9 h-9 md:w-10 md:h-10 text-zinc-900 dark:text-white" />
              </motion.div>
              <div className="min-w-0">
                <h1 className="leading-none"><LogoNombre className="text-xl md:text-2xl" /></h1>
                <p className="hidden sm:block text-zinc-500 dark:text-[#a1a1aa] text-[10px] font-mono uppercase tracking-[0.2em] mt-1">
                  Wealth Management Platform
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
            {/* Línea de luz que se dibuja bajo el encabezado */}
            <motion.div
              aria-hidden
              className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={listo ? { scaleX: 1, opacity: 1 } : { scaleX: 0, opacity: 0 }}
              transition={{ delay: 0.3, duration: 0.9, ease: SUAVE }}
            />
          </motion.header>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: listo ? 1 : 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
            {isDemo && (
              <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 text-xs font-mono text-center py-2 px-4 border-b border-amber-300/60">
                Modo demo: estás viendo un portafolio de ejemplo, no el tuyo. Para salir, usa el botón de salir.
              </div>
            )}
            <MacroPanel />
          </motion.div>

          <div ref={ancla} />
          {/* MENÚ DE PESTAÑAS: queda pegado arriba al bajar; en el celular se desliza con el dedo */}
          <motion.nav
            variants={MENU}
            initial="oculto"
            animate={estado}
            className="sticky top-0 z-30 border-b border-zinc-200 dark:border-[#27272a] bg-white/85 dark:bg-[#09090b]/85 backdrop-blur-md shadow-sm dark:shadow-none transition-colors duration-300"
          >
            <div className="relative">
              <div className="flex overflow-x-auto whitespace-nowrap scrollbar-hide">
                {PESTANAS.map(p => {
                  const activa = p.id === activeTab;
                  const Icono = p.icono;
                  return (
                    <motion.button
                      key={p.id}
                      variants={BOTON}
                      ref={el => { botones.current[p.id] = el; }}
                      onClick={() => cambiarPestana(p.id)}
                      aria-current={activa ? 'page' : undefined}
                      className={`relative flex-shrink-0 flex items-center justify-center gap-2 px-4 md:px-6 py-3 md:py-4 font-sans font-bold text-xs uppercase tracking-wider transition-colors ${activa ? p.texto : 'text-zinc-500 dark:text-[#71717a] hover:text-zinc-900 dark:hover:text-[#a1a1aa]'}`}
                    >
                      {activa && (
                        <>
                          <motion.span layoutId="pestana-fondo" transition={RESORTE} className="absolute inset-0 bg-zinc-100/80 dark:bg-[#18181b]/80" />
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
                    </motion.button>
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
              animate={listo ? 'quieta' : 'entra'}
              exit="sale"
              className={`${listo ? 'entrada-escalonada' : ''} p-3 sm:p-4 md:p-6 max-w-[1600px] mx-auto`}
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
      )}
    </>
  );
}
