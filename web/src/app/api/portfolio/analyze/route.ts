import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

    // Determine model
    let modelName = 'gemini-1.5-flash';
    try {
      const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        const validModel = data.models?.find((m: any) => 
          m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('gemini')
        );
        if (validModel) {
          modelName = validModel.name.replace('models/', '');
        }
      }
    } catch (e) {
      // fallback
    }

    const model = genAI.getGenerativeModel({ model: modelName });

    const portSummary = items.map((i: any) => `- ${i.ticker}: ${i.cantidad} acciones (Costo prom: $${i.precio_compra})`).join('\n');

    const prompt = `Eres un sistema quant institucional de élite analizando un portafolio de inversiones.
El valor total estimado es de $${totalValue.toLocaleString('es-CL')} CLP.

Activos en el portafolio:
${portSummary}

Tu tarea OBLIGATORIA es devolver un objeto JSON estricto con el siguiente formato EXACTO:
{
  "diagnostico": "Diagnóstico macroeconómico y técnico profundo del portafolio. Analiza concentración sectorial, riesgos sistémicos, y sugiere rebalanceo institucional. MÁXIMO 80 PALABRAS.",
  "recomendaciones": [
    {
      "ticker": "TICKER_AQUI",
      "accion": "🟢 BUY", 
      "stop_loss": "Precio de salida estricto (ej: $100 (-10%))",
      "analisis": "Análisis técnico y macroeconómico QUIRÚRGICO. Justifica a fondo integrando leyes, regulaciones, MACD, etc. Ejemplo: 'Vender por riesgo regulatorio y divergencia bajista MACD'. SÉ EXTREMADAMENTE PROFESIONAL PERO CONCISO. MÁXIMO 40 PALABRAS POR ACTIVO."
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
