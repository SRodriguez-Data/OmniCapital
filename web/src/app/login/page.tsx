'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { Lock, Mail, ChevronRight, Activity } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const router = useRouter();
  const { refreshPortfolio, resetPortfolio } = usePortfolio();

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
        // Si el registro es exitoso pero requiere confirmación de correo
        setErrorMsg('Revisa tu correo para confirmar tu cuenta. Si no configuraste confirmación, ya puedes iniciar sesión.');
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
        await refreshPortfolio(); // Carga el portafolio real del usuario de la DB
        
        router.push('/');
      }
    } catch (error: any) {
      setErrorMsg(error.message || 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-100 dark:bg-[#09090b] flex flex-col items-center justify-center font-sans p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-2xl shadow-sm overflow-hidden transition-colors duration-300">
        
        {/* Header */}
        <div className="p-8 text-center border-b border-zinc-100 dark:border-[#27272a]">
          <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mb-4">
            <Activity className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7]">
            QUANTUM TRADER
          </h1>
          <p className="text-zinc-500 dark:text-[#a1a1aa] text-xs font-mono uppercase tracking-widest mt-2">
            Terminal Institucional
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleAuth} className="p-8 space-y-6">
          {errorMsg && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm font-mono border border-red-200 dark:border-red-900/50">
              {errorMsg}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-[#71717a] mb-1">
                Correo Electrónico
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-zinc-400 dark:text-[#71717a]" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] text-zinc-900 dark:text-[#e4e4e7] rounded-lg p-2.5 text-sm focus:ring-blue-500 focus:border-blue-500 dark:focus:border-[#60a5fa] outline-none transition-colors"
                  placeholder="admin@ejemplo.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-[#71717a] mb-1">
                Contraseña
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-zinc-400 dark:text-[#71717a]" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] text-zinc-900 dark:text-[#e4e4e7] rounded-lg p-2.5 text-sm focus:ring-blue-500 focus:border-blue-500 dark:focus:border-[#60a5fa] outline-none transition-colors"
                  placeholder="••••••••"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-lg text-sm font-bold font-mono transition-colors disabled:opacity-50"
          >
            {loading ? 'Procesando...' : isSignUp ? 'CREAR PERFIL' : 'ACCEDER'}
            {!loading && <ChevronRight className="w-4 h-4" />}
          </button>
          
          <div className="text-center mt-4">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-xs text-zinc-500 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-[#e4e4e7] transition-colors"
            >
              {isSignUp ? '¿Ya tienes cuenta? Inicia Sesión' : '¿No tienes cuenta? Regístrate'}
            </button>
          </div>

          <div className="relative flex items-center justify-center mt-6 mb-2">
            <div className="border-t border-zinc-200 dark:border-[#27272a] absolute w-full"></div>
            <span className="bg-white dark:bg-[#18181b] px-3 text-xs text-zinc-400 dark:text-[#52525b] relative z-10 font-mono">O</span>
          </div>

          <button
            type="button"
            onClick={handleDemoLogin}
            className="w-full flex items-center justify-center gap-2 bg-zinc-100 dark:bg-[#27272a] hover:bg-zinc-200 dark:hover:bg-[#3f3f46] text-zinc-900 dark:text-white p-3 rounded-lg text-sm font-bold font-mono transition-colors"
          >
            ENTRAR COMO JURADO (DEMO)
          </button>
          
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                localStorage.removeItem('isDemo');
                localStorage.setItem('isCartolaMode', 'true');
                router.push('/');
              }
            }}
            className="w-full flex items-center justify-center gap-2 bg-transparent border border-zinc-200 dark:border-[#27272a] hover:bg-zinc-50 dark:hover:bg-[#27272a] text-zinc-500 dark:text-zinc-400 py-2 rounded-lg text-xs font-bold font-mono transition-colors mt-2"
          >
            PRUEBA LECTOR DE CARTOLAS (MODO VIDEO)
          </button>

        </form>
      </div>
      
      <p className="mt-8 text-xs text-zinc-400 dark:text-[#52525b] font-mono text-center max-w-sm">
        Acceso restringido. Sistema de uso institucional.
        Toda la actividad es monitoreada.
      </p>
    </main>
  );
}
