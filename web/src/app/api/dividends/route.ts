import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

export async function POST(req: Request) {
  try {
    let portfolio: any[] = [];
    const bodyText = await req.text();
    if (bodyText) {
      const body = JSON.parse(bodyText);
      if (body.items) portfolio = body.items;
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

    if (!portfolio || portfolio.length === 0) {
      return NextResponse.json([]);
    }

    const dividendData = await Promise.all(
      portfolio.map(async (item) => {
        try {
          const quote = await yahooFinance.quote(item.ticker) as any;
          let divRate = quote.trailingAnnualDividendRate || 0;
          let divYield = quote.trailingAnnualDividendYield || 0;
          
          // Fallbacks para mercado chileno (sobreescribimos Yahoo Finance porque suele estar desactualizado)
          if (item.ticker === 'CFMITNIPSA' || item.ticker === 'CFMITNIPSA.SN') {
            divRate = quote.regularMarketPrice * 0.035; // ~3.5% histórico
            divYield = 0.035;
          } else if (item.ticker === 'CHILE.SN' || item.ticker === 'CHILE') {
            divRate = quote.regularMarketPrice * 0.065; // ~6.5% histórico
            divYield = 0.065;
          } else if (item.ticker === 'SQM-B.SN') {
            divRate = quote.regularMarketPrice * 0.10; // ~10%
            divYield = 0.10;
          }

          let historicalReceived = 0;
          if (item.purchase_date) {
            try {
              const hist = await yahooFinance.historical(item.ticker, {
                period1: item.purchase_date,
                events: 'dividends'
              });
              if (hist && hist.length > 0) {
                historicalReceived = hist.reduce((sum: number, div: any) => {
                  return sum + ((div.dividends || 0) * item.cantidad);
                }, 0);
              }
            } catch (e) {
              console.log(`No historical dividends found for ${item.ticker} since ${item.purchase_date}`);
            }
          }

          const income = divRate * item.cantidad;
          const personalYield = item.precio_compra > 0 ? (divRate / item.precio_compra) : divYield;

          return {
            id: item.id,
            ticker: item.ticker,
            cantidad: item.cantidad,
            precio_compra: item.precio_compra,
            moneda: item.moneda,
            dividendYield: divYield,
            personalYield: personalYield, // Yield on Cost
            dividendRate: divRate,
            projectedAnnualIncome: income,
            historicalReceived: historicalReceived
          };
        } catch (e) {
          console.error(`Error fetching dividend for ${item.ticker}:`, e);
          return {
            id: item.id,
            ticker: item.ticker,
            cantidad: item.cantidad,
            moneda: item.moneda,
            dividendYield: 0,
            dividendRate: 0,
            projectedAnnualIncome: 0
          };
        }
      })
    );

    // Only return items that actually pay dividends
    const payingDividends = dividendData.filter(d => d.dividendRate > 0);
    // Sort by projected income descending
    payingDividends.sort((a, b) => b.projectedAnnualIncome - a.projectedAnnualIncome);

    return NextResponse.json(payingDividends);

  } catch (err: any) {
    console.error('API Dividends Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
