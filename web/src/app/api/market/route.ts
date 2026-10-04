import { NextResponse } from 'next/server';
import { aiConfigured, generateText } from '@/lib/ai';
import { TICKER_RE } from '@/lib/validation';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { dailyHistory, liveQuotes } from '@/lib/marketData';

// Caché en memoria del resumen de IA por ticker: evita gastar cuota de IA en búsquedas repetidas
const aiCache = new Map<string, { timestamp: number; text: string }>();
const AI_CACHE_TTL = 30 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker')?.trim().toUpperCase();

  if (!ticker || !TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: 'El ticker es obligatorio' }, { status: 400 });
  }
  if (!rateLimit(request, 'market', 60)) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  try {
    // Historial confiable (base del minero para Chile, Yahoo para el resto) y precio en vivo
    const [history, quotes] = await Promise.all([dailyHistory(ticker, 2 * 365), liveQuotes([ticker])]);

    if (!history) {
      return NextResponse.json({ error: 'Ticker no encontrado o sin datos históricos' }, { status: 404 });
    }

    const closes = history.closes;
    if (closes.length < 20) {
      return NextResponse.json({ error: 'No hay suficientes datos históricos (mínimo 20 días)' }, { status: 400 });
    }

    const live = quotes.get(ticker);
    const meta = { symbol: ticker, longName: live?.name, shortName: undefined as string | undefined, currency: live?.currency ?? (ticker.endsWith('.SN') ? 'CLP' : 'USD') };
    const currentPrice = live?.price || closes[closes.length - 1];
    
    // Calculate Bollinger Bands (20 days)
    const last20 = closes.slice(-20);
    const sma20 = last20.reduce((a, b) => a + b, 0) / 20;
    const variance20 = last20.reduce((a, b) => a + Math.pow(b - sma20, 2), 0) / 20;
    const std20 = Math.sqrt(variance20);
    
    const bollingerLower = sma20 - (2 * std20);
    const bollingerUpper = sma20 + (2 * std20);

    // Calculate EMA200
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
      ema200 = closes.reduce((a, b) => a + b, 0) / closes.length;
    }

    // Calculate Volatility (Risk)
    const returns = [];
    for(let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i-1]) / closes[i-1]);
    }
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const returnVariance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / returns.length;
    const dailyVolatility = Math.sqrt(returnVariance);
    const annualizedVolatility = dailyVolatility * Math.sqrt(252);

    let riskLevel = 'MODERADO';
    if (annualizedVolatility > 0.4) riskLevel = 'ALTO';
    if (annualizedVolatility < 0.15) riskLevel = 'BAJO';

    let signal = 'MANTENER';
    if (currentPrice <= bollingerLower) signal = 'COMPRAR';
    else if (currentPrice >= bollingerUpper) signal = 'VENDER';

    // Resumen de IA (Gemini)
    let aiAnalysis = "No hay un proveedor de IA configurado en el servidor, por lo que el análisis de IA está deshabilitado.";
    
    const cachedAi = aiCache.get(ticker);
    if (cachedAi && Date.now() - cachedAi.timestamp < AI_CACHE_TTL) {
      aiAnalysis = cachedAi.text;
    } else if (aiConfigured) {
      try {
        const prompt = `
Eres un analista cuantitativo senior. Haz un resumen ejecutivo (máximo 4 líneas) en ESPAÑOL sobre el activo ${meta.symbol} (${meta.longName || ''}).
Datos actuales:
- Precio: ${currentPrice.toFixed(2)} ${meta.currency}
- Banda Bollinger Inferior (Soporte ideal): ${bollingerLower.toFixed(2)}
- Banda Bollinger Superior (Toma de ganancias): ${bollingerUpper.toFixed(2)}
- EMA 200 (Regresión a la media): ${ema200 ? ema200.toFixed(2) : 'N/A'}
- Nivel de Riesgo (Volatilidad): ${riskLevel}

Dime de forma experta si el activo está sobrecomprado, sobrevendido o en zona de valor, y si recomendarías una entrada a estos precios basado estrictamente en el análisis técnico cuantitativo.
        `;
        aiAnalysis = (await generateText(prompt, { speed: 'fast', timeoutMs: 20000 })).text;
        aiCache.set(ticker, { timestamp: Date.now(), text: aiAnalysis });
      } catch (aiError) {
        console.error("AI Error:", aiError);
        aiAnalysis = "Hubo un error al generar el análisis de IA en este momento.";
      }
    }

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
      currency: meta.currency || 'USD',
      aiAnalysis
    }, aiCache.has(ticker)
      // Con el resumen de IA listo, la CDN comparte la respuesta 15 minutos (ahorra cuota de Gemini)
      ? { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' } }
      : undefined);

  } catch (error) {
    console.error('API Market Error:', error);
    return NextResponse.json({ error: 'Fallo interno al procesar los datos del mercado' }, { status: 500 });
  }
}
