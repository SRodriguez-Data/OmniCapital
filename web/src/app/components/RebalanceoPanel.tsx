'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, BellRing, Loader2, Scale, Target } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';
import { supabase } from '@/lib/supabase';
import { METAS_CHILE, META_CHILE_DEFECTO, parsePerfil } from '@/lib/perfil';

// Rebalanceo completo (vender y comprar). El cálculo es el de lib/rebalanceo.ts, el mismo que usa el agente que avisa
// por Telegram; aquí solo se muestra. Los tipos se repiten para no llevar código de servidor al navegador.

interface Orden {
  ticker: string;
  nombre?: string;
  lado: 'VENDER' | 'COMPRAR';
  origen: 'EN_CARTERA' | 'OPORTUNIDAD';
  moneda: 'USD' | 'CLP';
  cantidad: number;
  todo: boolean;
  precio: number;
  limite: number;
  montoCLP: number;
  pesoAntes: number;
  pesoDespues: number;
  motivo: string;
}

interface Plan {
  valorCLP: number;
  metaChile: number;
  ventas: Orden[];
  compras: Orden[];
  ventasCLP: number;
  comprasCLP: number;
  aporteCLP: number;
  sinInvertirCLP: number;
  motivoSinInvertir: string | null;
  antes: { chile: number; sector: { nombre: string; peso: number } | null };
  despues: { chile: number; sector: { nombre: string; peso: number } | null };
  niveles: { ticker: string; tipo: 'venta_tendencia' | 'recorte_concentracion'; texto: string }[];
  excluidosCompra: { ticker: string; motivo: string }[];
  notas: string[];
}

