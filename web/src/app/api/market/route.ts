import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
  }

  try {
    const today = new Date();
    // Fetch last 300 days of data to guarantee 200 trading days for EMA200
    const period1 = new Date(today.getTime() - 300 * 24 * 60 * 60 * 1000); 
    
    const queryOptions = {
      period1,
      period2: today,
      interval: '1d' as const
    };

    const historical = await yahooFinance.historical(ticker, queryOptions);
    const quote = await yahooFinance.quote(ticker);

    if (!historical || historical.length < 20) {
      return NextResponse.json({ error: 'Not enough historical data' }, { status: 404 });
    }

    const closes = historical.map(h => h.close).filter(c => c !== null);
    
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

    const currentPrice = quote.regularMarketPrice || closes[closes.length - 1];

    let signal = 'HOLD';
    if (currentPrice <= bollingerLower) signal = 'BUY';
    else if (currentPrice >= bollingerUpper) signal = 'SELL';

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      currentPrice,
      bollingerLower,
      bollingerUpper,
      ema200,
      volatility: annualizedVolatility,
      riskLevel,
      signal,
      name: quote.longName || quote.shortName || ticker,
      currency: quote.currency || 'USD'
    });

  } catch (error) {
    console.error('API Market Error:', error);
    return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 500 });
  }
}
