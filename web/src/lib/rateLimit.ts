// Límite simple de solicitudes por IP, en memoria de cada instancia (Node o Edge).
// No es un rate limiter distribuido, pero frena el abuso básico de las rutas que gastan cuota de Gemini.
const hits = new Map<string, number[]>();

export function rateLimit(req: Request, scope: string, limit: number, windowMs = 10 * 60 * 1000): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'anon';
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < windowMs);

  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);

  // Limpieza ocasional para que el mapa no crezca sin límite
  if (hits.size > 5000) {
    for (const [k, times] of hits) {
      if (!times.some(t => now - t < windowMs)) hits.delete(k);
    }
  }
  return true;
}

export const RATE_LIMIT_MESSAGE = 'Demasiadas solicitudes de IA desde tu conexión. Espera unos minutos e intenta de nuevo.';