const PERFIL_LOCAL = 'omnicapital_perfil_v1';
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const precio = (n: number, moneda: 'USD' | 'CLP') => moneda === 'CLP'
  ? `$${n.toLocaleString('es-CL', { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`
  : `US$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cantidad = (o: Orden) => o.cantidad.toLocaleString('es-CL', { maximumFractionDigits: 4 });
const sinSufijo = (t: string) => t.replace(/\.SN$/, '');

const campo = 'w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] text-zinc-900 dark:text-[#e4e4e7] p-3 font-mono focus:outline-none focus:border-[#60a5fa]';

function TablaOrdenes({ titulo, ordenes, icono }: { titulo: string; ordenes: Orden[]; icono: React.ReactNode }) {
  if (!ordenes.length) return null;
  const venta = ordenes[0].lado === 'VENDER';
  return (
    <div className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-[#27272a] bg-white dark:bg-[#18181b]">
        <h3 className="text-sm font-mono text-zinc-900 dark:text-[#e4e4e7] uppercase tracking-widest flex items-center gap-2">{icono}{titulo}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm font-sans">
          <thead className="bg-white dark:bg-[#18181b] text-zinc-500 dark:text-[#71717a] font-mono text-xs uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Activo</th>
              <th className="px-4 py-3 font-medium text-right">Cantidad</th>
              <th className="px-4 py-3 font-medium text-right">Último</th>
              <th className="px-4 py-3 font-medium text-right">Precio límite</th>
              <th className="px-4 py-3 font-medium text-right">Monto</th>
              <th className="px-4 py-3 font-medium text-right">Peso</th>
              <th className="px-4 py-3 font-medium">Por qué</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a]">
            {ordenes.map(o => (
              <tr key={o.ticker} className="align-top">
                <td className="px-4 py-3 font-bold text-zinc-900 dark:text-[#e4e4e7]">
                  {sinSufijo(o.ticker)}
                  {o.todo && <span className="ml-2 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Todo</span>}
                  {o.origen === 'OPORTUNIDAD' && <span className="ml-2 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300">Nueva</span>}
                  {o.nombre && <p className="text-[11px] font-normal text-zinc-500 dark:text-[#71717a] max-w-[160px] truncate">{o.nombre}</p>}
                </td>
                <td className={`px-4 py-3 font-mono text-right ${venta ? 'text-[#f87171]' : 'text-[#34d399]'}`}>{venta ? '−' : '+'}{cantidad(o)}</td>
                <td className="px-4 py-3 font-mono text-right text-zinc-600 dark:text-[#a1a1aa]">{precio(o.precio, o.moneda)}</td>
                <td className="px-4 py-3 font-mono text-right text-zinc-900 dark:text-[#e4e4e7] whitespace-nowrap">
                  {precio(o.limite, o.moneda)}
                  <p className="text-[10px] text-zinc-500 dark:text-[#71717a]">{venta ? 'no menos de' : 'no más de'}</p>
                </td>
                <td className="px-4 py-3 font-mono text-right text-zinc-600 dark:text-[#a1a1aa]">{pesos(o.montoCLP)}</td>
                <td className="px-4 py-3 font-mono text-right text-zinc-600 dark:text-[#a1a1aa] whitespace-nowrap">{pct(o.pesoAntes)} → {pct(o.pesoDespues)}</td>
                <td className="px-4 py-3 text-xs text-zinc-600 dark:text-[#a1a1aa] min-w-[220px]">{o.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RebalanceoPanel() {
  const { items } = usePortfolio();
  const [metaChile, setMetaChile] = useState<number>(META_CHILE_DEFECTO);
  const [aporte, setAporte] = useState('');
  const [fraccionar, setFraccionar] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);

  // La meta parte de la que elegiste en tu perfil (la misma que usa el agente)
  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const datos = session
          ? (await supabase.from('perfil_inversionista').select('datos').eq('user_id', session.user.id).maybeSingle()).data?.datos
          : JSON.parse(localStorage.getItem(PERFIL_LOCAL) ?? 'null');
        const meta = parsePerfil(datos)?.metaChile;
        if (vigente && meta) setMetaChile(meta);
      } catch { /* sin perfil: queda la meta del asesor */ }
    })();
    return () => { vigente = false; };
  }, []);

  const calcular = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setPlan(null);
    try {
      if (items.length === 0) throw new Error('Tu portafolio está vacío. Agrega activos primero.');
      const res = await fetch('/api/portfolio/rebalanceo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, metaChile, aporte: Number(aporte.replace(/\D/g, '')) || 0, fraccionar }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) throw new Error(data?.error || `El cálculo no respondió (error ${res.status}). Intenta de nuevo.`);
      setPlan(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none p-6">
        <div className="flex items-center gap-3 mb-6 border-b border-zinc-200 dark:border-[#27272a] pb-4">
          <Scale className="w-6 h-6 text-[#60a5fa]" />
          <div>
            <h2 className="text-lg font-sans font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7] uppercase tracking-wider">Rebalancear mi cartera</h2>
            <p className="text-zinc-600 dark:text-[#a1a1aa] text-xs font-sans">
              Vende solo por cuatro razones: una señal de venta con evidencia medida en 10 años, una empresa o fondo sobre su máximo (20% / 40%),
              un sector sobre 35% o Chile sobre tu meta. Recorta primero las posiciones más grandes y deja 2 puntos de holgura. Lo obtenido se
              reinvierte solo en lo que tiene señal AUMENTAR, con el mismo optimizador de la compra con capital nuevo, y nunca en el grupo que se está reduciendo.
            </p>
          </div>
        </div>

        <form onSubmit={calcular} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] mb-1">Máximo en Chile</span>
              <select value={metaChile} onChange={e => setMetaChile(Number(e.target.value))} className={campo}>
                {METAS_CHILE.map(m => <option key={m} value={m}>Hasta {Math.round(m * 100)}%{m === META_CHILE_DEFECTO ? ' (lo que sugiere el asesor)' : ''}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-sans font-medium text-zinc-500 dark:text-[#71717a] mb-1">Opcional: dinero nuevo para sumar (CLP)</span>
              <input
                inputMode="numeric" placeholder="0" className={campo}
                value={aporte ? Number(aporte.replace(/\D/g, '')).toLocaleString('es-CL') : ''}
                onChange={e => setAporte(e.target.value.replace(/\D/g, '').slice(0, 12))}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-[#a1a1aa] cursor-pointer select-none">
            <input type="checkbox" checked={fraccionar} onChange={e => setFraccionar(e.target.checked)} className="accent-[#60a5fa]" />
            Permitir fracciones de acciones de EE.UU. (las chilenas siempre van enteras)
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 bg-[#60a5fa] hover:bg-[#3b82f6] disabled:bg-[#27272a] disabled:text-zinc-500 text-[#09090b] px-6 py-4 font-bold font-mono transition-colors"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'CALCULAR REBALANCEO'}
          </button>
        </form>
      </div>

      {error && <div className="bg-[#f87171]/10 border border-[#f87171]/50 text-[#f87171] p-4 rounded text-sm font-mono">[ERROR] {error}</div>}

      {plan && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { titulo: 'Valor de la cartera', valor: pesos(plan.valorCLP), sub: plan.aporteCLP ? `+ ${pesos(plan.aporteCLP)} de aporte` : '' },
              { titulo: `En Chile (meta hasta ${Math.round(plan.metaChile * 100)}%)`, valor: `${pct(plan.antes.chile)} → ${pct(plan.despues.chile)}`, sub: '' },
              ...(plan.antes.sector ? [{ titulo: `${plan.antes.sector.nombre} (máximo 35%)`, valor: `${pct(plan.antes.sector.peso)} → ${pct(plan.despues.sector?.peso ?? plan.antes.sector.peso)}`, sub: 'contando tus fondos' }] : []),
            ].map(t => (
              <div key={t.titulo} className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4">
                <p className="text-[11px] font-mono uppercase text-zinc-500 dark:text-[#71717a]">{t.titulo}</p>
                <p className="text-lg font-mono font-bold text-zinc-900 dark:text-[#e4e4e7] mt-1">{t.valor}</p>
                {t.sub && <p className="text-[11px] text-zinc-500 dark:text-[#71717a]">{t.sub}</p>}
              </div>
            ))}
          </div>

          <TablaOrdenes titulo={`Vender (${pesos(plan.ventasCLP)})`} ordenes={plan.ventas} icono={<ArrowDownRight className="w-4 h-4 text-[#f87171]" />} />
          <TablaOrdenes titulo={`Comprar (${pesos(plan.comprasCLP)})`} ordenes={plan.compras} icono={<ArrowUpRight className="w-4 h-4 text-[#34d399]" />} />
          {plan.motivoSinInvertir && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded p-3">
              Quedan {pesos(plan.sinInvertirCLP)} sin invertir: {plan.motivoSinInvertir}
            </p>
          )}

          {plan.niveles.length > 0 && (
            <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4">
              <p className="text-sm font-mono uppercase tracking-widest text-zinc-900 dark:text-[#e4e4e7] flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-[#60a5fa]" /> Precios que cambian la decisión
              </p>
              <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-[#a1a1aa]">
                {plan.niveles.map(n => <li key={n.ticker + n.tipo}><span className="font-bold text-zinc-900 dark:text-[#e4e4e7]">{sinSufijo(n.ticker)}</span>: {n.texto}</li>)}
              </ul>
            </div>
          )}

          <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 space-y-2 text-xs text-zinc-600 dark:text-[#a1a1aa]">
            {plan.notas.map(n => <p key={n}>{n}</p>)}
            <p className="flex gap-2 pt-1 text-zinc-700 dark:text-zinc-300">
              <BellRing className="w-4 h-4 shrink-0 text-[#60a5fa]" />
              Cada mañana hábil el agente recalcula este plan con la cartera guardada en tu cuenta y te avisa por Telegram si cambia, si un precio se acerca a uno de estos niveles o, cada lunes, con el resumen. Usa la meta de Chile de tu perfil.
            </p>
          </div>

          {plan.excluidosCompra.length > 0 && (
            <details className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded p-4 text-xs text-zinc-600 dark:text-[#a1a1aa]">
              <summary className="font-mono uppercase text-zinc-500 dark:text-[#71717a] cursor-pointer">Por qué no se compra lo demás</summary>
              <ul className="space-y-1 mt-2">
                {plan.excluidosCompra.map(e => <li key={e.ticker}><span className="font-bold text-zinc-900 dark:text-[#e4e4e7]">{sinSufijo(e.ticker)}</span>: {e.motivo}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
