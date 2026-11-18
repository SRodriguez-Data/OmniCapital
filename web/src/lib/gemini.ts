import { GoogleGenerativeAI, type Content, type FunctionDeclaration, type GenerateContentRequest, type ResponseSchema } from '@google/generative-ai';

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

// Cuando Gemini está saturado, un modelo puede tardar minutos en contestar (o en devolver su 503), y la ruta tiene 50
// segundos: cada llamada a un modelo que no es el último tiene este tope, y si se pasa se prueba el siguiente. El
// último usa lo que quede del tiempo de quien llama
export const ESPERA_POR_MODELO_MS = 15_000;

class ModeloLento extends Error {
  constructor(model: string) { super(`${model} no respondió en ${ESPERA_POR_MODELO_MS / 1000} s`); }
}

/** Llama a `fn` con una señal que se corta al acabarse el tiempo de quien llama o, si `tope`, a los
 *  ESPERA_POR_MODELO_MS. Un corte por el tope sale como ModeloLento (se prueba otro modelo). */
async function conTope<T>(model: string, tope: boolean, signal: AbortSignal | undefined, fn: (s: AbortSignal) => Promise<T>): Promise<T> {
  const control = new AbortController();
  const alAbortar = () => control.abort(signal?.reason);
  if (signal?.aborted) control.abort(signal.reason);
  signal?.addEventListener('abort', alAbortar, { once: true });
  let vencio = false;
  const timer = tope ? setTimeout(() => { vencio = true; control.abort(new ModeloLento(model)); }, ESPERA_POR_MODELO_MS) : null;
  try {
    return await fn(control.signal);
  } catch (error) {
    if (vencio && !signal?.aborted) throw new ModeloLento(model);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', alAbortar);
  }
}
const sePruebaOtro = (error: unknown) => error instanceof ModeloLento || isTransient(error);

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
  for (const [k, model] of models.entries()) {
    if (signal?.aborted) break; // se acabó el tiempo: no seguir gastando cuota en otros modelos
    try {
      const result = await conTope(model, k < models.length - 1, signal, s => genAI.getGenerativeModel({ model }).generateContent(request, { signal: s }));
      return { text: result.response.text(), model };
    } catch (error) {
      lastError = error;
      if (signal?.aborted || !sePruebaOtro(error)) throw error;
      console.warn(`Gemini ${model} no disponible, probando el siguiente modelo:`, errorText(error).slice(0, 200));
    }
  }
  throw lastError ?? new Error('timeout');
}

export interface HerramientaChat {
  declaracion: FunctionDeclaration;
  ejecutar: (args: Record<string, unknown>) => Promise<unknown>;
}

// Conversación con herramientas: el modelo puede pedir datos al motor (por ejemplo, el plan para un monto) y responde
// con lo que este devuelve. Hasta 3 rondas de herramientas por respuesta.
export async function geminiChat(
  sistema: string,
  historial: Content[],
  herramientas: HerramientaChat[],
  models: string[],
  signal?: AbortSignal,
): Promise<{ text: string; model: string; usadas: string[]; resultados: unknown[] }> {
  if (!genAI) throw new Error('GEMINI_API_KEY no configurada');
  const porNombre = new Map(herramientas.map(h => [h.declaracion.name, h]));
  let lastError: unknown;
  for (const [k, model] of models.entries()) {
    if (signal?.aborted) break;
    const usadas: string[] = [];
    // Lo que devolvió cada herramienta: quien llama puede contrastar la respuesta con estos datos
    const resultados: unknown[] = [];
    try {
      const m = genAI.getGenerativeModel({
        model,
        systemInstruction: sistema,
        ...(herramientas.length ? { tools: [{ functionDeclarations: herramientas.map(h => h.declaracion) }] } : {}),
        generationConfig: { temperature: 0.4, maxOutputTokens: 1500 },
      });
      const contents: Content[] = [...historial];
      for (let ronda = 0; ronda < 4; ronda++) {
        // El tope es por llamada al modelo: no cuenta el tiempo de las herramientas (el motor calcula el plan)
        const r = await conTope(model, k < models.length - 1, signal, s => m.generateContent({ contents }, { signal: s }));
        const llamadas = r.response.functionCalls() ?? [];
        if (!llamadas.length || ronda === 3) return { text: r.response.text(), model, usadas, resultados };
        // El turno del modelo va tal cual: los modelos nuevos exigen recibir de vuelta su firma de razonamiento
        const turno = r.response.candidates?.[0]?.content;
        contents.push(turno?.parts?.length ? { role: 'model', parts: turno.parts } : { role: 'model', parts: llamadas.map(c => ({ functionCall: c })) });
        const respuestas = await Promise.all(llamadas.map(async c => {
          usadas.push(c.name);
          const h = porNombre.get(c.name);
          const resultado = h
            ? await h.ejecutar((c.args ?? {}) as Record<string, unknown>).catch(e => ({ error: e instanceof Error ? e.message : String(e) }))
            : { error: 'Herramienta desconocida.' };
          resultados.push(resultado);
          return { functionResponse: { name: c.name, response: { resultado } } };
        }));
        contents.push({ role: 'user', parts: respuestas });
      }
    } catch (error) {
      lastError = error;
      if (signal?.aborted || !sePruebaOtro(error)) throw error;
      console.warn(`Gemini ${model} no disponible, probando el siguiente modelo:`, errorText(error).slice(0, 200));
    }
  }
  throw lastError ?? new Error('timeout');
}
