import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import YahooFinance from 'yahoo-finance2';
import { GoogleGenerativeAI } from '@google/generative-ai';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl || '', supabaseKey || '');

export async function POST(request: Request) {
  try {
    const { budget } = await request.json();

    if (!budget || isNaN(Number(budget)) || Number(budget) <= 0) {
      return NextResponse.json({ error: 'Monto de inversión inválido' }, { status: 400 });
    }

    if (!genAI) {
      return NextResponse.json({ error: 'Falta GEMINI_API_KEY para el optimizador de IA' }, { status: 500 });
    }

    // 1. Obtener portafolio
    const { data: portfolio, error } = await supabase.from('mi_portafolio').select('*');
    if (error) throw error;
    if (!portfolio || portfolio.length === 0) {
      return NextResponse.json({ error: 'El portafolio está vacío' }, { status: 400 });
    }

    // 2. Obtener precios actuales
    const portfolioWithPrices = await Promise.all(
      portfolio.map(async (item) => {
        try {
          const quote = await yahooFinance.quote(item.ticker) as any;
          return {
            ticker: item.ticker,
            cantidad: item.cantidad,
            precioActual: quote.regularMarketPrice,
            moneda: quote.currency || item.moneda
          };
        } catch (e) {
          console.error(`Error fetching price for ${item.ticker}:`, e);
          return {
            ticker: item.ticker,
            cantidad: item.cantidad,
            precioActual: item.precio_compra, // fallback
            moneda: item.moneda
          };
        }
      })
    );

    // 3. Formular prompt para Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const prompt = `
Eres un portfolio manager cuantitativo. 
Tengo el siguiente portafolio de inversiones:
${JSON.stringify(portfolioWithPrices, null, 2)}

Tengo un presupuesto extra de exactamente $${budget} para invertir HOY.
Tu objetivo es sugerirme cuántas acciones (número ENTERO de "sharesToBuy") debo comprar de CADA activo para optimizar y rebalancear mi portafolio hacia un perfil de riesgo moderado/seguro, maximizando la diversificación.

REGLAS ESTRICTAS:
1. "sharesToBuy" debe ser un número entero mayor o igual a 0.
2. El costo total (sharesToBuy * precioActual) de todas las compras sumadas NO DEBE EXCEDER el presupuesto de $${budget}.
3. Si la moneda del activo no es USD, ignora el tipo de cambio y asume que el presupuesto está en la moneda principal de la cuenta, pero intenta distribuir matemáticamente. Para simplificar, asume que todo el budget y los precios están en la misma unidad para este cálculo.
4. Explica en 1 oración el porqué de tu asignación en "rationale".

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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
