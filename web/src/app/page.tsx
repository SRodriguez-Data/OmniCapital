import { supabase } from '@/lib/supabase';
import DashboardClient from './DashboardClient';

export const revalidate = 60; // Revalidate every minute

export default async function Home() {
  // Fetch latest market data
  // Due to Supabase API limitations on distinct, we'll fetch the latest 500 rows ordered by date.
  // This assumes the miner runs and inserts 1 row per ticker per day.
  const { data: marketData, error } = await supabase
    .from('precios_historicos')
    .select('*')
    .order('date', { ascending: false })
    .limit(600);

  if (error) {
    console.error("Supabase Error:", error);
    return (
      <div className="flex h-screen items-center justify-center bg-background text-bearish">
        <h2>Error al conectar con la base de datos (Supabase).</h2>
        <p>{error.message}</p>
      </div>
    );
  }

  // Filter to keep only the absolute latest row per ticker (in case limit(600) brings multiple days for one ticker)
  const latestByTicker = new Map();
  if (marketData) {
    for (const row of marketData) {
      if (!latestByTicker.has(row.ticker)) {
        latestByTicker.set(row.ticker, row);
      }
    }
  }

  const uniqueData = Array.from(latestByTicker.values());

  return (
    <main className="min-h-screen p-4 md:p-8">
      <header className="mb-8 flex items-center justify-between border-b border-surface-elevated pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-brand">Quantum Trader</h1>
          <p className="text-text-secondary">Dashboard Institucional & Radar de Mercado</p>
        </div>
      </header>
      
      <DashboardClient initialData={uniqueData} />
    </main>
  );
}
