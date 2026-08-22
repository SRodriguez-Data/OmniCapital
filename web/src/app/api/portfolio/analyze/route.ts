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

    const prompt = `Eres un sistema quant institucional analizando un portafolio de inversiones recién subido por un usuario.
El valor total estimado es de $${totalValue.toLocaleString('es-CL')} CLP.

Activos en el portafolio:
${portSummary}

Tu tarea es devolver un objeto JSON estricto con el siguiente formato:
{
  "diagnostico": "Párrafo de 3 a 5 líneas con un diagnóstico general del portafolio. Menciona los riesgos, diversificación, sectores predominantes de los tickers que ves, y recomendaciones macro.",
  "recomendaciones": [
    {
      "ticker": "TICKER_AQUI",
      "accion": "🟢 BUY", "🟡 HOLD", o "🔴 SELL",
      "stop_loss": "Precio sugerido como stop loss (ej: $100 (-10%))",
      "analisis": "Párrafo corto de 2 líneas justificando la recomendación para este activo particular."
    }
  ]
}

Responde SOLO con el JSON válido. No incluyas markdown como \`\`\`json. Genera una recomendación para cada activo del portafolio.`;

    const result = await model.generateContent(prompt);
    let text = result.response.text();
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsed = JSON.parse(text);

    return NextResponse.json(parsed);
  } catch (error: any) {
    console.error('Error generating AI analysis:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
