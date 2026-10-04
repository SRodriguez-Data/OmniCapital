import { GoogleGenerativeAI, type GenerateContentRequest } from '@google/generative-ai';

// Modelos centralizados, en orden de preferencia. Si uno está saturado (503) o sin cuota (429),
// se prueba automáticamente el siguiente (la cuota gratuita de Gemini es por modelo).
export const MODELS_QUALITY = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
// Más rápidos, para respuestas largas que deben caber en el límite de 25s de Edge
export const MODELS_FAST = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];

const apiKey = process.env.GEMINI_API_KEY;
export const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isTransient = (error: unknown) =>
  /\[(429|500|503)\b|overloaded|high demand|unavailable|quota|resource.?exhausted/i.test(errorText(error));

export async function generateText(
  request: GenerateContentRequest | string,
  models: string[] = MODELS_QUALITY
): Promise<{ text: string; model: string }> {
  if (!genAI) throw new Error('GEMINI_API_KEY no configurada');
  let lastError: unknown;
  for (const model of models) {
    try {
      const result = await genAI.getGenerativeModel({ model }).generateContent(request);
      return { text: result.response.text(), model };
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) throw error;
      console.warn(`Gemini ${model} no disponible, probando el siguiente modelo:`, errorText(error).slice(0, 200));
    }
  }
  throw lastError;
}

// Traduce los errores de Gemini a algo que el usuario pueda entender (y a un status HTTP útil)
export function aiError(error: unknown): { message: string; status: number } {
  const msg = errorText(error);
  if (/\[429\b|quota|rate limit|resource.?exhausted/i.test(msg)) {
    return { message: 'Se alcanzó el límite de uso de la IA (cuota de Gemini). Intenta de nuevo en unos minutos.', status: 429 };
  }
  if (/\[503\b|overloaded|high demand|unavailable/i.test(msg)) {
    return { message: 'Los modelos de IA de Google están saturados en este momento. Intenta de nuevo en unos minutos.', status: 503 };
  }
  if (/abort|timeout|deadline/i.test(msg)) {
    return { message: 'La IA tardó demasiado en responder. Intenta de nuevo.', status: 504 };
  }
  return { message: 'No se pudo generar el análisis de IA en este momento.', status: 502 };
}
