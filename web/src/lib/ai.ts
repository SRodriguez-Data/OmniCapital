import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, claudeConfigured, claudeText, ClaudeRefusalError, type ClaudeEffort } from './claude';
import { GEMINI_MODELS_FAST, GEMINI_MODELS_QUALITY, geminiConfigured, geminiText } from './gemini';

// Orquestador de IA: Claude es el proveedor principal y Gemini el respaldo.
// Si Claude no está configurado o falla (cuota, saturación, rechazo, error de red), se usa Gemini.

export const aiConfigured = claudeConfigured || geminiConfigured;

// Subconjunto de JSON Schema que entienden ambos proveedores
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
  // 'fast' para respuestas que el usuario espera en pantalla; 'quality' para razonamiento más cuidadoso
  speed?: 'fast' | 'quality';
  maxTokens?: number;
}

export async function generateText(
  prompt: string,
  { schema, speed = 'quality', maxTokens = 16000 }: GenerateOptions = {}
): Promise<{ text: string; model: string; provider: 'claude' | 'gemini' }> {
  let claudeError: unknown;

  if (claudeConfigured) {
    const effort: ClaudeEffort = speed === 'fast' ? 'low' : 'medium';
    try {
      const text = await claudeText({ prompt, schema: schema as Record<string, unknown> | undefined, effort, maxTokens });
      return { text, model: CLAUDE_MODEL, provider: 'claude' };
    } catch (error) {
      claudeError = error;
      console.warn('Claude no disponible, usando Gemini como respaldo:', describe(error));
    }
  }

  if (geminiConfigured) {
    const models = speed === 'fast' ? GEMINI_MODELS_FAST : GEMINI_MODELS_QUALITY;
    const { text, model } = await geminiText(prompt, schema as Record<string, unknown> | undefined, models);
    return { text, model, provider: 'gemini' };
  }

  throw claudeError ?? new Error('No hay proveedor de IA configurado (ANTHROPIC_API_KEY o GEMINI_API_KEY)');
}

function describe(error: unknown): string {
  // Los errores del SDK de Anthropic ya incluyen el status HTTP en el mensaje
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 200);
}

// Traduce el error final (de Claude o de Gemini) a algo que el usuario entienda, con un status HTTP útil
export function aiError(error: unknown): { message: string; status: number } {
  const quota = { message: 'Se alcanzó el límite de uso de la IA. Intenta de nuevo en unos minutos.', status: 429 };
  const busy = { message: 'Los modelos de IA están saturados en este momento. Intenta de nuevo en unos minutos.', status: 503 };
  const slow = { message: 'La IA tardó demasiado en responder. Intenta de nuevo.', status: 504 };

  if (error instanceof ClaudeRefusalError) {
    return { message: 'La IA no pudo procesar esta solicitud. Intenta de nuevo o ajusta el portafolio.', status: 502 };
  }
  if (error instanceof Anthropic.RateLimitError) return quota;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return slow;
  if (error instanceof Anthropic.InternalServerError) return busy; // incluye 529 overloaded
  if (error instanceof Anthropic.AuthenticationError) {
    return { message: 'La clave de Anthropic no es válida. Revisa ANTHROPIC_API_KEY.', status: 502 };
  }

  // Errores de Gemini: el SDK solo expone el mensaje
  const msg = error instanceof Error ? error.message : String(error);
  if (/\[429\b|quota|rate limit|resource.?exhausted/i.test(msg)) return quota;
  if (/\[503\b|overloaded|high demand|unavailable/i.test(msg)) return busy;
  if (/abort|timeout|deadline/i.test(msg)) return slow;
  return { message: 'No se pudo generar el análisis de IA en este momento.', status: 502 };
}
