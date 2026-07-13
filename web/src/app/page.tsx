import { supabase } from '@/lib/supabase';
import DashboardClient from './DashboardClient';

export const dynamic = 'force-dynamic';

export default async function Home() {
  // Fetch latest market data
  const { data: marketData, error } = await supabase
    .from('precios_historicos')
    .select('*')
    .order('date', { ascending: false })
    .limit(600);

  if (error) {
    console.error("Supabase Error:", error);
    return (
      <div className="flex h-screen items-center justify-center bg-[#09090b] text-[#f87171] font-mono">
        <h2>Error al conectar con la base de datos (Supabase).</h2>
        <p>{error.message}</p>
      </div>
    );
  }

  // Filter to keep only the absolute latest row per ticker
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

  if (aiError) console.error("Supabase AI Fetch Error:", aiError);
  const latestAiReport = aiData && aiData.length > 0 ? aiData[0] : null;

  // Fetch Correlation Matrix
  const { data: corrData } = await supabase
    .from('correlaciones')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(1);
    
  const correlationMatrix = corrData && corrData.length > 0 ? corrData[0].matriz_json : null;

  // Fetch Efficient Frontier
  const { data: frontierData } = await supabase
    .from('frontera_eficiente')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(1);
    
  const efficientFrontier = frontierData && frontierData.length > 0 ? frontierData[0].puntos_json : null;

  return (
    <main className="min-h-screen bg-[#09090b] text-[#fafafa] p-4 md:p-8 font-sans">
      <header className="mb-6 flex flex-col md:flex-row items-start md:items-end justify-between border-b border-[#27272a] pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#e4e4e7]">
            QUANTUM TRADER TERMINAL
          </h1>
          <p className="text-[#a1a1aa] mt-1 font-mono text-sm uppercase tracking-widest">
            Institutional Quantitative Alpha
          </p>
        </div>
        {latestAiReport && (
          <div className="mt-4 md:mt-0 text-xs font-mono bg-[#18181b] px-3 py-1.5 border border-[#27272a] text-[#71717a] uppercase">
            Data Date: {new Date(latestAiReport.fecha).toLocaleString('en-US', { timeZone: 'America/Santiago' })}
          </div>
        )}
      </header>
      
      <DashboardClient 
        initialData={uniqueData} 
        aiReport={latestAiReport}
        correlationMatrix={correlationMatrix}
        efficientFrontier={efficientFrontier}
      />
    </main>
  );
}
