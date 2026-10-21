'use client';

import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { Lock, Mail, ChevronRight, Loader2 } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';
import { useLanguage } from '../context/LanguageContext';
import { RESORTE, SUAVE } from '../components/Movimiento';
import { LogoMarca, LogoNombre } from '../components/Logo';

// La tarjeta entra primero y después sus partes, una tras otra
const TARJETA: Variants = {
  oculta: { opacity: 0, y: 32, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { ...RESORTE, staggerChildren: 0.07, delayChildren: 0.15 } },
};
const PARTE: Variants = {
  oculta: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: SUAVE } },
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const router = useRouter();
  const { refreshPortfolio, resetPortfolio } = usePortfolio();
  const { t, language, toggleLanguage } = useLanguage();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (localStorage.getItem('isDemo') === 'true' || localStorage.getItem('isCartolaMode') === 'true') {
        router.push('/');
        return;
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push('/');
      }
    });
  }, [router]);

  const handleDemoLogin = async () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('isCartolaMode');
      localStorage.setItem('isDemo', 'true');
      resetPortfolio();
      await refreshPortfolio();
      router.push('/');
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setErrorMsg(t('login.email_confirmation'));
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        if (typeof window !== 'undefined') {
          localStorage.removeItem('isDemo');
          localStorage.removeItem('isCartolaMode');
          localStorage.removeItem('cartolaItems');
        }

        resetPortfolio();
        await refreshPortfolio();

        router.push('/');
      }
    } catch (error: unknown) {
      setErrorMsg((error instanceof Error && error.message) || t('login.error_auth'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-[#09090b] flex flex-col items-center justify-center font-sans px-4 py-16 relative overflow-hidden">
      {/* Manchas de color que flotan despacio en el fondo */}
      <div className="flotar absolute top-[-10%] left-[-10%] w-72 h-72 md:w-96 md:h-96 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
      <div className="flotar-lento absolute bottom-[-10%] right-[-10%] w-72 h-72 md:w-96 md:h-96 bg-teal-500/15 rounded-full blur-3xl pointer-events-none" />

      {/* Language Toggle in Login */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        onClick={toggleLanguage}
        className="absolute top-4 right-4 md:top-6 md:right-6 flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-bold text-zinc-500 hover:text-emerald-500 transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-[#27272a] rounded z-20 bg-white/50 dark:bg-black/50 backdrop-blur-sm"
      >
        {language.toUpperCase()}
      </motion.button>

      <motion.div
        variants={TARJETA}
        initial="oculta"
        animate="visible"
        className="w-full max-w-md bg-white/80 dark:bg-[#18181b]/80 backdrop-blur-md border border-zinc-200/50 dark:border-[#27272a]/50 rounded-3xl shadow-xl overflow-hidden transition-colors duration-300 z-10"
      >

        {/* Header */}
        <div className="p-6 sm:p-8 pb-6 text-center border-b border-zinc-100 dark:border-[#27272a]">
          <motion.div
            initial={{ scale: 0.6, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ ...RESORTE, stiffness: 200, damping: 14, delay: 0.15 }}
            whileHover={{ rotate: -10, scale: 1.08 }}
            className="mx-auto w-16 h-16 mb-4"
          >
            <LogoMarca className="w-16 h-16 text-zinc-900 dark:text-white drop-shadow-[0_0_18px_rgba(16,185,129,0.35)]" animar retraso={0.25} duracion={1} />
          </motion.div>
          <motion.h1 variants={PARTE}>
            <LogoNombre className="text-4xl" />
          </motion.h1>
          <motion.p variants={PARTE} className="text-zinc-500 dark:text-[#a1a1aa] text-[10px] font-mono uppercase tracking-[0.2em] mt-3">
            Wealth Management Platform
          </motion.p>
        </div>

        {/* Form */}
        <form onSubmit={handleAuth} className="p-6 sm:p-8 space-y-6">
          <AnimatePresence initial={false}>
            {errorMsg && (
              <motion.div
                key="error"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto', x: [0, -8, 8, -4, 4, 0] }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35 }}
                className="overflow-hidden"
              >
                <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm font-mono border border-red-200 dark:border-red-900/50">
                  {errorMsg}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-4">
            <motion.div variants={PARTE}>
              <label className="block text-xs font-medium text-zinc-500 dark:text-[#71717a] mb-1">
                {t('auth.email')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-zinc-400 dark:text-[#71717a]" />
                </div>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded-xl text-zinc-900 dark:text-[#e4e4e7] placeholder-zinc-400 dark:placeholder-[#71717a] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 text-sm transition-all"
                  placeholder="admin@omnicapital.com"
                />
              </div>
            </motion.div>

            <motion.div variants={PARTE}>
              <label className="block text-xs font-medium text-zinc-500 dark:text-[#71717a] mb-1">
                {t('auth.password')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-zinc-400 dark:text-[#71717a]" />
                </div>
                <input
                  type="password"
                  required
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2.5 bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded-xl text-zinc-900 dark:text-[#e4e4e7] placeholder-zinc-400 dark:placeholder-[#71717a] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 text-sm transition-all"
                  placeholder="••••••••"
                />
              </div>
            </motion.div>
          </div>

          <motion.div variants={PARTE}>
            <button
              type="submit"
              disabled={loading}
              className="brillo w-full flex items-center justify-center gap-2 py-3 px-4 bg-zinc-900 hover:bg-zinc-800 dark:bg-[#e4e4e7] dark:hover:bg-white text-white dark:text-zinc-900 rounded-xl text-sm font-semibold shadow-lg shadow-zinc-200 dark:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? t('auth.logging_in') : isSignUp ? t('login.register_button') : t('login.button')}
              {!loading && <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
            </button>
          </motion.div>

          <motion.div variants={PARTE} className="text-center mt-4">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-xs text-zinc-500 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-[#e4e4e7] transition-colors"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={isSignUp ? 'entrar' : 'registrarse'}
                  className="inline-block"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                >
                  {isSignUp ? '¿Ya tienes cuenta? Inicia Sesión' : '¿No tienes cuenta? Regístrate'}
                </motion.span>
              </AnimatePresence>
            </button>
          </motion.div>

          <motion.div variants={PARTE} className="relative flex items-center justify-center mt-6 mb-2">
            <div className="border-t border-zinc-200 dark:border-[#27272a] absolute w-full"></div>
            <span className="bg-white dark:bg-[#18181b] px-3 text-xs text-zinc-400 dark:text-[#52525b] relative z-10 font-mono">O</span>
          </motion.div>

          <motion.div variants={PARTE} className="space-y-2">
            <button
              type="button"
              onClick={handleDemoLogin}
              className="w-full flex items-center justify-center gap-2 bg-zinc-100 dark:bg-[#27272a] hover:bg-zinc-200 dark:hover:bg-[#3f3f46] text-zinc-900 dark:text-white p-3 rounded-lg text-sm font-bold font-mono transition-colors"
            >
              ENTRAR EN MODO DEMO
            </button>

            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  localStorage.removeItem('isDemo');
                  localStorage.removeItem('cartolaItems');
                  localStorage.setItem('isCartolaMode', 'true');
                  resetPortfolio();
                  refreshPortfolio().then(() => {
                    router.push('/');
                  });
                }
              }}
              className="w-full flex items-center justify-center gap-2 bg-transparent border border-zinc-200 dark:border-[#27272a] hover:bg-zinc-50 dark:hover:bg-[#27272a] text-zinc-500 dark:text-zinc-400 py-2 rounded-lg text-xs font-bold font-mono transition-colors"
            >
              PRUEBA LECTOR DE CARTOLAS (MODO VIDEO)
            </button>
          </motion.div>

        </form>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.6 }}
        className="mt-8 text-xs text-zinc-400 dark:text-[#52525b] font-mono text-center max-w-sm"
      >
        Acceso restringido. Sistema de uso institucional.
        Toda la actividad es monitoreada.
      </motion.p>
    </main>
  );
}
