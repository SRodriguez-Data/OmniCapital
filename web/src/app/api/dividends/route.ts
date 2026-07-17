import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

export async function GET() {
  try {
    const { data: portfolio, error } = await supabase
      .from('mi_portafolio')
      .select('*');

    if (error) {
      throw error;
    }

    if (!portfolio || portfolio.length === 0) {
      return NextResponse.json([]);
    }

    const dividendData = await Promise.all(
      portfolio.map(async (item) => {
        try {
          const quote = await yahooFinance.quote(item.ticker) as any;
          const divRate = quote.trailingAnnualDividendRate || 0;
          const divYield = quote.trailingAnnualDividendYield || 0;
          
          const income = divRate * item.cantidad;

          return {
            id: item.id,
            ticker: item.ticker,
            cantidad: item.cantidad,
            moneda: item.moneda,
            dividendYield: divYield,
            dividendRate: divRate,
            projectedAnnualIncome: income
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
