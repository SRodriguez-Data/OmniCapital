import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

export async function GET() {
  try {
    // 1. Obtener portafolio actual
    const { data: portfolio, error: portError } = await supabase
      .from('mi_portafolio')
      .select('ticker, cantidad, precio_compra');

    if (portError) throw portError;
    if (!portfolio || portfolio.length === 0) {
      return NextResponse.json([]);
    }

    const tickers = portfolio.map(p => p.ticker);
    const portfolioDict: Record<string, { cantidad: number, precio_compra: number }> = {};
    let totalCost = 0;
    
    portfolio.forEach(p => {
      portfolioDict[p.ticker] = { cantidad: p.cantidad, precio_compra: p.precio_compra };
      totalCost += p.cantidad * p.precio_compra;
    });

    // 2. Obtener precios históricos de los últimos 45 días para estos tickers
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 45);
    const dateStr = dateLimit.toISOString().split('T')[0];

    const { data: history, error: histError } = await supabase
      .from('precios_historicos')
      .select('ticker, date, close')
      .in('ticker', tickers)
      .gte('date', dateStr)
      .order('date', { ascending: true });

    if (histError) throw histError;

    // 3. Agrupar por fecha usando forward-fill para tickers sin operar un día (ej. feriados locales)
    const datesSet = new Set<string>();
    history.forEach(row => {
      const d = row.date.split('T')[0];
      datesSet.add(d);
    });

    const sortedDates = Array.from(datesSet).sort();
    
    const pricesByDateAndTicker: Record<string, Record<string, number>> = {};
    history.forEach(row => {
      const d = row.date.split('T')[0];
      if (!pricesByDateAndTicker[d]) pricesByDateAndTicker[d] = {};
      pricesByDateAndTicker[d][row.ticker] = row.close;
    });

    const result = [];
    const currentPrices: Record<string, number> = {};

    for (const d of sortedDates) {
      let dailyValue = 0;
      let validTickersCount = 0;

      for (const t of tickers) {
        if (pricesByDateAndTicker[d] && pricesByDateAndTicker[d][t] !== undefined) {
          currentPrices[t] = pricesByDateAndTicker[d][t];
        }

        if (currentPrices[t] !== undefined) {
          dailyValue += currentPrices[t] * portfolioDict[t].cantidad;
          validTickersCount++;
        }
      }

      // Evita caídas al inicio si faltan muchos precios
      if (validTickersCount > tickers.length * 0.5) {
        result.push({
          date: d,
          totalValue: dailyValue,
          totalCost: totalCost,
          profitLoss: dailyValue - totalCost
        });
      }
    }

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Error fetching portfolio history:', error);
    return NextResponse.json({ error: error.message || 'Error fetching history' }, { status: 500 });
  }
}
