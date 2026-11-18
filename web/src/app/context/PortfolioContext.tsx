'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface PortfolioItem {
  id: string;
  ticker: string;
  cantidad: number;
  precio_compra: number;
  moneda: 'USD' | 'CLP';
  purchase_date: string;
}

interface PortfolioContextType {
  items: PortfolioItem[];
  loading: boolean;
  // La cartera guardada no se pudo leer (sesión vencida, base caída): una lista vacía NO significa "sin posiciones"
  error: string | null;
  isDemo: boolean;
  isCartolaMode: boolean;
  setItems: React.Dispatch<React.SetStateAction<PortfolioItem[]>>;
  refreshPortfolio: () => Promise<void>;
  resetPortfolio: () => void;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

const MOCK_PORTFOLIO: PortfolioItem[] = [
  { id: 'demo-1', ticker: 'AAPL', cantidad: 15, precio_compra: 171.43, moneda: 'USD', purchase_date: '2023-10-02' },
  { id: 'demo-2', ticker: 'MSFT', cantidad: 10, precio_compra: 314.42, moneda: 'USD', purchase_date: '2023-08-15' },
  { id: 'demo-3', ticker: 'TSLA', cantidad: 20, precio_compra: 235.60, moneda: 'USD', purchase_date: '2023-11-20' },
  { id: 'demo-4', ticker: 'SQM-B.SN', cantidad: 100, precio_compra: 54363.45, moneda: 'CLP', purchase_date: '2023-09-05' },
  { id: 'demo-5', ticker: 'NVDA', cantidad: 80, precio_compra: 42.10, moneda: 'USD', purchase_date: '2023-07-10' },
  { id: 'demo-6', ticker: 'VOO', cantidad: 25, precio_compra: 348.77, moneda: 'USD', purchase_date: '2023-01-17' },
  { id: 'demo-7', ticker: 'SCHD', cantidad: 136.28, precio_compra: 22.13, moneda: 'USD', purchase_date: '2023-02-21' },
  { id: 'demo-8', ticker: 'KHC', cantidad: 50, precio_compra: 34.20, moneda: 'USD', purchase_date: '2023-05-10' },
  { id: 'demo-9', ticker: 'CHILE.SN', cantidad: 50000, precio_compra: 85.48, moneda: 'CLP', purchase_date: '2023-12-01' },
  { id: 'demo-10', ticker: 'BSANTANDER.SN', cantidad: 80000, precio_compra: 36.28, moneda: 'CLP', purchase_date: '2023-11-15' },
  { id: 'demo-11', ticker: 'ENELCHILE.SN', cantidad: 15000, precio_compra: 40.87, moneda: 'CLP', purchase_date: '2023-06-12' }
];

const NO_CARGO = 'No pude cargar tu portafolio. Revisa tu conexión e intenta de nuevo.';

export const PortfolioProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [isCartolaMode, setIsCartolaMode] = useState(false);

  const fetchPortfolio = async () => {
    setLoading(true);
    setError(null);
    try {
      const demoMode = typeof window !== 'undefined' && localStorage.getItem('isDemo') === 'true';
      const cartolaMode = typeof window !== 'undefined' && localStorage.getItem('isCartolaMode') === 'true';
      
      setIsDemo(demoMode);
      setIsCartolaMode(cartolaMode);

      if (demoMode) {
        setItems(MOCK_PORTFOLIO);
        setLoading(false);
        return;
      }

      if (cartolaMode) {
        const savedCartola = localStorage.getItem('cartolaItems');
        if (savedCartola) {
          try {
            setItems(JSON.parse(savedCartola));
          } catch {
            setItems(prev => prev.length > 0 ? prev : []);
          }
        } else {
          setItems(prev => prev.length > 0 ? prev : []);
        }
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setItems([]);
        setLoading(false);
        return;
      }

      const res = await fetch('/api/portfolio', {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('respuesta inesperada');
        setItems(data);
      } else {
        // Lo que ya estaba en pantalla se conserva; lo que no se puede es mostrar "portafolio vacío"
        setError(res.status === 401 ? 'No pude cargar tu portafolio: tu sesión expiró. Vuelve a entrar.' : NO_CARGO);
      }
    } catch (error) {
      console.error("Error fetching portfolio context", error);
      setError(NO_CARGO);
    } finally {
      setLoading(false);
    }
  };

  const resetPortfolio = () => {
    setItems([]);
    setError(null);
    setIsDemo(false);
    setIsCartolaMode(false);
  };

  useEffect(() => {
    // Carga inicial: depende de localStorage y de la sesión, que solo existen en el cliente
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPortfolio();
  }, []);

  useEffect(() => {
    if (isCartolaMode && typeof window !== 'undefined') {
      localStorage.setItem('cartolaItems', JSON.stringify(items));
    }
  }, [items, isCartolaMode]);

  return (
    <PortfolioContext.Provider value={{ items, loading, error, isDemo, isCartolaMode, setItems, refreshPortfolio: fetchPortfolio, resetPortfolio }}>
      {children}
    </PortfolioContext.Provider>
  );
};

/** Lo que muestran las vistas cuando la cartera no se pudo leer, en vez de tratarla como vacía. */
export function PortafolioNoCargado() {
  const { error, loading, refreshPortfolio } = usePortfolio();
  if (!error) return null;
  return (
    <div role="alert" className="max-w-2xl mx-auto bg-[#f87171]/10 border border-[#f87171]/50 rounded p-6 text-center space-y-3">
      <p className="font-bold text-[#f87171]">{error}</p>
      <p className="text-sm text-zinc-600 dark:text-[#a1a1aa]">Mientras no cargue, no te muestro recomendaciones: saldrían calculadas sin tus posiciones.</p>
      <button onClick={() => refreshPortfolio()} disabled={loading} className="text-sm font-mono font-bold uppercase text-[#60a5fa] disabled:opacity-50">
        {loading ? 'Cargando…' : 'Reintentar'}
      </button>
    </div>
  );
}

export const usePortfolio = () => {
  const context = useContext(PortfolioContext);
  if (context === undefined) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return context;
};
