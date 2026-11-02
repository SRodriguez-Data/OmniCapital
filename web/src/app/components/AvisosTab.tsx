'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, RefreshCw, ShieldAlert, Siren, Target } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';
import { supabase } from '@/lib/supabase';
import { META_CHILE_DEFECTO, PROTECCIONES, parsePerfil, type Proteccion } from '@/lib/perfil';

// Avisos de la cartera: el semáforo de cada mercado, las ganancias que se van y los precios que cambian el plan. Todo
// sale del mismo cálculo que el rebalanceo y el agente de Telegram (POST /api/portfolio/rebalanceo, lib/avisos.ts);
// aquí solo se muestra. Los tipos se repiten para no llevar código de servidor al navegador.

type ClaveMercado = 'eeuu' | 'tecnologia' | 'chile';

interface Semaforo {
  clave: ClaveMercado;
  nombre: string;
  estado: 'verde' | 'rojo';
  fecha: string;
  distancia: number;
  cambiaEn: number;
  distanciaCambio: number;
  desde: string | null;
  caidaDesdeMaximo: number;
}

interface Aviso {
  id: string;
  nivel: 'alerta' | 'atencion' | 'info';
  tipo: 'mercado' | 'ganancia' | 'maximos';
  titulo: string;
  detalle: string;
  queHacer: string;
  evidencia: string | null;
}

interface Respuesta {
  proteccion: Proteccion;
  semaforos: Semaforo[];
  avisos: Aviso[];
  niveles: { ticker: string; tipo: string; texto: string }[];
  refugioCLP: number;
  mediciones: { semaforos: Partial<Record<ClaveMercado, string>>; maximos: string[]; devolucion: string[] };
}

const PERFIL_LOCAL = 'omnicapital_perfil_v1';
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const signo = (x: number) => `${x >= 0 ? '+' : '−'}${pct(Math.abs(x))}`;
const fecha = (iso: string) => iso.split('-').reverse().join('-');
const nivel = (s: Semaforo, x: number) => (s.clave === 'chile'
  ? `$${Math.round(x).toLocaleString('es-CL')}`
  : `${Math.round(x).toLocaleString('es-CL')} puntos`);
const QUE_SIGUE: Record<ClaveMercado, string> = { eeuu: 'el S&P 500', tecnologia: 'el Nasdaq-100', chile: 'el fondo It Now IPSA' };

const tarjeta = 'bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4';
const COLOR_AVISO: Record<Aviso['nivel'], string> = {
  alerta: 'border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/20',
  atencion: 'border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/20',
  info: 'border-zinc-200 dark:border-[#27272a] bg-white dark:bg-[#18181b]',
};
const ETIQUETA: Record<Aviso['nivel'], string> = { alerta: 'Alerta', atencion: 'Atención', info: 'Para saber' };

function Medido({ texto }: { texto: string | null | undefined }) {
  if (!texto) return null;
  return (
    <details className="mt-2 text-[11px] text-zinc-500 dark:text-[#a1a1aa]">
      <summary className="cursor-pointer font-mono uppercase">Lo medido</summary>
      <p className="mt-1 leading-relaxed">{texto}</p>
    </details>
  );
}

