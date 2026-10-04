import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const MAX_ITEMS = 60;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

interface PortfolioRow {
  id: string;
  ticker: string;
  cantidad: number;
  precio_compra: number;
  moneda: 'USD' | 'CLP';
  purchase_date?: string;
}

export async function POST(req: Request) {
  try {
    let portfolio: PortfolioRow[] = [];
    const bodyText = await req.text();
    if (bodyText) {
      const body = JSON.parse(bodyText);
      if (Array.isArray(body.items)) portfolio = body.items;
    }

    if (portfolio.length === 0) {
      const authHeader = req.headers.get('authorization');
      const supabaseClient = createClient(supabaseUrl || '', supabaseKey || '', {
        global: { headers: { Authorization: authHeader || '' } }
      });

      const { data, error } = await supabaseClient
        .from('mi_portafolio')
        .select('*');

      if (error) throw error;
      portfolio = data || [];
    }

    if (portfolio.length === 0) {
      return NextResponse.json([]);
    }
    if (portfolio.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Máximo ${MAX_ITEMS} activos por consulta` }, { status: 400 });
    }

    const now = Date.now();
    const oneYearAgo = new Date(now - ONE_YEAR_MS);

    const dividendData = await Promise.all(
      portfolio.map(async (item) => {
        try {
          // Una sola llamada: precio actual + eventos de dividendos reales desde la fecha
          // más antigua que necesitamos (compra o 12 meses atrás para el TTM).
          const purchase = item.purchase_date ? new Date(item.purchase_date) : null;
          const period1 = purchase && !isNaN(purchase.getTime()) && purchase < oneYearAgo ? purchase : oneYearAgo;

          const chart = await yahooFinance.chart(item.ticker, { period1, interval: '1mo', events: 'div' });
          const price = chart.meta.regularMarketPrice as number | undefined;
          const dividends = chart.events?.dividends || [];

          // Dividendo anual por acción = suma de lo pagado en los últimos 12 meses (TTM)
          const divRate = dividends
            .filter(d => d.date >= oneYearAgo)
            .reduce((sum, d) => sum + d.amount, 0);
          const divYield = price && price > 0 ? divRate / price : 0;

          // Lo cobrado desde la compra, asumiendo la cantidad actual durante todo el período
          const historicalReceived = purchase
            ? dividends.filter(d => d.date >= purchase).reduce((sum, d) => sum + d.amount * item.cantidad, 0)
            : 0;

          return {
            id: item.id,
            ticker: item.ticker,
            cantidad: item.cantidad,
            precio_compra: item.precio_compra,
            moneda: item.moneda,
            dividendYield: divYield,
            personalYield: item.precio_compra > 0 ? divRate / item.precio_compra : divYield, // Yield on Cost
            dividendRate: divRate,
            projectedAnnualIncome: divRate * item.cantidad,
            historicalReceived
          };
        } catch (e) {
          console.error(`Error fetching dividends for ${item.ticker}:`, e);
          return null;
        }
      })
    );

    // Solo los activos que efectivamente pagaron dividendos en los últimos 12 meses
    const payingDividends = dividendData.filter((d): d is NonNullable<typeof d> => d !== null && d.dividendRate > 0);
    payingDividends.sort((a, b) => b.projectedAnnualIncome - a.projectedAnnualIncome);

    return NextResponse.json(payingDividends);

  } catch (err: unknown) {
    console.error('API Dividends Error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 });
  }
}
