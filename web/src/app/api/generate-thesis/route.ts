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
    const { ticker, price, rsi, ema200, score, pe, div_str, deuda } = body;

    if (!ticker) {
      return NextResponse.json(
        { error: 'Falta el Ticker en la solicitud.' },
        { status: 400 }
      );
    }

    // Configurar modelo
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Armar el prompt institucional exacto solicitado
    const prompt = `Actúa como el Director de Estrategia de un Fondo Cuantitativo. Genera una tesis de inversión para ${ticker}. Datos obligatorios a analizar: Precio actual, RSI: ${rsi}, Distancia EMA200: ${ema200}, P/E Ratio: ${pe}, Dividend Yield: ${div_str}, Deuda/Equity: ${deuda}. Tu respuesta debe ser quirúrgica y en 3 viñetas markdown: 🎯 Catalizador de Valor (Analiza obligatoriamente el P/E, dividendos y deuda provistos), 📊 Estructura Técnica (Analiza el RSI y EMA), y ⚠️ Riesgo Asimétrico.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({ thesis: text });
  } catch (error: any) {
    console.error('Error generando tesis con Gemini:', error);
    return NextResponse.json(
      { error: 'Error interno generando la tesis de inversión.' },
      { status: 500 }
    );
  }
}
