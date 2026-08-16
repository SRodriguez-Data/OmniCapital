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
  refreshPortfolio: () => Promise<void>;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

const MOCK_PORTFOLIO: PortfolioItem[] = [
  { id: 'demo-1', ticker: 'AAPL', cantidad: 15, precio_compra: 175.50, moneda: 'USD', purchase_date: '2023-10-01' },
  { id: 'demo-2', ticker: 'MSFT', cantidad: 10, precio_compra: 330.20, moneda: 'USD', purchase_date: '2023-08-15' },
  { id: 'demo-3', ticker: 'TSLA', cantidad: 20, precio_compra: 210.00, moneda: 'USD', purchase_date: '2023-11-20' },
  { id: 'demo-4', ticker: 'SQM-B.SN', cantidad: 100, precio_compra: 42000, moneda: 'CLP', purchase_date: '2023-09-05' },
  { id: 'demo-5', ticker: 'NVDA', cantidad: 8, precio_compra: 450.00, moneda: 'USD', purchase_date: '2023-07-10' },
  { id: 'demo-6', ticker: 'VOO', cantidad: 25, precio_compra: 405.00, moneda: 'USD', purchase_date: '2023-01-15' },
  { id: 'demo-7', ticker: 'SCHD', cantidad: 40, precio_compra: 70.00, moneda: 'USD', purchase_date: '2023-02-20' },
  { id: 'demo-8', ticker: 'KHC', cantidad: 50, precio_compra: 32.50, moneda: 'USD', purchase_date: '2023-05-10' },
  { id: 'demo-9', ticker: 'BCHILE.SN', cantidad: 50000, precio_compra: 95.00, moneda: 'CLP', purchase_date: '2023-12-01' },
  { id: 'demo-10', ticker: 'BSANTANDER.SN', cantidad: 80000, precio_compra: 42.00, moneda: 'CLP', purchase_date: '2023-11-15' },
  { id: 'demo-11', ticker: 'ENELCHILE.SN', cantidad: 15000, precio_compra: 55.00, moneda: 'CLP', purchase_date: '2023-06-10' }
];

export const PortfolioProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  const fetchPortfolio = async () => {
    setLoading(true);
    try {
      const demoMode = typeof window !== 'undefined' && localStorage.getItem('isDemo') === 'true';
      setIsDemo(demoMode);

      if (demoMode) {
        setItems(MOCK_PORTFOLIO);
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

  useEffect(() => {
    fetchPortfolio();
  }, []);

  return (
    <PortfolioContext.Provider value={{ items, loading, isDemo, refreshPortfolio: fetchPortfolio }}>
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
