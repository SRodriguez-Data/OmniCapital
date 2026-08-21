import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { items, usdClpRate } = await request.json();
    
    if (!items || items.length === 0) {
      return NextResponse.json([]);
    }

    const tickers = Array.from(new Set(items.map((i: any) => String(i.ticker)))) as string[];
    
    const { data: historyData, error } = await supabase
      .from('precios_historicos')
      .select('ticker, date, close')
      .in('ticker', tickers)
      .order('date', { ascending: true });

    if (error) {
      console.error("Error fetching global history:", error);
      return NextResponse.json([]);
    }

    const pricesByDate: Record<string, Record<string, number>> = {};
    const allDates = new Set<string>();

    for (const row of historyData || []) {
      const d = row.date.split('T')[0];
      allDates.add(d);
      if (!pricesByDate[d]) pricesByDate[d] = {};
      pricesByDate[d][row.ticker] = row.close;
    }

    const sortedDates = Array.from(allDates).sort();
    if (sortedDates.length === 0) {
      return NextResponse.json([]);
    }

    const lastKnownPrice: Record<string, number> = {};
    for (const date of sortedDates) {
      for (const ticker of tickers) {
        if (pricesByDate[date][ticker] !== undefined) {
          lastKnownPrice[ticker] = pricesByDate[date][ticker];
        } else if (lastKnownPrice[ticker] !== undefined) {
          pricesByDate[date][ticker] = lastKnownPrice[ticker];
        }
      }
    }

    const portfolioHistory = [];
    for (const date of sortedDates) {
      let totalValueCLP = 0;
      
      for (const item of items) {
        if (item.purchase_date && item.purchase_date > date) {
          continue;
        }

        const price = pricesByDate[date][item.ticker] || item.precio_compra;
        const rate = item.moneda === 'CLP' ? 1 : (usdClpRate || 930);
        totalValueCLP += item.cantidad * price * rate;
      }

      if (totalValueCLP > 0) {
        portfolioHistory.push({
          date,
          totalValue: totalValueCLP
        });
      }
    }

    return NextResponse.json(portfolioHistory);
  } catch (error) {
    console.error('Error in global history:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
