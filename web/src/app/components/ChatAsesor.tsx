'use client';

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Loader2, MessageCircle, Send, X } from 'lucide-react';
import type { PerfilInversionista } from '@/lib/perfil';

// Chat con el asesor (POST /api/asesor/chat): le preguntas en tus palabras y responde con los datos de esta pantalla;
// para un monto o una acción en particular, el servidor le pide las cifras al motor. La conversación queda en esta
// pestaña del navegador (no se guarda en ningún servidor).

interface Mensaje { rol: 'usuario' | 'asesor'; texto: string }

const GUARDADO = 'omnicapital_chat_asesor';
const SUGERENCIAS = [
  'Tengo $500.000 extra, ¿qué compro?',
  '¿Por qué estas acciones del Top?',
  '¿Qué pasó hoy con mis empresas?',
  '¿Vendo algo de Chile?',
];

export default function ChatAsesor({ contexto, items, perfil }: { contexto: unknown; items: unknown[]; perfil: PerfilInversionista | null }) {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const m = JSON.parse(sessionStorage.getItem(GUARDADO) ?? '[]');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- la conversación guardada solo existe en el cliente
      if (Array.isArray(m)) setMensajes(m.filter(x => (x?.rol === 'usuario' || x?.rol === 'asesor') && typeof x?.texto === 'string'));
    } catch { /* sin almacenamiento */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(GUARDADO, JSON.stringify(mensajes.slice(-30))); } catch { /* sin almacenamiento */ }
    fin.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensajes, abierto]);

  const enviar = async (pregunta: string) => {
    const q = pregunta.trim();
    if (!q || enviando) return;
    const nuevos: Mensaje[] = [...mensajes, { rol: 'usuario', texto: q }];
    setMensajes(nuevos);
    setTexto('');
    setEnviando(true);
    setError('');
    try {
      const res = await fetch('/api/asesor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: nuevos.slice(-14), contexto, items, perfil }),
      });
      const r = await res.json().catch(() => null);
      if (!res.ok || !r?.texto) throw new Error(r?.error || `El asesor no respondió (error ${res.status}).`);
      setMensajes(m => [...m, { rol: 'asesor', texto: r.texto }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      {!abierto && (
        <button
          onClick={() => setAbierto(true)}
          className="fixed z-40 right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] flex items-center gap-2 rounded-full bg-emerald-500 hover:bg-emerald-400 text-[#09090b] font-bold text-sm px-4 py-3 shadow-lg shadow-emerald-500/30"
        >
          <MessageCircle className="w-5 h-5" /> Pregúntale a tu asesor
        </button>
      )}
      {abierto && (
        <div className="fixed z-50 inset-0 sm:inset-auto sm:right-4 sm:bottom-4 sm:w-[420px] sm:h-[600px] sm:max-h-[85vh] flex flex-col bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] sm:rounded-lg shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-[#27272a]">
            <div>
              <p className="font-bold text-zinc-900 dark:text-[#e4e4e7] flex items-center gap-2"><MessageCircle className="w-4 h-4 text-emerald-500" /> Tu asesor</p>
              <p className="text-[10px] font-mono uppercase text-zinc-500 dark:text-[#71717a]">IA (Gemini) con las cifras del motor</p>
            </div>
            <div className="flex items-center gap-1">
              {mensajes.length > 0 && <button onClick={() => setMensajes([])} className="text-[11px] font-mono uppercase text-zinc-500 hover:text-zinc-900 dark:hover:text-white px-2 py-1">Nueva</button>}
              <button onClick={() => setAbierto(false)} aria-label="Cerrar" className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white"><X className="w-5 h-5" /></button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {!mensajes.length && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-600 dark:text-[#a1a1aa]">Pregúntame lo que quieras de tu plata: qué comprar con un monto, qué opino de una acción, qué pasó con tus empresas o si conviene vender algo.</p>
                <div className="flex flex-col gap-2">
                  {SUGERENCIAS.map(s => (
                    <button key={s} onClick={() => enviar(s)} className="text-left text-sm px-3 py-2 rounded border border-zinc-200 dark:border-[#27272a] text-zinc-700 dark:text-zinc-300 hover:border-emerald-400">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {mensajes.map((m, k) => (
              <div key={k} className={m.rol === 'usuario' ? 'flex justify-end' : ''}>
                <div className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${m.rol === 'usuario' ? 'bg-emerald-500 text-[#09090b]' : 'bg-zinc-100 dark:bg-[#27272a] text-zinc-800 dark:text-zinc-200'}`}>
                  {m.rol === 'usuario' ? m.texto : (
                    <div className="space-y-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:font-bold [&_a]:underline">
                      <ReactMarkdown>{m.texto}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {enviando && <p className="text-xs text-zinc-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Revisando tu cartera y el mercado…</p>}
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div ref={fin} />
          </div>

          <form onSubmit={e => { e.preventDefault(); enviar(texto); }} className="flex items-center gap-2 px-3 py-3 border-t border-zinc-200 dark:border-[#27272a] pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <input
              value={texto} onChange={e => setTexto(e.target.value)} placeholder="Escribe tu pregunta…" maxLength={2000}
              className="flex-1 bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] rounded px-3 py-2 text-sm text-zinc-900 dark:text-[#e4e4e7] focus:outline-none focus:border-emerald-400"
            />
            <button type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar" className="p-2.5 rounded bg-emerald-500 disabled:opacity-40 text-[#09090b]"><Send className="w-4 h-4" /></button>
          </form>
          <p className="px-4 pb-2 text-[10px] text-zinc-400">La IA puede equivocarse: las órdenes exactas son las del plan. Tú ejecutas en tu corredora.</p>
        </div>
      )}
    </>
  );
}
