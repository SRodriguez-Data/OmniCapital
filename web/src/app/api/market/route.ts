import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
  }

  try {
    // We use the Yahoo Finance v8 chart API directly to avoid npm package build issues in Vercel
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2y`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      next: { revalidate: 60 } // Cache for 60 seconds
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch market data from Yahoo Finance' }, { status: 502 });
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (!result || !result.indicators?.quote?.[0]?.close) {
      return NextResponse.json({ error: 'Ticker not found or no historical data' }, { status: 404 });
    }

    // Filter out nulls from the close array (Yahoo sometimes returns null for holidays)
    const rawCloses = result.indicators.quote[0].close as (number | null)[];
    const closes = rawCloses.filter((c): c is number => c !== null);

    if (closes.length < 20) {
      return NextResponse.json({ error: 'Not enough historical data (minimum 20 days required)' }, { status: 400 });
    }

    const meta = result.meta;
    const currentPrice = meta.regularMarketPrice || closes[closes.length - 1];
    
    // Calculate Bollinger Bands (20 days)
    const last20 = closes.slice(-20);
    const sma20 = last20.reduce((a, b) => a + b, 0) / 20;
    const variance20 = last20.reduce((a, b) => a + Math.pow(b - sma20, 2), 0) / 20;
    const std20 = Math.sqrt(variance20);
    
    const bollingerLower = sma20 - (2 * std20);
    const bollingerUpper = sma20 + (2 * std20);

    // Calculate EMA200
    // Simple EMA starting with SMA of first 200 days if available
    let ema200 = null;
    if (closes.length >= 200) {
      const smoothing = 2 / (200 + 1);
      const first200 = closes.slice(0, 200);
      let prevEma = first200.reduce((a, b) => a + b, 0) / 200;
      
      for (let i = 200; i < closes.length; i++) {
        prevEma = (closes[i] * smoothing) + (prevEma * (1 - smoothing));
      }
      ema200 = prevEma;
    } else {
      // Fallback to SMA if less than 200 days available
      ema200 = closes.reduce((a, b) => a + b, 0) / closes.length;
    }

    // Calculate Volatility (Risk) - Annualized
    const returns = [];
    for(let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i-1]) / closes[i-1]);
    }
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const returnVariance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / returns.length;
    const dailyVolatility = Math.sqrt(returnVariance);
    const annualizedVolatility = dailyVolatility * Math.sqrt(252);

    let riskLevel = 'MODERATE';
    if (annualizedVolatility > 0.4) riskLevel = 'HIGH';
    if (annualizedVolatility < 0.15) riskLevel = 'LOW';

    let signal = 'HOLD';
    if (currentPrice <= bollingerLower) signal = 'BUY';
    else if (currentPrice >= bollingerUpper) signal = 'SELL';

    return NextResponse.json({
      ticker: meta.symbol || ticker.toUpperCase(),
      currentPrice,
      bollingerLower,
      bollingerUpper,
      ema200,
      volatility: annualizedVolatility,
      riskLevel,
      signal,
      name: meta.longName || meta.shortName || meta.symbol || ticker,
      currency: meta.currency || 'USD'
    });

  } catch (error) {
    console.error('API Market Error:', error);
    return NextResponse.json({ error: 'Failed to process market data' }, { status: 500 });
  }
}
