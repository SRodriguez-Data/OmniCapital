import { supabase } from '@/lib/supabase';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

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

  // Fetch latest AI analysis
  const { data: aiData, error: aiError } = await supabase
    .from('analisis_ia')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(1);

  if (aiError) {
    console.error("Supabase AI Fetch Error:", aiError);
  }

  const latestAiReport = aiData && aiData.length > 0 ? aiData[0] : null;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-8">
      <header className="mb-8 flex flex-col md:flex-row items-start md:items-center justify-between border-b border-white/10 pb-6">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
            Quantum Trader
          </h1>
          <p className="text-gray-400 mt-2 font-medium">Terminal Cuantitativa Híbrida & Inteligencia Artificial</p>
        </div>
        {latestAiReport && (
          <div className="mt-4 md:mt-0 text-sm bg-white/5 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-gray-300 shadow-xl">
            Último Escaneo: {new Date(latestAiReport.fecha).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}
          </div>
        )}
      </header>
      
      <DashboardClient initialData={uniqueData} aiReport={latestAiReport} />
    </main>
  );
}
