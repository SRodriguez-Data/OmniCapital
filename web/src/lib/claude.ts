import Anthropic from '@anthropic-ai/sdk';

// Proveedor principal de IA: Claude (Anthropic). Funciona en Node y en Edge.
export const CLAUDE_MODEL = 'claude-opus-5-5';

export type ClaudeEffort = 'low' | 'medium' | 'high';

// Solo se activa si hay clave: sin ANTHROPIC_API_KEY la app usa Gemini directamente
const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ maxRetries: 1, timeout: 120_000 })
  : null;

export const claudeConfigured = client !== null;

export class ClaudeRefusalError extends Error {
  constructor(category: string | null | undefined) {
    super(`Claude declinó la solicitud (categoría: ${category ?? 'sin categoría'})`);
    this.name = 'ClaudeRefusalError';
  }
}

interface ClaudeRequest {
  prompt: string;
  // JSON Schema: obliga a Claude a responder exactamente con esa forma
  schema?: Record<string, unknown>;
  // En Claude Opus 5.5 el razonamiento siempre está activo; effort controla cuánto piensa (y la latencia)
  effort: ClaudeEffort;
  maxTokens: number;
}

export async function claudeText({ prompt, schema, effort, maxTokens }: ClaudeRequest): Promise<string> {
  if (!client) throw new Error('ANTHROPIC_API_KEY no configurada');

  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    // Si un clasificador de seguridad declina por error, Anthropic reintenta en el modelo recomendado
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort,
      ...(schema ? { format: { type: 'json_schema' as const, schema } } : {}),
    },
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new ClaudeRefusalError(response.stop_details?.category);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('La respuesta de Claude se cortó por max_tokens');
  }

  // La respuesta puede traer bloques de razonamiento antes del texto: leer por tipo, no por posición
  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');
  if (!text.trim()) throw new Error('Claude devolvió una respuesta vacía');
  return text;
}
