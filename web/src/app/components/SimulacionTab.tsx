'use client';

import React, { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, FlaskConical, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fechaCorta, pctSigno } from './topFormato';

// El Top v2 operado en Alpaca: la simulación con dinero ficticio (tabla paper_trading, pública) y, si existe, la
// cuenta de dinero real (tabla real_trading, que por RLS solo ve su dueño). Las opera trading/main.py desde GitHub
// Actions; la web solo lee esas tablas (nunca ve las claves de Alpaca).

interface Posicion { ticker: string; cantidad: number; valor: number; peso: number; costo: number; ganancia_pct: number }
interface Orden {
  fecha: string; ticker: string; lado: 'compra' | 'venta'; motivo: string; estado: string;
  cantidad: number; precio: number | null; monto_pedido: number | null;
}
interface Evento { fecha: string; tipo: string; texto: string }
interface Punto { f: string; c: number; s: number }
interface Estado {
  titulo: string; actualizado: string;
  cuenta: { patrimonio: number; patrimonio_ayer: number; efectivo: number };
  inicio: string | null;
  rebalanceo: { mes: string; fecha: string; descripcion: string } | null;
  proximo_rebalanceo: string;
  posiciones: Posicion[]; ordenes: Orden[]; eventos: Evento[]; curva: Punto[];
  limites: { peso_maximo: number; perdida_diaria_maxima: number; stop_loss: number };
  tope?: number | null;
}
type Fuente = 'paper' | 'real';