function TarjetaSemaforo({ s, medido }: { s: Semaforo; medido?: string }) {
  const rojo = s.estado === 'rojo';
  return (
    <div className={`${tarjeta} ${rojo ? 'border-red-300 dark:border-red-900/60' : ''}`}>
      <div className="flex items-center gap-2">
        <span className={`w-3 h-3 rounded-full shrink-0 ${rojo ? 'bg-red-500' : 'bg-emerald-500'}`} aria-hidden />
        <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 dark:text-[#71717a]">{rojo ? 'Zona roja' : 'Verde'}</p>
      </div>
      <p className="mt-1 font-bold text-zinc-900 dark:text-[#e4e4e7]">{s.nombre}</p>
      <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] mt-1">
        {signo(s.distancia)} frente a su media de 200 días · {pct(s.caidaDesdeMaximo)} bajo su máximo del año
      </p>
      <p className={`text-xs mt-2 font-medium ${rojo ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
        {rojo ? 'Vuelve a verde' : 'Pasa a rojo'} si {QUE_SIGUE[s.clave]} cierra {rojo ? 'sobre' : 'bajo'} {nivel(s, s.cambiaEn)} ({signo(s.distanciaCambio)})
      </p>
      <p className="text-[11px] text-zinc-500 dark:text-[#71717a] mt-1">
        Cierre del {fecha(s.fecha)}{s.desde ? ` · ${rojo ? 'en rojo' : 'en verde'} desde el ${fecha(s.desde)}` : ''}
      </p>
      <Medido texto={medido} />
    </div>
  );
}

export default function AvisosTab({ irAlPlan }: { irAlPlan: () => void }) {
  const { items, loading: cargandoCartera } = usePortfolio();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const calcular = useCallback(async () => {
    if (!items.length) return;
    setCargando(true);
    setError('');
    try {
      // La meta de Chile y la protección de tu perfil, las mismas que usa el agente
      let metaChile = META_CHILE_DEFECTO;
      let proteccion: Proteccion = 'avisar';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const guardado = session
          ? (await supabase.from('perfil_inversionista').select('datos').eq('user_id', session.user.id).maybeSingle()).data?.datos
          : JSON.parse(localStorage.getItem(PERFIL_LOCAL) ?? 'null');
        const perfil = parsePerfil(guardado);
        metaChile = perfil?.metaChile ?? metaChile;
        proteccion = perfil?.proteccion ?? proteccion;
      } catch { /* sin perfil: los valores del asesor */ }
      const res = await fetch('/api/portfolio/rebalanceo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, metaChile, proteccion, fraccionar: true }),
      });
      const r = await res.json().catch(() => null);
      if (!res.ok || !r || r.error) throw new Error(r?.error || `El cálculo no respondió (error ${res.status}). Intenta de nuevo.`);
      setDatos(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setCargando(false);
    }
  }, [items]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- calcula al abrir la pestaña y cuando cambia la cartera
    calcular();
  }, [calcular]);

  const importantes = datos?.avisos.filter(a => a.nivel !== 'info') ?? [];
  const otros = datos?.avisos.filter(a => a.nivel === 'info') ?? [];
  const textoProteccion = PROTECCIONES.find(p => p.valor === datos?.proteccion)?.texto ?? PROTECCIONES[0].texto;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className={`${tarjeta} p-6`}>
        <div className="flex items-start gap-3">
          <Siren className="w-6 h-6 text-[#60a5fa] shrink-0" />
          <div className="flex-1">
            <h2 className="text-lg font-bold tracking-wider uppercase text-zinc-900 dark:text-[#e4e4e7]">Avisos</h2>
            <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] mt-1">
              Lo que conviene mirar antes de que una caída avance. Nadie sabe dónde está el máximo de una acción: estos avisos usan solo reglas
              medidas con décadas de datos. El semáforo dice cuándo un mercado completo cayó bajo su tendencia (la regla que más protegió
              de las caídas grandes); el aviso de ganancia, cuándo una posición devolvió buena parte de lo que llegó a ganar.
            </p>
          </div>
          <button
            onClick={calcular} disabled={cargando || !items.length} aria-label="Actualizar"
            className="p-2 rounded border border-zinc-200 dark:border-[#27272a] text-zinc-500 hover:text-zinc-900 dark:hover:text-[#e4e4e7] disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {!items.length && !cargandoCartera && (
        <p className={`${tarjeta} text-sm text-zinc-600 dark:text-[#a1a1aa]`}>Tu portafolio está vacío: agrega tus activos para ver sus avisos.</p>
      )}
      {cargando && !datos && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /> Revisando mercados y posiciones…</div>
      )}
      {error && <div className="bg-[#f87171]/10 border border-[#f87171]/50 text-[#f87171] p-4 rounded text-sm font-mono">[ERROR] {error}</div>}

      {datos && (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-mono uppercase tracking-widest text-zinc-900 dark:text-[#e4e4e7]">Semáforo de mercados</h3>
            {datos.semaforos.length
              ? <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{datos.semaforos.map(s => <TarjetaSemaforo key={s.clave} s={s} medido={datos.mediciones.semaforos[s.clave]} />)}</div>
              : <p className={`${tarjeta} text-xs text-zinc-600 dark:text-[#a1a1aa]`}>No hay precios al día de los índices para calcular el semáforo. Vuelve a intentar más tarde.</p>}
            <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] flex gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-[#60a5fa]" />
              <span>
                Si un mercado pasa a rojo, te aviso. Tu protección: <strong>{textoProteccion.toLowerCase()}</strong>.
                Se cambia en tu perfil (pestaña Diagnóstico) o en el Optimizador.
              </span>
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-mono uppercase tracking-widest text-zinc-900 dark:text-[#e4e4e7]">Avisos de tu cartera</h3>
            {!importantes.length && (
              <p className={`${tarjeta} text-sm text-zinc-600 dark:text-[#a1a1aa]`}>
                Sin avisos: ningún mercado donde tienes plata está en rojo ni cerca, y ninguna posición devolvió la mitad de su ganancia.
              </p>
            )}
            {[...importantes, ...otros].map(a => (
              <div key={a.id} className={`border rounded p-4 ${COLOR_AVISO[a.nivel]}`}>
                <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-[#71717a]">{ETIQUETA[a.nivel]}</p>
                <p className="font-bold text-zinc-900 dark:text-[#e4e4e7]">{a.titulo}</p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 mt-1">{a.detalle}</p>
                <p className="text-sm text-zinc-900 dark:text-[#e4e4e7] mt-2"><span className="font-semibold">Qué hacer: </span>{a.queHacer}</p>
                <Medido texto={a.evidencia} />
              </div>
            ))}
            {datos.refugioCLP > 0 && (
              <p className="text-xs text-sky-800 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/10 border border-sky-200 dark:border-sky-900/30 rounded p-3">
                Tu plan de hoy deja ${Math.round(datos.refugioCLP).toLocaleString('es-CL')} en refugio (depósito a plazo o fondo money market) hasta que su mercado vuelva a verde.
              </p>
            )}
          </section>

          {datos.niveles.length > 0 && (
            <section className={tarjeta}>
              <p className="text-sm font-mono uppercase tracking-widest text-zinc-900 dark:text-[#e4e4e7] flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-[#60a5fa]" /> Precios que vigilo
              </p>
              <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-[#a1a1aa]">
                {datos.niveles.map(n => <li key={n.ticker + n.tipo}><span className="font-bold text-zinc-900 dark:text-[#e4e4e7]">{n.ticker.replace(/\.SN$/, '')}</span>: {n.texto}</li>)}
              </ul>
            </section>
          )}

          <details className={`${tarjeta} text-xs text-zinc-600 dark:text-[#a1a1aa]`}>
            <summary className="cursor-pointer font-mono uppercase text-zinc-500 dark:text-[#71717a]">¿Por qué no hay un aviso de &quot;llegó al máximo, vende&quot;?</summary>
            <div className="mt-2 space-y-2 leading-relaxed">
              <p>
                Porque se midió y no funciona: una acción en su máximo del año no rindió menos que su mercado después, y una que devolvió la mitad
                de su subida tampoco siguió cayendo más que el resto en EE.UU. Venderlas por eso habría sido adivinar.
              </p>
              {[...datos.mediciones.maximos, ...datos.mediciones.devolucion].map(t => <p key={t}>{t}</p>)}
              <p>
                Lo que sí tiene fundamento para &quot;vender caro&quot;: recortar una posición cuando pasa su peso máximo (sus precios están en
                &quot;Precios que vigilo&quot;) y salir de un mercado cuando su semáforo pasa a rojo.
              </p>
            </div>
          </details>

          <button
            onClick={irAlPlan}
            className="w-full flex items-center justify-center gap-2 bg-[#60a5fa] hover:bg-[#3b82f6] text-[#09090b] px-6 py-4 font-bold font-mono uppercase"
          >
            Ver el plan completo en el Optimizador <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
