import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Instanciar Google Generative AI
const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export async function POST(req: Request) {
  try {
    if (!genAI) {
      return NextResponse.json(
        { error: 'API Key de Gemini no configurada en el servidor.' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { ticker, price, rsi, ema200, score, pe, div_str, deuda, portfolio } = body;

    if (!ticker) {
      return NextResponse.json(
        { error: 'Falta el Ticker en la solicitud.' },
        { status: 400 }
      );
    }

    // Usar directamente gemini-3.5-flash
    const modelName = 'gemini-3.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });

    const portafolioContext = portfolio ? `El portafolio actual del usuario contiene: [${portfolio}].` : "El usuario no tiene activos en su portafolio aún.";

    // Armar el prompt institucional exacto solicitado
    const prompt = `Actúa como el Director de Estrategia de un Fondo Cuantitativo. Genera una tesis de inversión para la oportunidad detectada en ${ticker}.
${portafolioContext}

Datos obligatorios de ${ticker}: Precio actual: ${price}, RSI: ${rsi}, Distancia EMA200: ${ema200}, P/E Ratio: ${pe}, Dividend Yield: ${div_str}, Deuda/Equity: ${deuda}.

Tu respuesta debe ser quirúrgica y estrictamente en 3 viñetas markdown:
1. 🎯 Catalizador de Valor (Analiza P/E, dividendos y deuda).
2. 📊 Estructura Técnica (Analiza el RSI y la EMA200).
3. 🔗 Sinergia con Portafolio (Analiza OBLIGATORIAMENTE cómo este activo específico (${ticker}) beneficia o diversifica el portafolio actual del usuario. Si el usuario ya lo tiene, explica por qué acumular más es buena idea).`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({ thesis: text });
  } catch (error: any) {
    console.error('Error generando tesis con Gemini:', error);
    return NextResponse.json(
      { error: `Error de la API: ${error.message || 'Error interno'}` },
      { status: 500 }
    );
  }
}
