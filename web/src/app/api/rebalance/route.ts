import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import YahooFinance from 'yahoo-finance2';
import { GoogleGenerativeAI } from '@google/generative-ai';

const yahooFinance = new YahooFinance();

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl || '', supabaseKey || '');

export async function POST(request: Request) {
  try {
    const { budget, items } = await request.json();

    if (!budget || isNaN(Number(budget)) || Number(budget) <= 0) {
      return NextResponse.json({ error: 'Monto de inversión inválido' }, { status: 400 });
    }

    if (!genAI) {
      return NextResponse.json({ error: 'Falta GEMINI_API_KEY para el optimizador de IA' }, { status: 500 });
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'El portafolio está vacío' }, { status: 400 });
    }

    // 2. Obtener Top 5 Oportunidades Externas
    const { data: iaData } = await supabase
      .from('analisis_ia')
      .select('candidatos_json')
      .order('fecha', { ascending: false })
      .limit(1);
    
    let externalOpportunities: any[] = [];
    if (iaData && iaData.length > 0 && iaData[0].candidatos_json) {
      const us = iaData[0].candidatos_json.us || [];
      const cl = iaData[0].candidatos_json.cl || [];
      const combined = [...us, ...cl];
      
      const sorted = combined.sort((a: any, b: any) => b.score - a.score).slice(0, 5);
      
      externalOpportunities = sorted.map((c: any) => ({
        ticker: c.ticker,
        precio_entrada_ideal: c.bollinger_lower ? c.bollinger_lower : c.price,
        score: c.score,
        rsi: c.rsi
      }));
    }
    const portfolioWithPrices = await Promise.all(
      items.map(async (item: any) => {
        try {
          const quote = await yahooFinance.quote(item.ticker) as any;
          return {
            ticker: item.ticker,
            cantidad: item.cantidad,
            precioActual: quote.regularMarketPrice,
            moneda: quote.currency || item.moneda
          };
        } catch (e) {
          return {
            ticker: item.ticker,
            cantidad: item.cantidad,
            precioActual: item.precio_compra,
            moneda: item.moneda
          };
        }
      })
    );

    // 4. Formular prompt para Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });
    
    const prompt = `
Eres un portfolio manager cuantitativo. 
Tengo el siguiente portafolio ACTUAL de inversiones:
${JSON.stringify(portfolioWithPrices, null, 2)}

Y el mercado (tu modelo de IA interno) acaba de detectar estas 5 OPORTUNIDADES EXTERNAS (que actualmente NO tengo o podría tener):
${JSON.stringify(externalOpportunities, null, 2)}

Tengo un presupuesto extra de exactamente $${budget} para invertir HOY.
Tu objetivo es sugerirme cuántas acciones (número ENTERO de "sharesToBuy") debo comprar. 
DEBES ACTUAR COMO UN GESTOR AGRESIVO: Evalúa las OPORTUNIDADES EXTERNAS. Si detectas que a mi portafolio le falta exposición en ciertos sectores o países, PRIORIZA INYECTAR PARTE DEL PRESUPUESTO EN ESTAS NUEVAS OPORTUNIDADES EXTERNAS. No te limites a comprar más de lo que ya tengo.
Explica en "rationale" por qué estás inyectando esta nueva acción (ej: 'Añadimos esta oportunidad top del mercado para diversificar exposición geográfica').

REGLAS ESTRICTAS:
1. "sharesToBuy" debe ser un número entero mayor o igual a 0.
2. El costo total (sharesToBuy * precioActual) de todas las compras sumadas NO DEBE EXCEDER el presupuesto de $${budget}.
3. PROHIBICIÓN ABSOLUTA: SOLO puedes recomendar tickers que existan en MI PORTAFOLIO ACTUAL o en las OPORTUNIDADES EXTERNAS provistas. NO inventes ningún otro ticker.
4. Si la moneda del activo no es USD, asume que el presupuesto está en la moneda principal y distribuye matemáticamente.
5. Explica detalladamente en "rationale" por qué elegiste este activo. Si es una oportunidad externa, explica por qué es mejor añadirla que comprar más de lo que ya tengo.
6. Para calcular los costos de oportunidades externas, usa el "precio_entrada_ideal".

Responde ÚNICAMENTE con un JSON Array válido con esta estructura estricta, sin markdown ni texto adicional:
[
  {
    "ticker": "AAPL",
    "sharesToBuy": 2,
    "expectedCost": 300.50,
    "rationale": "Aumentamos peso en tecnología de gran capitalización."
  }
]
`;

    const aiResponse = await model.generateContent(prompt);
    let jsonStr = aiResponse.response.text().trim();
    
    // Limpiar markdown si Gemini lo incluye a pesar de la instrucción
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
    }

    let recommendations = [];
    try {
      recommendations = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error("Failed to parse Gemini JSON:", jsonStr);
      return NextResponse.json({ error: 'La IA devolvió un formato inválido' }, { status: 500 });
    }

    return NextResponse.json({ recommendations });

  } catch (err: any) {
    console.error('API Rebalance Error:', err);
    return NextResponse.json({ error: err.message || 'Error desconocido' }, { status: 500 });
  }
}
