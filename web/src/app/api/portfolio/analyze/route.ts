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
  "diagnostico": "Escribe aquí un diagnóstico extenso, muy detallado y brutalmente honesto del portafolio. Analiza la diversificación, riesgos sistémicos, exposición a sectores saturados o prometedores, y sugiere estrategias de rebalanceo de manera institucional. ESTE CAMPO DEBE CONTENER AL MENOS 100 PALABRAS.",
  "recomendaciones": [
    {
      "ticker": "TICKER_AQUI",
      "accion": "🟢 BUY", 
      "stop_loss": "Precio de salida estricto (ej: $100 (-10%))",
      "analisis": "Debes dar un análisis EXTREMADAMENTE DETALLADO Y TÉCNICO. Justifica por qué comprar, mantener o vender. Si se vende, di por qué (ej: sobreexposición, falta de futuro, métricas deterioradas, pérdida de momentum, cambios macroeconómicos). Menciona niveles de soporte/resistencia, fundamentales y catalizadores. MÍNIMO 60 PALABRAS POR ACTIVO."
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
