import { GEMINI_MODELS_FAST, GEMINI_MODELS_QUALITY, geminiConfigured, geminiText } from './gemini';

// Punto de entrada único de la IA (Gemini, plan gratuito). Cada llamada recorre una cadena de
// modelos: si uno está saturado (503) o sin cuota (429), se prueba el siguiente.

export const aiConfigured = geminiConfigured;

// Subconjunto de JSON Schema para las respuestas estructuradas (se traduce al formato de Gemini)
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  additionalProperties?: boolean;
  description?: string;
}

interface GenerateOptions {
  schema?: JsonSchema;
  // 'fast' (gemini-flash-lite-latest primero) para respuestas que el usuario espera en pantalla;
  // 'quality' (gemini-3.5-flash primero) para razonamiento más cuidadoso
  speed?: 'fast' | 'quality';
}

export async function generateText(
  prompt: string,
  { schema, speed = 'quality' }: GenerateOptions = {}
): Promise<{ text: string; model: string }> {
  if (!geminiConfigured) throw new Error('GEMINI_API_KEY no configurada');
  const models = speed === 'fast' ? GEMINI_MODELS_FAST : GEMINI_MODELS_QUALITY;
  return geminiText(prompt, schema as Record<string, unknown> | undefined, models);
}

// Traduce los errores de Gemini a algo que el usuario entienda, con un status HTTP útil
export function aiError(error: unknown): { message: string; status: number } {
  const msg = error instanceof Error ? error.message : String(error);
  if (/\[429\b|quota|rate limit|resource.?exhausted/i.test(msg)) {
    return { message: 'Se alcanzó el límite de uso de la IA (cuota gratuita de Gemini). Intenta de nuevo en unos minutos.', status: 429 };
  }
  if (/\[503\b|overloaded|high demand|unavailable/i.test(msg)) {
    return { message: 'Los modelos de IA de Google están saturados en este momento. Intenta de nuevo en unos minutos.', status: 503 };
  }
  if (/abort|timeout|deadline/i.test(msg)) {
    return { message: 'La IA tardó demasiado en responder. Intenta de nuevo.', status: 504 };
  }
  return { message: 'No se pudo generar el análisis de IA en este momento.', status: 502 };
}
