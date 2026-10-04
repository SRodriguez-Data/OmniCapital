import { GoogleGenerativeAI, type GenerateContentRequest, type ResponseSchema } from '@google/generative-ai';

// Proveedor de respaldo: Gemini. Modelos en orden de preferencia; si uno está saturado (503)
// o sin cuota (429), se prueba el siguiente (la cuota gratuita de Gemini es por modelo).
export const GEMINI_MODELS_QUALITY = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
// Más rápidos, para respuestas largas que deben caber en el límite de Edge
export const GEMINI_MODELS_FAST = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export const geminiConfigured = genAI !== null;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isTransient = (error: unknown) =>
  /\[(429|500|503)\b|overloaded|high demand|unavailable|quota|resource.?exhausted/i.test(errorText(error));

// Gemini usa casi el mismo formato que JSON Schema, pero no acepta additionalProperties
// y marca los enums con format: 'enum'.
export function toGeminiSchema(schema: Record<string, unknown>): ResponseSchema {
  const out: Record<string, unknown> = { type: schema.type };
  if (Array.isArray(schema.enum)) {
    out.enum = schema.enum;
    out.format = 'enum';
  }
  if (schema.items) out.items = toGeminiSchema(schema.items as Record<string, unknown>);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([k, v]) => [k, toGeminiSchema(v)])
    );
  }
  if (schema.required) out.required = schema.required;
  if (schema.description) out.description = schema.description;
  return out as unknown as ResponseSchema;
}

export async function geminiText(
  prompt: string,
  schema: Record<string, unknown> | undefined,
  models: string[],
  signal?: AbortSignal,
): Promise<{ text: string; model: string }> {
  if (!genAI) throw new Error('GEMINI_API_KEY no configurada');

  const request: GenerateContentRequest = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(schema ? { generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) } } : {}),
  };

  let lastError: unknown;
  for (const model of models) {
    if (signal?.aborted) break; // se acabó el tiempo: no seguir gastando cuota en otros modelos
    try {
      const result = await genAI.getGenerativeModel({ model }).generateContent(request, { signal });
      return { text: result.response.text(), model };
    } catch (error) {
      lastError = error;
      if (signal?.aborted || !isTransient(error)) throw error;
      console.warn(`Gemini ${model} no disponible, probando el siguiente modelo:`, errorText(error).slice(0, 200));
    }
  }
  throw lastError ?? new Error('timeout');
}