const tarjeta = 'bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-lg';
const usd = (x: number, d = 0) => `US$ ${x.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const colorSigno = (x: number) => x >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';

const MOTIVO: Record<string, string> = { reb: 'rebalanceo', stop: 'stop loss' };
const EVENTO_ESTILO: Record<string, string> = {
  rebalanceo: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  stop: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  freno: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  espera: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

interface TooltipProps { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }

function CurvaTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] p-3 rounded shadow-lg">
      <p className="text-zinc-600 dark:text-[#a1a1aa] text-xs mb-2">{label ? fechaCorta(label) : ''}</p>
      {payload.map(e => (
        <div key={e.name} className="flex items-center gap-2 text-sm font-mono">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: e.color }} />
          <span className="text-zinc-900 dark:text-[#e4e4e7]">{e.name}:</span>
          <span className="font-bold text-zinc-900 dark:text-white">{pctSigno(e.value / 100 - 1)}</span>
        </div>
      ))}
    </div>
  );
}

function Curva({ curva, real }: { curva: Punto[]; real: boolean }) {
  if (curva.length < 2) {
    return <p className="text-xs text-zinc-500 dark:text-[#71717a]">La curva frente al S&amp;P 500 aparece con el primer cierre después de la primera compra.</p>;
  }
  const [base, ultimo] = [curva[0], curva[curva.length - 1]];
  const datos = curva.map(p => ({ fecha: p.f, Cartera: (p.c / base.c) * 100, 'S&P 500': (p.s / base.s) * 100 }));
  const [rc, rs] = [ultimo.c / base.c - 1, ultimo.s / base.s - 1];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 text-center">
        {([[real ? 'Cartera' : 'Cartera simulada', rc], ['S&P 500', rs], ['Diferencia', rc - rs]] as const).map(([nombre, valor]) => (
          <div key={nombre} className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded p-3">
            <p className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">{nombre}</p>
            <p className={`text-lg font-bold font-mono ${colorSigno(valor)}`}>{pctSigno(valor)}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-zinc-500 dark:text-[#71717a]">
        Desde el cierre del {fechaCorta(base.f)} (antes de la primera compra) al del {fechaCorta(ultimo.f)}.{' '}
        {real ? 'Los depósitos y retiros no cuentan como ganancia. La cartera incluye los dividendos que cobra; el S&P 500, no.' : 'Ambos sin dividendos.'}
      </p>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={datos} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="fecha" stroke="#71717a" fontSize={10} tickFormatter={(v: string) => v.slice(5)} minTickGap={30} />
            <YAxis stroke="#71717a" fontSize={10} tickFormatter={(v: number) => `${(v - 100).toFixed(0)}%`} domain={['auto', 'auto']} width={40} />
            <Tooltip content={<CurvaTooltip />} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', fontFamily: 'monospace' }} />
            <Line type="monotone" dataKey="Cartera" stroke="#d946ef" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="S&P 500" stroke="#60a5fa" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

async function ultimo(tabla: string): Promise<Estado | null> {
  const { data, error } = await supabase.from(tabla).select('datos').order('fecha', { ascending: false }).limit(1);
  return !error && data?.[0] ? (data[0].datos as Estado) : null;
}

export default function SimulacionTab() {
  const [estados, setEstados] = useState<Record<Fuente, Estado | null>>({ paper: null, real: null });
  const [fuente, setFuente] = useState<Fuente>('paper');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // La simulación es dinero ficticio y se muestra también en modo demo. La cuenta real solo le llega a su
        // dueño con sesión iniciada: para cualquier otro la consulta vuelve vacía (RLS)
        const [paper, real] = await Promise.all([ultimo('paper_trading'), ultimo('real_trading')]);
        setEstados({ paper, real });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-center p-12 font-mono text-zinc-600 dark:text-[#a1a1aa]">Cargando la simulación...</div>;

  const real = fuente === 'real';
  const estado = estados[fuente];
  const selector = estados.real && (
    <div className="flex justify-center gap-2">
      {([['paper', 'Simulación (ficticio)'], ['real', 'Cuenta real']] as const).map(([f, nombre]) => (
        <button key={f} onClick={() => setFuente(f)}
          className={`px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider border ${fuente === f
            ? 'border-[#d946ef] text-[#d946ef] bg-fuchsia-50 dark:bg-fuchsia-950/40'
            : 'border-zinc-200 dark:border-[#27272a] text-zinc-500 dark:text-[#71717a] hover:text-zinc-900 dark:hover:text-[#e4e4e7]'}`}>
          {nombre}
        </button>
      ))}
    </div>
  );

  if (!estado) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        {selector}
        <div className={`${tarjeta} text-center p-12`}>
          <FlaskConical className="w-8 h-8 text-[#d946ef] mx-auto mb-4" />
          <h3 className="text-lg font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7] mb-2">La simulación aún no tiene datos</h3>
          <p className="text-sm text-zinc-600 dark:text-[#a1a1aa]">Empieza con la primera corrida en horario de la bolsa de Nueva York (lunes a viernes).</p>
        </div>
      </div>
    );
  }

  const { cuenta, limites } = estado;
  const hoy = cuenta.patrimonio_ayer > 0 ? cuenta.patrimonio / cuenta.patrimonio_ayer - 1 : 0;
  const invertido = cuenta.patrimonio - cuenta.efectivo;
  const pendiente = !estado.rebalanceo || estado.proximo_rebalanceo <= estado.actualizado.slice(0, 10);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {selector}
      <div className={`${tarjeta} p-6 space-y-4`}>
        <div className="text-center">
          <h2 className="text-xl font-bold text-[#d946ef] uppercase tracking-widest">{real ? 'Cuenta real' : 'Simulación en vivo'}</h2>
          {real ? (
            <p className="text-zinc-600 dark:text-[#a1a1aa] text-sm max-w-2xl mx-auto mt-2">
              Tu cuenta de Alpaca con dinero de verdad. Cada mes el sistema compra las acciones del Top de EE.UU. a partes iguales
              {estado.tope ? `, con hasta ${usd(estado.tope)},` : ''} y las mantiene hasta el mes siguiente, con las mismas reglas que la simulación.
              Solo tú ves esta página.
            </p>
          ) : (
            <p className="text-zinc-600 dark:text-[#a1a1aa] text-sm max-w-2xl mx-auto mt-2">
              Cada mes el sistema compra con dinero ficticio, en una cuenta de práctica de Alpaca, las acciones del Top de EE.UU. a partes iguales
              y las mantiene hasta el mes siguiente. No es trading de corto plazo: sirve para ver, con órdenes reales en el mercado, si seguir el Top
              le gana al S&amp;P 500 antes de poner plata de verdad.
            </p>
          )}
          <p className="text-xs font-medium text-zinc-500 dark:text-[#71717a] mt-3 uppercase">
            Última actualización: {new Date(estado.actualizado).toLocaleString('es-CL')} ·{' '}
            {pendiente ? 'rebalanceo pendiente (en la próxima corrida con la bolsa abierta)' : `próximo rebalanceo: ${fechaCorta(estado.proximo_rebalanceo)}`}
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          {[
            ['Patrimonio', usd(cuenta.patrimonio), ''],
            ['Hoy', pctSigno(hoy, 2), colorSigno(hoy)],
            ['Invertido', usd(invertido), ''],
            ['Efectivo', `${usd(cuenta.efectivo)} (${pct(cuenta.efectivo / (cuenta.patrimonio || 1))})`, ''],
          ].map(([nombre, valor, color]) => (
            <div key={nombre} className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded p-3">
              <p className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a] uppercase tracking-widest">{nombre}</p>
              <p className={`text-sm font-bold font-mono ${color || 'text-zinc-900 dark:text-[#e4e4e7]'}`}>{valor}</p>
            </div>
          ))}
        </div>

        <Curva curva={estado.curva ?? []} real={real} />
      </div>

      <section className={`${tarjeta} p-4 space-y-3`}>
        <h3 className="text-sm font-bold text-zinc-900 dark:text-[#e4e4e7]">
          Cartera actual{estado.rebalanceo ? ` · rebalanceada el ${fechaCorta(estado.rebalanceo.fecha)} con ${estado.rebalanceo.descripcion}` : ''}
        </h3>
        {estado.posiciones.length === 0 ? (
          <p className="text-xs text-zinc-500">Todavía sin posiciones: la primera compra se hace en la próxima corrida con la bolsa abierta.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-mono text-zinc-500 dark:text-[#71717a] uppercase tracking-widest text-right">
                  <th className="text-left py-2">Acción</th><th>Peso</th><th>Valor</th><th>Desde la compra</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {estado.posiciones.map(p => (
                  <tr key={p.ticker} className="border-t border-zinc-100 dark:border-[#27272a] text-right">
                    <td className="text-left py-1.5 font-bold text-zinc-900 dark:text-[#e4e4e7]">{p.ticker}</td>
                    <td className="text-zinc-700 dark:text-[#d4d4d8]">{pct(p.peso)}</td>
                    <td className="text-zinc-700 dark:text-[#d4d4d8]">{usd(p.valor)}</td>
                    <td className={colorSigno(p.ganancia_pct)}>{pctSigno(p.ganancia_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {estado.eventos.length > 0 && (
        <section className={`${tarjeta} p-4 space-y-2`}>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-[#e4e4e7]">Bitácora</h3>
          {[...estado.eventos].reverse().slice(0, 10).map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="font-mono text-zinc-500 w-20 shrink-0">{fechaCorta(e.fecha)}</span>
              <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${EVENTO_ESTILO[e.tipo] ?? EVENTO_ESTILO.espera}`}>{e.tipo}</span>
              <span className="text-zinc-700 dark:text-[#d4d4d8]">{e.texto}</span>
            </div>
          ))}
        </section>
      )}

      {estado.ordenes.length > 0 && (
        <details className={`${tarjeta} p-4`}>
          <summary className="cursor-pointer text-sm font-bold text-zinc-900 dark:text-[#e4e4e7]">Órdenes ({estado.ordenes.length} más recientes)</summary>
          <div className="mt-3 space-y-1 font-mono text-xs">
            {estado.ordenes.map((o, i) => (
              <div key={i} className="flex flex-wrap gap-x-3 text-zinc-700 dark:text-[#d4d4d8]">
                <span className="text-zinc-500 w-20">{fechaCorta(o.fecha)}</span>
                <span className={o.lado === 'compra' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{o.lado}</span>
                <span className="font-bold w-14">{o.ticker}</span>
                <span>{o.precio ? `${o.cantidad.toLocaleString('es-CL', { maximumFractionDigits: 4 })} × ${usd(o.precio, 2)} = ${usd(o.cantidad * o.precio)}` : o.monto_pedido ? `pedido ${usd(o.monto_pedido)}` : ''}</span>
                <span className="text-zinc-500">{MOTIVO[o.motivo] ?? o.motivo}{o.estado !== 'filled' ? ` · ${o.estado}` : ''}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <section className={`${tarjeta} p-4 space-y-2`}>
        <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-[#e4e4e7]"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Reglas de riesgo</h3>
        <ul className="text-xs text-zinc-600 dark:text-[#a1a1aa] space-y-1 list-disc pl-4">
          <li>Ninguna acción pasa de {pct(limites.peso_maximo, 0)} de la cartera.</li>
          <li>Si el patrimonio cae {pct(limites.perdida_diaria_maxima, 0)} en un día, ese día no se compra nada.</li>
          <li>Una acción que cae {pct(limites.stop_loss, 0)} bajo su costo se vende. Es un freno ante una catástrofe: el método medido mantiene las acciones el mes completo.</li>
          <li>Sin margen ni ventas en corto: solo se gasta el efectivo que hay.</li>
          {real ? (
            <li>Invierte como máximo {estado.tope ? usd(estado.tope) : 'el tope que fijaste'}: si la cuenta tiene más, el resto queda en efectivo. Trata toda la cuenta como suya: no compres a mano en ella.</li>
          ) : (
            <li>Usa solo el servidor de práctica de Alpaca. La cuenta real es aparte, con otras claves, y se activa a mano.</li>
          )}
        </ul>
      </section>

      <details className="text-[11px] text-zinc-500 dark:text-[#71717a]">
        <summary className="cursor-pointer flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {real ? 'Antes de confiar en estos números' : 'Límites de la simulación'}</summary>
        <ul className="mt-2 space-y-1 list-disc pl-4">
          {real ? (
            <>
              <li>Alpaca no cobra comisión por comprar o vender acciones; solo descuenta cargos regulatorios ínfimos en las ventas.</li>
              <li>Las ganancias de acciones de EE.UU. se declaran en Chile; los dividendos llegan con la retención de EE.UU. ya descontada.</li>
            </>
          ) : (
            <>
              <li>Los precios son los del mercado, pero la cuenta de práctica llena cada orden al precio cotizado, sin el impacto que tendría una orden real.</li>
              <li>La cuenta de práctica no paga dividendos: por eso se compara con el S&amp;P 500 sin dividendos.</li>
            </>
          )}
          <li>Unas semanas o meses no prueban nada: el método se midió en 10 años, aquí se ve si se sostiene en vivo.</li>
          <li>Es una herramienta de apoyo y no constituye asesoría financiera personalizada.</li>
        </ul>
      </details>
    </div>
  );
}
