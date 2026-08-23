import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'edge';

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export async function POST(req: Request) {
  try {
    if (!genAI) {
      return NextResponse.json({ error: 'API Key de Gemini no configurada.' }, { status: 500 });
    }

    const { items, totalValue } = await req.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Portafolio vacío.' }, { status: 400 });
    }

    // Usar el modelo LITE más rápido para evitar que tarde "100 años" en generar los 11 análisis profundos
    const modelName = 'gemini-flash-lite-latest';
    const model = genAI.getGenerativeModel({ model: modelName });

    const portSummary = items.map((i: any) => `- ${i.ticker}: ${i.cantidad} acciones (Costo prom: $${i.precio_compra})`).join('\n');

    const prompt = `Eres un sistema quant institucional de élite analizando un portafolio de inversiones.
El valor total estimado es de $${totalValue.toLocaleString('es-CL')} CLP.

Activos en el portafolio:
${portSummary}

Tu tarea OBLIGATORIA es devolver un objeto JSON estricto con el siguiente formato EXACTO:
{
  "diagnostico": "Diagnóstico macroeconómico y técnico PROFUNDO del portafolio. Analiza concentración sectorial, riesgos sistémicos (tasas, inflación), diversificación de divisas y sugiere estrategias institucionales de cobertura. EXPRÉSATE COMO UN ECONOMISTA JEFE. MÁXIMO 100 PALABRAS.",
  "recomendaciones": [
    {
      "ticker": "TICKER_AQUI",
      "accion": "🟢 BUY", 
      "stop_loss": "Precio de salida estricto (ej: $100 (-10%))",
      "analisis": "Análisis técnico y macroeconómico QUIRÚRGICO Y EXTENSO. Justifica a fondo tu recomendación integrando impacto de nuevas leyes, regulaciones, cambios de tasas, y análisis técnico (soportes, resistencias, RSI, MACD). DEBE SER DETALLADO, mínimo 40 palabras, máximo 70 palabras."
    }
  ]
}

REGLAS ESTRICTAS:
1. Genera una recomendación para CADA activo listado arriba.
2. Jamás dejes el campo diagnostico vacío ni corto.`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      }
    });
    
    let text = result.response.text();
    // Limpieza de seguridad por si acaso
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.error("Gemini JSON Parse Error:", text);
      throw new Error("El modelo generó un JSON inválido.");
    }

    return NextResponse.json(parsed);
  } catch (error: any) {
    console.error('Error generating AI analysis:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
