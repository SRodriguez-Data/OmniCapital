'use client';

import React, { useState } from 'react';
import { UserCheck } from 'lucide-react';
import {
  PREGUNTAS, adecuacion, textoDe, type PerfilInversionista,
} from '@/lib/perfil';

// Cuestionario corto de perfil del inversionista. Las preguntas son las que la cartera no responde por sí sola:
// cuándo se necesita la plata, cuánta caída se aguanta y si hay un colchón aparte.

type Borrador = Partial<Omit<PerfilInversionista, 'aporteMensual'>> & { aporteMensual: string };

const campo = 'w-full bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded px-2.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-[#60a5fa]';

function Pregunta({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{titulo}</span>
      {children}
      {ayuda && <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{ayuda}</span>}
    </label>
  );
}

export function PerfilInversionistaForm({ inicial, guardando, error, onGuardar, onCancelar, textoCancelar }: {
  inicial: PerfilInversionista | null;
  guardando: boolean;
  error: string;
  onGuardar: (p: PerfilInversionista) => void;
  onCancelar: () => void;
  textoCancelar: string;
}) {
  const [b, setB] = useState<Borrador>(() => (inicial
    ? { ...inicial, aporteMensual: inicial.aporteMensual ? String(inicial.aporteMensual) : '' }
    : { aporteMensual: '' }));
  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setB(prev => ({ ...prev, [k]: v }));
  const completo = b.horizonte && b.objetivo && b.reaccionCaida && b.fondoEmergencia && b.experiencia && b.deudaCara !== undefined;
  const perfil: PerfilInversionista | null = completo ? {
    horizonte: b.horizonte!, objetivo: b.objetivo!, reaccionCaida: b.reaccionCaida!, fondoEmergencia: b.fondoEmergencia!,
    experiencia: b.experiencia!, deudaCara: b.deudaCara!,
    aporteMensual: Number(b.aporteMensual.replace(/\D/g, '')) || null,
  } : null;
  const nivel = perfil ? adecuacion(perfil).nivel : null;

  const select = <K extends keyof typeof PREGUNTAS>(k: K) => (
    <select className={campo} value={(b[k] as string | undefined) ?? ''} onChange={e => set(k, e.target.value as Borrador[K])}>
      <option value="" disabled>Elige una opción</option>
      {PREGUNTAS[k].map(o => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
    </select>
  );

  return (
    <div className="max-w-3xl mx-auto border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-lg p-5 space-y-5">
      <div className="flex gap-3">
        <UserCheck className="w-5 h-5 text-[#60a5fa] shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Tu perfil de inversionista</h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
            Una misma cartera puede estar bien para una persona y mal para otra. Seis preguntas para que las recomendaciones
            consideren tu plazo, cuánta caída aguantas y si tienes un respaldo fuera de la bolsa. No pedimos sueldo ni datos personales;
            se guarda en tu cuenta y solo tú lo ves.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Pregunta titulo="1. ¿Cuándo necesitarías este dinero?">{select('horizonte')}</Pregunta>
        <Pregunta titulo="2. ¿Qué buscas con estas inversiones?">{select('objetivo')}</Pregunta>
        <Pregunta titulo="3. Si tu cartera cayera 25% en pocos meses, ¿qué harías?" ayuda="Pasó en 2020 y en 2022: responde lo que harías de verdad.">
          {select('reaccionCaida')}
        </Pregunta>
        <Pregunta titulo="4. ¿Tienes un fondo de emergencia fuera de la bolsa?" ayuda="Ahorro disponible para imprevistos (cuenta de ahorro, depósito, money market).">
          {select('fondoEmergencia')}
        </Pregunta>
        <Pregunta titulo="5. ¿Tienes deudas caras?" ayuda="Tarjetas de crédito, líneas de crédito o créditos de consumo (no cuenta el hipotecario).">
          <select className={campo} value={b.deudaCara === undefined ? '' : b.deudaCara ? 'si' : 'no'} onChange={e => set('deudaCara', e.target.value === 'si')}>
            <option value="" disabled>Elige una opción</option>
            <option value="no">No</option>
            <option value="si">Sí</option>
          </select>
        </Pregunta>
        <Pregunta titulo="6. ¿Cuánta experiencia tienes invirtiendo?">{select('experiencia')}</Pregunta>
        <Pregunta titulo="Opcional: ¿cuánto podrías aportar al mes?" ayuda="En pesos. Sirve para proponerte cómo repartir cada aporte.">
          <input
            className={campo} inputMode="numeric" placeholder="Ej: 100.000"
            value={b.aporteMensual ? Number(b.aporteMensual.replace(/\D/g, '')).toLocaleString('es-CL') : ''}
            onChange={e => set('aporteMensual', e.target.value.replace(/\D/g, '').slice(0, 10))}
          />
        </Pregunta>
      </div>

      {perfil && nivel && (
        <p className="text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded p-3">
          Según tus respuestas, tu perfil es <strong>{nivel}</strong>: {textoDe('horizonte', perfil.horizonte).toLowerCase()} necesitarías el dinero
          y, ante una caída fuerte, {textoDe('reaccionCaida', perfil.reaccionCaida).toLowerCase()}.
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-3 justify-end">
        <button onClick={onCancelar} className="px-4 py-2 rounded text-xs font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
          {textoCancelar}
        </button>
        <button
          onClick={() => perfil && onGuardar(perfil)}
          disabled={!perfil || guardando}
          className="bg-[#60a5fa] hover:bg-[#3b82f6] disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-widest"
        >
          {guardando ? 'Guardando…' : 'Guardar y ver recomendaciones'}
        </button>
      </div>
    </div>
  );
}
