import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
      global: { headers: { Authorization: authHeader || '' } }
    });
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '45D';

    // 1. Obtener portafolio actual
    const { data: portfolio, error: portError } = await supabase
      .from('mi_portafolio')
      .select('ticker, cantidad, precio_compra, moneda');

    if (portError) throw portError;
    if (!portfolio || portfolio.length === 0) {
      return NextResponse.json([]);
    }

    const tickers = portfolio.map(p => p.ticker);
    const portfolioDict: Record<string, { cantidad: number, precio_compra: number, isCLP: boolean }> = {};
    const USD_CLP = 940; // Fixed exchange rate proxy
    
    portfolio.forEach(p => {
      const isCLP = p.moneda === 'CLP' || p.ticker.endsWith('.SN');
      portfolioDict[p.ticker] = { 
        cantidad: p.cantidad, 
        precio_compra: isCLP ? p.precio_compra / USD_CLP : p.precio_compra,
        isCLP
      };
    });

    // 2. Determinar la fecha límite según el rango
    const dateLimit = new Date();
    if (range === '1W') dateLimit.setDate(dateLimit.getDate() - 7);
    else if (range === '1M') dateLimit.setMonth(dateLimit.getMonth() - 1);
    else if (range === '3M') dateLimit.setMonth(dateLimit.getMonth() - 3);
    else if (range === '6M') dateLimit.setMonth(dateLimit.getMonth() - 6);
    else if (range === 'YTD') {
      dateLimit.setMonth(0);
      dateLimit.setDate(1);
    }
    else if (range === '1Y') dateLimit.setFullYear(dateLimit.getFullYear() - 1);
    else if (range === 'ALL') dateLimit.setFullYear(dateLimit.getFullYear() - 10);
    else dateLimit.setDate(dateLimit.getDate() - 45); // Default 45D

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
      let dailyCost = 0;
      let validTickersCount = 0;

      for (const t of tickers) {
        if (pricesByDateAndTicker[d] && pricesByDateAndTicker[d][t] !== undefined) {
          currentPrices[t] = pricesByDateAndTicker[d][t];
        }

        if (currentPrices[t] !== undefined) {
          const priceUSD = portfolioDict[t].isCLP ? currentPrices[t] / USD_CLP : currentPrices[t];
          dailyValue += priceUSD * portfolioDict[t].cantidad;
          dailyCost += portfolioDict[t].precio_compra * portfolioDict[t].cantidad;
          validTickersCount++;
        }
      }

      // Evita caídas al inicio si faltan muchos precios
      if (validTickersCount > tickers.length * 0.5) {
        result.push({
          date: d,
          totalValue: dailyValue,
          totalCost: dailyCost,
          profitLoss: dailyValue - dailyCost
        });
      }
    }

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Error fetching portfolio history:', error);
    return NextResponse.json({ error: error.message || 'Error fetching history' }, { status: 500 });
  }
}
