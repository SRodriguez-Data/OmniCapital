'use client';

import React, { useEffect, useState } from 'react';
import { BellOff, BellRing, Loader2, Smartphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { VAPID_PUBLICA } from '@/lib/pushPublica';

// Activa los avisos del asesor en este celular o computador (Web Push): el navegador se suscribe y la suscripción se
// guarda en tu cuenta (POST /api/push); desde ahí el agente diario te avisa directo, sin Telegram. En iPhone el
// navegador solo los permite con la app agregada a la pantalla de inicio.

type Estado = 'revisando' | 'sin_soporte' | 'instalar_ios' | 'inactivo' | 'activo' | 'denegado';

const aBytes = (base64: string) => {
  const b = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
const dispositivo = () => {
  const ua = navigator.userAgent;
  return /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Navegador';
};

export default function AvisosCelular() {
  const [estado, setEstado] = useState<Estado>('revisando');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      const instalada = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setEstado(ios && !instalada ? 'instalar_ios' : 'sin_soporte');
        return;
      }
      if (Notification.permission === 'denied') { setEstado('denegado'); return; }
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.getSubscription();
        setEstado(sub ? 'activo' : 'inactivo');
      } catch {
        setEstado('sin_soporte');
      }
    })();
  }, []);

  const activar = async () => {
    setTrabajando(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Inicia sesión con tu cuenta (no en modo demo ni cartola) para recibir avisos.');
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') { setEstado(permiso === 'denied' ? 'denegado' : 'inactivo'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(VAPID_PUBLICA) });
      const res = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ suscripcion: sub.toJSON(), dispositivo: dispositivo() }),
      });
      const r = await res.json().catch(() => null);
      if (!res.ok || !r?.ok) {
        await sub.unsubscribe().catch(() => {});
        throw new Error(r?.error || `No se pudo activar (error ${res.status}).`);
      }
      setEstado('activo');
      await reg.showNotification('Avisos activados', { body: 'Así te llegará tu asesor: qué comprar cada mes, ventas con evidencia y hechos relevantes de tus empresas.', icon: '/icon-192.png', data: { url: '/?vista=asesor' } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo activar.');
    } finally {
      setTrabajando(false);
    }
  };

  const desactivar = async () => {
    setTrabajando(true);
    setError('');
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        }
        await sub.unsubscribe();
      }
      setEstado('inactivo');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo desactivar.');
    } finally {
      setTrabajando(false);
    }
  };

  if (estado === 'revisando' || estado === 'sin_soporte') return null;
  return (
    <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        {estado === 'activo' ? <BellRing className="w-5 h-5 text-emerald-500 shrink-0" /> : <Smartphone className="w-5 h-5 text-sky-500 shrink-0" />}
        <div className="text-sm">
          <p className="font-bold text-zinc-900 dark:text-[#e4e4e7]">
            {estado === 'activo' ? 'Avisos activos en este dispositivo' : 'Recibe a tu asesor en el celular'}
          </p>
          <p className="text-xs text-zinc-600 dark:text-[#a1a1aa]">
            {estado === 'activo' && 'Te aviso al empezar el mes con qué comprar, cuando cambia el plan, cuando un precio se acerca a un nivel y cuando una de tus empresas informa algo relevante.'}
            {estado === 'inactivo' && 'Notificaciones directas de la app, sin Telegram: qué comprar cada mes, ventas con evidencia y hechos relevantes.'}
            {estado === 'denegado' && 'Bloqueaste las notificaciones de este sitio. Actívalas en los ajustes del navegador y vuelve aquí.'}
            {estado === 'instalar_ios' && 'En iPhone: toca Compartir → "Agregar a inicio", abre OmniCapital desde ese ícono y activa los avisos ahí.'}
          </p>
          {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
        </div>
      </div>
      {estado === 'inactivo' && (
        <button onClick={activar} disabled={trabajando} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-[#09090b] font-bold font-mono uppercase text-xs px-3 py-2 rounded">
          {trabajando ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />} Activar avisos
        </button>
      )}
      {estado === 'activo' && (
        <button onClick={desactivar} disabled={trabajando} className="flex items-center gap-2 text-xs font-mono uppercase text-zinc-500 hover:text-red-500 px-2 py-1">
          {trabajando ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellOff className="w-4 h-4" />} Desactivar
        </button>
      )}
    </div>
  );
}
