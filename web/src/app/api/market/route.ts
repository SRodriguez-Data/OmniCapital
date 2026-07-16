import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini only if key exists (don't break the build if missing, we just return no AI)
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return NextResponse.json({ error: 'El ticker es obligatorio' }, { status: 400 });
  }

  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2y`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      next: { revalidate: 60 } // Cache for 60 seconds
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Fallo al obtener datos de Yahoo Finance' }, { status: 502 });
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (!result || !result.indicators?.quote?.[0]?.close) {
      return NextResponse.json({ error: 'Ticker no encontrado o sin datos históricos' }, { status: 404 });
    }

    const rawCloses = result.indicators.quote[0].close as (number | null)[];
    const closes = rawCloses.filter((c): c is number => c !== null);

    if (closes.length < 20) {
      return NextResponse.json({ error: 'No hay suficientes datos históricos (mínimo 20 días)' }, { status: 400 });
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

    // Gemini AI Analysis (if API key is present)
    let aiAnalysis = "No se ha configurado la API Key de Gemini en Vercel, por lo que el análisis de IA está deshabilitado.";
    
    if (genAI) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
        const aiResponse = await model.generateContent(prompt);
        aiAnalysis = aiResponse.response.text();
      } catch (aiError) {
        console.error("Gemini AI Error:", aiError);
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
    });

  } catch (error) {
    console.error('API Market Error:', error);
    return NextResponse.json({ error: 'Fallo interno al procesar los datos del mercado' }, { status: 500 });
  }
}
