// Notificaciones al celular (Web Push, gratis): el navegador se suscribe con la llave pública de la app y el agente
// diario envía cada aviso firmado con la privada (VAPID_PRIVATE_KEY, solo en GitHub Actions y en tu .env). Las
// suscripciones viven en la tabla push_suscripciones (supabase/push_suscripciones.sql).

import { VAPID_PUBLICA } from './pushPublica';

export interface Suscripcion {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface AvisoPush {
  titulo: string;
  cuerpo: string;
  url?: string;
  etiqueta?: string;
}

/** Valida lo que llega del navegador (PushSubscription.toJSON()). */
export function leerSuscripcion(x: unknown): Suscripcion | { error: string } {
  const s = x as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = typeof s?.endpoint === 'string' ? s.endpoint : '';
  if (!/^https:\/\/[^\s]{10,900}$/.test(endpoint)) return { error: 'Suscripción inválida.' };
  const p256dh = typeof s?.keys?.p256dh === 'string' ? s.keys.p256dh : '';
  const auth = typeof s?.keys?.auth === 'string' ? s.keys.auth : '';
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(auth)) return { error: 'Suscripción inválida.' };
  return { endpoint, p256dh, auth };
}

/** Envía un aviso a cada suscripción. Devuelve cuántos llegaron y los endpoints que el navegador dio de baja (404/410). */
export async function enviarPush(subs: Suscripcion[], aviso: AvisoPush, privada: string, contacto: string): Promise<{ enviados: number; vencidas: string[] }> {
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(`mailto:${contacto}`, VAPID_PUBLICA, privada);
  const cuerpo = JSON.stringify({ ...aviso, cuerpo: aviso.cuerpo.slice(0, 600) });
  let enviados = 0;
  const vencidas: string[] = [];
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, cuerpo, { TTL: 24 * 3600, urgency: 'high' });
      enviados++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) vencidas.push(s.endpoint);
    }
  }));
  return { enviados, vencidas };
}
