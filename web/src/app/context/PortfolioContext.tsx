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
  isDemo: boolean;
  isCartolaMode: boolean;
  setItems: React.Dispatch<React.SetStateAction<PortfolioItem[]>>;
  refreshPortfolio: () => Promise<void>;
  resetPortfolio: () => void;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

const MOCK_PORTFOLIO: PortfolioItem[] = [
  { id: 'demo-1', ticker: 'AAPL', cantidad: 10, precio_compra: 150, moneda: 'USD', purchase_date: '2023-10-02' },
  { id: 'demo-2', ticker: 'TSLA', cantidad: 5, precio_compra: 200, moneda: 'USD', purchase_date: '2023-11-20' },
  { id: 'demo-3', ticker: 'MSFT', cantidad: 8, precio_compra: 300, moneda: 'USD', purchase_date: '2023-08-15' },
  { id: 'demo-4', ticker: 'SQM-B.SN', cantidad: 50, precio_compra: 40000, moneda: 'CLP', purchase_date: '2023-09-05' }
];

export const PortfolioProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [isCartolaMode, setIsCartolaMode] = useState(false);

  const fetchPortfolio = async () => {
    setLoading(true);
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
          } catch (e) {
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
        setItems(data);
      }
    } catch (error) {
      console.error("Error fetching portfolio context", error);
    } finally {
      setLoading(false);
    }
  };

  const resetPortfolio = () => {
    setItems([]);
    setIsDemo(false);
    setIsCartolaMode(false);
  };

  useEffect(() => {
    fetchPortfolio();
  }, []);

  useEffect(() => {
    if (isCartolaMode && typeof window !== 'undefined') {
      localStorage.setItem('cartolaItems', JSON.stringify(items));
    }
  }, [items, isCartolaMode]);

  return (
    <PortfolioContext.Provider value={{ items, loading, isDemo, isCartolaMode, setItems, refreshPortfolio: fetchPortfolio, resetPortfolio }}>
      {children}
    </PortfolioContext.Provider>
  );
};

export const usePortfolio = () => {
  const context = useContext(PortfolioContext);
  if (context === undefined) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return context;
};
