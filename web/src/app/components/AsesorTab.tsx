'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, ExternalLink, FileWarning, Loader2, Newspaper, RefreshCw,
  Sparkles, Target, TrendingUp, Wallet,
} from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';
import { supabase } from '@/lib/supabase';
import { parsePerfil, type PerfilInversionista } from '@/lib/perfil';
import { FormRegistro, useRegistrar, type OrdenRegistro, type Registrar } from './RebalanceoPanel';
import ChatAsesor from './ChatAsesor';

// Tu asesor: lo que conviene hacer hoy, en una pantalla. El veredicto, las órdenes de tu aporte del mes (núcleo + Top
// medido), los ajustes de la cartera, los mercados, los hechos relevantes de tus empresas y todas las oportunidades del
// escáner con su consenso de analistas y sus titulares. El cálculo es el de lib/asesor.ts (POST /api/asesor), el mismo
// del agente que avisa cada mañana; aquí solo se muestra. Los tipos se repiten para no llevar código de servidor.

type Mercado = 'EE.UU.' | 'Chile';
interface OrdenAporte {
  ticker: string; nombre?: string; moneda: 'USD' | 'CLP'; mercado: Mercado; papel: 'nucleo' | 'top'; puesto?: number; sector?: string;
  cantidad: number; precio: number; limite: number; montoCLP: number; tienesCLP: number; enRojo: boolean; proximosResultados: string | null; motivo: string;
}
interface PlanAporte {
  montoCLP: number; nivel: string; satelite: number; chileCLP: number; eeuuCLP: number; ordenes: OrdenAporte[];
  invertidoCLP: number; sinInvertirCLP: number; descartadas: { ticker: string; motivo: string }[];
  evidencia: { top: Partial<Record<Mercado, string>>; nucleo: string | null }; notas: string[]; resumen: string;
}
interface OrdenRebalanceo {
  ticker: string; nombre?: string; lado: 'VENDER' | 'COMPRAR'; moneda: 'USD' | 'CLP'; cantidad: number; todo: boolean;
  precio: number; limite: number; montoCLP: number; pesoAntes: number; pesoDespues: number; motivo: string;
}
interface Semaforo { clave: string; nombre: string; estado: 'verde' | 'rojo'; distancia: number; cambiaEn: number; distanciaCambio: number; caidaDesdeMaximo: number }
interface Aviso { id: string; nivel: 'alerta' | 'atencion' | 'info'; titulo: string; detalle: string; queHacer: string }
interface Indicador { nombre: string; ticker: string; valor: number; unidad: string; cambio3m: number | null; tendencia: string | null }
interface EventoSec { ticker: string; fecha: string; titulo: string; gravedad: 'grave' | 'atencion' | 'info'; url: string }
interface Respuesta {
  asesor: {
    generado: string; nivel: string | null; aporteMensual: number | null;
    veredicto: { accion: 'COMPRAR' | 'VENDER Y COMPRAR' | 'VENDER' | 'MANTENER'; titulo: string; detalle: string };
    aporte: PlanAporte | null;
    rebalanceo: { ventas: OrdenRebalanceo[]; compras: OrdenRebalanceo[]; ventasCLP: number; comprasCLP: number; semaforos: Semaforo[]; avisos: Aviso[]; antes: { chile: number }; metaChile: number; evidenciaCompras: PlanAporte['evidencia'] | null };
    frenos: { ticker: string; motivo: string }[];
  };
  eventos: { porTicker: Record<string, EventoSec[]>; fecha: string } | null;
  mercado: { titulo: string; lecturas: string[]; indicadores: Indicador[] } | null;
  resumen: { valorCLP: number; pnlCLP: number; pnlPct: number | null; usdClp: number };
  posiciones: { ticker: string; nombre?: string; valorCLP: number; peso: number; accion: string }[];
  avisosDatos: string[];
}
interface Noticia { titulo: string; fuente: string; fecha: string; url: string }
interface Idea {
  ticker: string; mercado: Mercado; moneda: 'USD' | 'CLP'; puesto: number; peso: number; sector?: string; industria?: string; nombre?: string;
  precioHoy: number | null; per: number | null; perForward: number | null; dividendo: string | null; dividendYield: number | null;
  proximosResultados: string | null; momentum: number | null; roe: number | null; crecimientoVentas: number | null;
  analistas: { n: number; recomendacion: string; objetivo: number; potencial: number } | null;
}
interface Oportunidades { fecha: string | null; ideas: Idea[]; noticias: Record<string, Noticia[]> }

const PERFIL_LOCAL = 'omnicapital_perfil_v1';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d).replace('.', ',')}%`;
const signo = (x: number, d = 1) => `${x >= 0 ? '+' : '−'}${pct(Math.abs(x), d)}`;
const precio = (n: number, moneda: 'USD' | 'CLP') => moneda === 'CLP'
  ? `$${n.toLocaleString('es-CL', n >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : `US$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cant = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 4 });
const sinSufijo = (t: string) => t.replace(/\.SN$/, '');
const fecha = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
const diasHasta = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.now()) / 86400000);

const tarjeta = 'bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded';
const titulo = 'text-sm font-mono uppercase tracking-widest text-zinc-900 dark:text-[#e4e4e7] flex items-center gap-2';
const chip = 'text-[10px] font-mono uppercase px-1.5 py-0.5 rounded';
const COLOR_VEREDICTO: Record<Respuesta['asesor']['veredicto']['accion'], string> = {
  COMPRAR: 'from-emerald-500/15 border-emerald-400/60 text-emerald-700 dark:text-emerald-300',
  'VENDER Y COMPRAR': 'from-sky-500/15 border-sky-400/60 text-sky-700 dark:text-sky-300',
  VENDER: 'from-red-500/15 border-red-400/60 text-red-700 dark:text-red-300',
  MANTENER: 'from-zinc-500/10 border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300',
};
const RECOMENDACION_COLOR = (r: string) => (/compra/.test(r) ? 'text-emerald-600 dark:text-emerald-400' : /venta|bajo/.test(r) ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-[#a1a1aa]');

function Registro({ o, registrar }: { o: OrdenRegistro; registrar: Registrar | null }) {
  const [abierto, setAbierto] = useState(false);
  const [listo, setListo] = useState(false);
  if (!registrar) return null;
  if (listo) return <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#34d399]"><CheckCircle2 className="w-3.5 h-3.5" /> Registrada</span>;
  return (
    <div className="mt-2">
      <button
        onClick={() => setAbierto(!abierto)} aria-expanded={abierto}
        className="text-[11px] font-mono font-bold uppercase px-2 py-1 rounded border border-[#60a5fa] text-[#60a5fa] hover:bg-[#60a5fa]/10"
      >
        {abierto ? 'Cerrar' : o.lado === 'VENDER' ? 'Ya vendí: registrar' : 'Ya compré: registrar'}
      </button>
      {abierto && <div className="mt-3"><FormRegistro o={o} registrar={registrar} onListo={() => { setListo(true); setAbierto(false); }} /></div>}
    </div>
  );
}

function TarjetaOrden({ o, registrar }: { o: OrdenAporte; registrar: Registrar | null }) {
  const pronto = o.proximosResultados && diasHasta(o.proximosResultados) >= 0 && diasHasta(o.proximosResultados) <= 7;
  return (
    <div className={`${tarjeta} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-lg text-zinc-900 dark:text-[#e4e4e7]">{sinSufijo(o.ticker)}</span>
            <span className={`${chip} ${o.papel === 'nucleo' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300' : 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300'}`}>
              {o.papel === 'nucleo' ? 'Núcleo' : `Top #${o.puesto}`}
            </span>
            {o.enRojo && <span className={`${chip} bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300`}>Mercado en rojo: más barato</span>}
            {pronto && <span className={`${chip} bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300`}>Resultados {fecha(o.proximosResultados!)}</span>}
          </div>
          {o.nombre && <p className="text-xs text-zinc-500 dark:text-[#71717a] truncate">{o.nombre}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{pesos(o.montoCLP)}</p>
          <p className="text-[11px] font-mono text-zinc-500 dark:text-[#71717a]">+{cant(o.cantidad)} · hasta {precio(o.limite, o.moneda)}</p>
        </div>
      </div>
      <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] mt-2">{o.motivo}</p>
      <Registro o={{ ticker: o.ticker, lado: 'COMPRAR', moneda: o.moneda, cantidad: o.cantidad, precio: o.precio }} registrar={registrar} />
    </div>
  );
}

function FilaAjuste({ o, registrar }: { o: OrdenRebalanceo; registrar: Registrar | null }) {
  const venta = o.lado === 'VENDER';
  return (
    <div className="py-3 border-b last:border-b-0 border-zinc-200 dark:border-[#27272a]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-zinc-900 dark:text-[#e4e4e7] flex items-center gap-1.5">
            {venta ? <ArrowDownRight className="w-4 h-4 text-red-500" /> : <ArrowUpRight className="w-4 h-4 text-emerald-500" />}
            {sinSufijo(o.ticker)}
            {o.todo && <span className={`${chip} bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300`}>Todo</span>}
          </p>
          <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] mt-1">{o.motivo}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`font-mono font-bold ${venta ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{venta ? '−' : '+'}{cant(o.cantidad)}</p>
          <p className="text-[11px] font-mono text-zinc-500 dark:text-[#71717a]">{venta ? 'no menos de' : 'hasta'} {precio(o.limite, o.moneda)} · {pesos(o.montoCLP)}</p>
        </div>
      </div>
      <Registro o={{ ticker: o.ticker, lado: o.lado, moneda: o.moneda, cantidad: o.cantidad, precio: o.precio }} registrar={registrar} />
    </div>
  );
}

function Medido({ texto, etiqueta = 'Lo medido' }: { texto: string | null | undefined; etiqueta?: string }) {
  if (!texto) return null;
  return (
    <details className="text-[11px] text-zinc-500 dark:text-[#a1a1aa]">
      <summary className="cursor-pointer font-mono uppercase">{etiqueta}</summary>
      <p className="mt-1 leading-relaxed">{texto}</p>
    </details>
  );
}

function TarjetaIdea({ i, noticias, eventos, tienes, enAporte, registrar }: {
  i: Idea; noticias: Noticia[]; eventos: EventoSec[]; tienes: number; enAporte: boolean; registrar: Registrar | null;
}) {
  const a = i.analistas;
  const grave = eventos.find(e => e.gravedad === 'grave');
  return (
    <div className={`${tarjeta} p-4 flex flex-col gap-2 ${grave ? 'border-red-300 dark:border-red-900/60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-zinc-900 dark:text-[#e4e4e7]">{sinSufijo(i.ticker)}</span>
            <span className={`${chip} bg-zinc-100 dark:bg-[#27272a] text-zinc-600 dark:text-[#a1a1aa]`}>{i.mercado} #{i.puesto}</span>
            {enAporte && <span className={`${chip} bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300`}>En tu aporte</span>}
            {tienes > 0 && <span className={`${chip} bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300`}>Tienes {pesos(tienes)}</span>}
          </div>
          <p className="text-xs text-zinc-500 dark:text-[#71717a] truncate">{i.nombre ?? i.industria ?? ''}{i.sector ? ` · ${i.sector}` : ''}</p>
        </div>
        {i.precioHoy !== null && <p className="font-mono text-sm text-zinc-900 dark:text-[#e4e4e7] shrink-0">{precio(i.precioHoy, i.moneda)}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
        <div><p className="text-zinc-500 dark:text-[#71717a] uppercase">{i.mercado === 'Chile' ? 'Momentum' : 'PER'}</p><p className="text-zinc-900 dark:text-[#e4e4e7]">{i.mercado === 'Chile' ? (i.momentum !== null ? signo(i.momentum, 0) : '—') : (i.per ? i.per.toFixed(1) : '—')}</p></div>
        <div><p className="text-zinc-500 dark:text-[#71717a] uppercase">Dividendo</p><p className="text-zinc-900 dark:text-[#e4e4e7]">{i.dividendo ?? '—'}</p></div>
        <div><p className="text-zinc-500 dark:text-[#71717a] uppercase">Resultados</p><p className="text-zinc-900 dark:text-[#e4e4e7]">{i.proximosResultados ? fecha(i.proximosResultados) : '—'}</p></div>
      </div>

      {a && a.n > 0 && (
        <p className="text-xs text-zinc-600 dark:text-[#a1a1aa]">
          <span className="font-mono uppercase text-[10px] text-zinc-500 dark:text-[#71717a]">Analistas ({a.n}): </span>
          <span className={`font-bold ${RECOMENDACION_COLOR(a.recomendacion)}`}>{a.recomendacion}</span>
          {a.objetivo > 0 && <> · objetivo {precio(a.objetivo, i.moneda)} <span className={a.potencial >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>({signo(a.potencial, 0)})</span></>}
        </p>
      )}

      {eventos.slice(0, 2).map(e => (
        <a key={e.url} href={e.url} target="_blank" rel="noopener noreferrer" className={`text-xs flex gap-1.5 ${e.gravedad === 'grave' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'} hover:underline`}>
          <FileWarning className="w-3.5 h-3.5 shrink-0 mt-0.5" /> SEC {fecha(e.fecha)}: {e.titulo}
        </a>
      ))}
      {noticias.slice(0, 2).map(n => (
        <a key={n.url} href={n.url} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-600 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-white flex gap-1.5">
          <Newspaper className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span className="line-clamp-2">{n.titulo} <span className="text-zinc-400">· {n.fuente} {fecha(n.fecha)}</span></span>
        </a>
      ))}
      {i.precioHoy !== null && (
        <Registro o={{ ticker: i.ticker, lado: 'COMPRAR', moneda: i.moneda, cantidad: i.moneda === 'CLP' ? 1 : 0.1, precio: i.precioHoy }} registrar={registrar} />
      )}
    </div>
  );
}

export default function AsesorTab({ irA }: { irA: (destino: 'DATA_WAREHOUSE' | 'RECOMENDACIONES' | 'CALCULADORA' | 'AVISOS') => void }) {
  const { items, loading: cargandoCartera } = usePortfolio();
  const registrar = useRegistrar();
  const [perfil, setPerfil] = useState<PerfilInversionista | null>(null);
  const [perfilListo, setPerfilListo] = useState(false);
  const [monto, setMonto] = useState('');
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [ops, setOps] = useState<Oportunidades | null>(null);
  const [cargandoOps, setCargandoOps] = useState(false);
  const [filtro, setFiltro] = useState<'todas' | Mercado | 'aporte'>('todas');

  // Tu perfil decide cuánto va al Top y tu aporte del mes
  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const guardado = session
          ? (await supabase.from('perfil_inversionista').select('datos').eq('user_id', session.user.id).maybeSingle()).data?.datos
          : JSON.parse(localStorage.getItem(PERFIL_LOCAL) ?? 'null');
        const p = parsePerfil(guardado);
        if (!vigente) return;
        setPerfil(p);
        if (p?.aporteMensual) setMonto(p.aporteMensual.toLocaleString('es-CL'));
      } catch { /* sin perfil */ }
      if (vigente) setPerfilListo(true);
    })();
    return () => { vigente = false; };
  }, []);

  const calcular = useCallback(async (montoTexto?: string) => {
    if (!items.length) return;
    setCargando(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const valor = Number((montoTexto ?? '').replace(/\D/g, ''));
      const res = await fetch('/api/asesor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ items, perfil, monto: valor > 0 ? valor : null }),
      });
      const r = await res.json().catch(() => null);
      if (!res.ok || !r || r.error) throw new Error(r?.error || `El asesor no respondió (error ${res.status}). Intenta de nuevo.`);
      setDatos(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setCargando(false);
    }
  }, [items, perfil]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- calcula al abrir la pestaña, con el perfil ya leído
    if (perfilListo) calcular(perfil?.aporteMensual ? String(perfil.aporteMensual) : undefined);
  }, [perfilListo, calcular, perfil]);

  // Las oportunidades (con titulares y consenso) se cargan aparte: tardan más y no frenan el plan
  const principales = useMemo(() => (datos?.posiciones ?? []).slice(0, 8).map(p => ({ ticker: p.ticker, nombre: p.nombre })), [datos]);
  useEffect(() => {
    if (!datos || ops) return;
    let vigente = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se piden una vez que hay plan
    setCargandoOps(true);
    fetch('/api/asesor/oportunidades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cartera: principales }) })
      .then(r => r.json())
      .then(r => { if (vigente && r && !r.error) setOps(r); })
      .catch(() => { /* el feed es complementario */ })
      .finally(() => { if (vigente) setCargandoOps(false); });
    return () => { vigente = false; };
  }, [datos, ops, principales]);

  const a = datos?.asesor;
  const aporte = a?.aporte ?? null;
  const reb = a?.rebalanceo;
  const tienes = useMemo(() => new Map((datos?.posiciones ?? []).map(p => [p.ticker, p.valorCLP])), [datos]);
  const enAporte = useMemo(() => new Set([...(aporte?.ordenes ?? []).map(o => o.ticker), ...(reb?.compras ?? []).map(o => o.ticker)]), [aporte, reb]);
  const eventos = datos?.eventos?.porTicker ?? {};
  const hechosCartera = Object.values(eventos).flat()
    .filter(e => tienes.has(e.ticker) && e.gravedad !== 'info')
    .sort((x, y) => y.fecha.localeCompare(x.fecha));
  const noticiasCartera = principales.flatMap(p => (ops?.noticias[p.ticker] ?? []).slice(0, 2).map(n => ({ ...n, ticker: p.ticker })))
    .sort((x, y) => y.fecha.localeCompare(x.fecha)).slice(0, 8);
  const ideas = (ops?.ideas ?? []).filter(i => filtro === 'todas' || (filtro === 'aporte' ? enAporte.has(i.ticker) : i.mercado === filtro));
  const mes = MESES[new Date().getMonth()];

  // Lo que el chat sabe de esta pantalla (compacto: las cifras finas las pide al motor)
  const contexto = useMemo(() => {
    if (!datos) return null;
    const as = datos.asesor;
    return {
      hoy: as.generado.slice(0, 10),
      perfil: { nivel: as.nivel, aporte_mensual: as.aporteMensual, meta_chile: as.rebalanceo.metaChile, chile_hoy: as.rebalanceo.antes.chile },
      cartera: { valor_clp: Math.round(datos.resumen.valorCLP), ganancia_clp: Math.round(datos.resumen.pnlCLP), dolar: datos.resumen.usdClp,
        posiciones: datos.posiciones.map(p => ({ ticker: p.ticker, nombre: p.nombre, peso: Number(p.peso.toFixed(3)), accion_asesor: p.accion })) },
      veredicto: as.veredicto,
      aporte_del_mes: as.aporte && { monto: as.aporte.montoCLP, ordenes: as.aporte.ordenes.map(o => ({ ticker: o.ticker, papel: o.papel, monto: Math.round(o.montoCLP), cantidad: o.cantidad, limite: o.limite, motivo: o.motivo })), notas: as.aporte.notas },
      ajustes: [...as.rebalanceo.ventas, ...as.rebalanceo.compras].map(o => ({ ticker: o.ticker, lado: o.lado, monto: Math.round(o.montoCLP), cantidad: o.cantidad, motivo: o.motivo })),
      frenos: as.frenos,
      mercados: as.rebalanceo.semaforos.map(s => ({ nombre: s.nombre, estado: s.estado, vs_media_200d: Number(s.distancia.toFixed(3)), bajo_maximo: Number(s.caidaDesdeMaximo.toFixed(3)) })),
      indicadores: datos.mercado?.indicadores.map(x => ({ nombre: x.nombre, valor: x.valor, cambio_3m: x.cambio3m })) ?? [],
      avisos: as.rebalanceo.avisos.filter(x => x.nivel !== 'info').map(x => ({ titulo: x.titulo, que_hacer: x.queHacer })),
      hechos_relevantes_sec: Object.values(datos.eventos?.porTicker ?? {}).flat().filter(e => e.gravedad !== 'info').slice(0, 15),
      ideas_top: (ops?.ideas ?? []).map(i => ({ ticker: i.ticker, nombre: i.nombre, mercado: i.mercado, puesto: i.puesto, sector: i.sector, precio: i.precioHoy,
        analistas: i.analistas && { recomendacion: i.analistas.recomendacion, potencial: Number(i.analistas.potencial.toFixed(3)), n: i.analistas.n }, resultados: i.proximosResultados })),
      titulares: Object.entries(ops?.noticias ?? {}).flatMap(([t, ns]) => ns.slice(0, 2).map(n => ({ ticker: t, titulo: n.titulo, fuente: n.fuente, fecha: n.fecha }))).slice(0, 40),
    };
  }, [datos, ops]);

  if (!items.length && !cargandoCartera) {
    return (
      <div className={`${tarjeta} max-w-2xl mx-auto p-8 text-center space-y-3`}>
        <Sparkles className="w-8 h-8 mx-auto text-emerald-500" />
        <p className="font-bold text-zinc-900 dark:text-[#e4e4e7]">Carga tu cartera y te digo qué comprar este mes</p>
        <button onClick={() => irA('DATA_WAREHOUSE')} className="inline-flex items-center gap-1 text-sm font-mono font-bold uppercase text-[#60a5fa]">Ir a mis datos <ChevronRight className="w-4 h-4" /></button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Veredicto */}
      <section className={`rounded border bg-gradient-to-br to-transparent p-5 md:p-6 ${a ? COLOR_VEREDICTO[a.veredicto.accion] : 'border-zinc-200 dark:border-[#27272a]'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] opacity-80">Tu asesor · hoy</p>
            {a ? (
              <>
                <h2 className="text-2xl md:text-3xl font-black mt-1 text-zinc-900 dark:text-white">{a.veredicto.accion === 'VENDER Y COMPRAR' ? 'Vende y compra' : a.veredicto.accion === 'COMPRAR' ? 'Compra' : a.veredicto.accion === 'VENDER' ? 'Vende' : 'Mantén'}: {a.veredicto.titulo.charAt(0).toLowerCase() + a.veredicto.titulo.slice(1)}</h2>
                <p className="text-sm mt-2 text-zinc-700 dark:text-zinc-300">{a.veredicto.detalle}</p>
              </>
            ) : <p className="text-lg font-bold mt-1 text-zinc-900 dark:text-white flex items-center gap-2">{cargando && <Loader2 className="w-5 h-5 animate-spin" />} Revisando tu cartera, los mercados y las oportunidades…</p>}
          </div>
          <button onClick={() => calcular(monto)} disabled={cargando} aria-label="Actualizar" className="p-2 rounded border border-current/30 opacity-70 hover:opacity-100 disabled:opacity-30">
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {datos && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono text-zinc-600 dark:text-[#a1a1aa]">
            <span>Cartera {pesos(datos.resumen.valorCLP)}</span>
            {datos.resumen.pnlPct !== null && <span className={datos.resumen.pnlCLP >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{signo(datos.resumen.pnlPct)} ({pesos(datos.resumen.pnlCLP)})</span>}
            <span>Dólar {pesos(datos.resumen.usdClp)}</span>
            {a?.nivel && <span>Perfil {a.nivel}</span>}
          </div>
        )}
      </section>

      {error && <div className="bg-[#f87171]/10 border border-[#f87171]/50 text-[#f87171] p-4 rounded text-sm font-mono">[ERROR] {error}</div>}
      {perfilListo && !perfil && (
        <div className={`${tarjeta} p-4 text-sm text-zinc-700 dark:text-zinc-300 flex flex-wrap items-center justify-between gap-3`}>
          <span>Responde tu perfil de inversionista (2 minutos): con él sé cuánto arriesgar y cuánto aportas al mes.</span>
          <button onClick={() => irA('RECOMENDACIONES')} className="inline-flex items-center gap-1 font-mono font-bold uppercase text-xs text-[#60a5fa]">Completar perfil <ChevronRight className="w-4 h-4" /></button>
        </div>
      )}

      {/* Aporte del mes */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className={titulo}><Wallet className="w-4 h-4 text-emerald-500" /> Tu aporte de {mes}</h3>
          <form onSubmit={e => { e.preventDefault(); calcular(monto); }} className="flex items-end gap-2">
            <label className="text-xs text-zinc-600 dark:text-[#a1a1aa]">
              <span className="block mb-1">Monto (pesos)</span>
              <input
                value={monto} inputMode="numeric" placeholder="150.000"
                onChange={e => { const n = e.target.value.replace(/\D/g, ''); setMonto(n ? Number(n).toLocaleString('es-CL') : ''); }}
                className="w-36 bg-white dark:bg-[#09090b] border border-zinc-300 dark:border-[#3f3f46] rounded px-2 py-1.5 font-mono text-sm text-zinc-900 dark:text-[#e4e4e7] focus:outline-none focus:border-[#60a5fa]"
              />
            </label>
            <button type="submit" disabled={cargando} className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-[#09090b] font-bold font-mono uppercase text-xs px-3 py-2 rounded">Calcular</button>
          </form>
        </div>
        {aporte?.ordenes.length ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {aporte.ordenes.map(o => <TarjetaOrden key={o.ticker} o={o} registrar={registrar} />)}
            </div>
            <div className={`${tarjeta} p-4 space-y-2 text-xs text-zinc-600 dark:text-[#a1a1aa]`}>
              <p>
                <strong className="text-zinc-900 dark:text-[#e4e4e7]">Por qué así:</strong> {Math.round(aporte.satelite * 100)}% va a las ideas del Top, donde el laboratorio midió ventaja,
                y el resto al índice completo, que se compra todos los meses, caiga o suba. Cada mes el Top entra en las ideas que menos tienes, así en pocos meses tienes la cartera completa del método.
              </p>
              {aporte.notas.map(n => <p key={n}>• {n}</p>)}
              <Medido texto={aporte.evidencia.top['EE.UU.']} etiqueta="Lo medido: Top EE.UU." />
              <Medido texto={aporte.evidencia.top.Chile} etiqueta="Lo medido: Top Chile" />
              <Medido texto={aporte.evidencia.nucleo} etiqueta="Lo medido: comprar todos los meses" />
              {aporte.descartadas.length > 0 && <Medido texto={aporte.descartadas.map(d => `${sinSufijo(d.ticker)}: ${d.motivo}`).join(' · ')} etiqueta="Lo que no se compra hoy y por qué" />}
              <p className="text-[11px]">Usa órdenes límite al precio indicado: se ejecutan, pero si el precio salta no compras muy caro. Cuando compres, regístralo y tu cartera se actualiza sola.</p>
            </div>
          </>
        ) : datos && (
          <p className={`${tarjeta} p-4 text-sm text-zinc-600 dark:text-[#a1a1aa]`}>
            {aporte ? aporte.notas[0] ?? 'Con este monto no hay una compra posible hoy.' : 'Indica cuánto quieres invertir y te digo exactamente qué comprar.'}
          </p>
        )}
      </section>

      {/* Ajustes de la cartera */}
      {reb && (reb.ventas.length > 0 || reb.compras.length > 0) && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className={titulo}><Target className="w-4 h-4 text-sky-500" /> Ajustes de tu cartera</h3>
            <button onClick={() => irA('CALCULADORA')} className="text-xs font-mono uppercase text-[#60a5fa] inline-flex items-center gap-1">Detalle <ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <div className={`${tarjeta} px-4`}>
            {reb.ventas.map(o => <FilaAjuste key={`v${o.ticker}`} o={o} registrar={registrar} />)}
            {reb.compras.map(o => <FilaAjuste key={`c${o.ticker}`} o={o} registrar={registrar} />)}
          </div>
          <p className="text-xs text-zinc-500 dark:text-[#71717a]">Primero vende y después compra. Se vende solo por una señal con evidencia o por pasar un límite (una empresa, un sector o tu máximo en Chile); lo vendido se reinvierte igual que tu aporte.</p>
        </section>
      )}

      {/* Mercados */}
      {reb && (
        <section className="space-y-3">
          <h3 className={titulo}><TrendingUp className="w-4 h-4 text-amber-500" /> Mercados</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {reb.semaforos.map(s => (
              <div key={s.clave} className={`${tarjeta} p-3`}>
                <p className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-[#e4e4e7]">
                  <span className={`w-2.5 h-2.5 rounded-full ${s.estado === 'rojo' ? 'bg-red-500' : 'bg-emerald-500'}`} />{s.nombre}
                </p>
                <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] mt-1">{signo(s.distancia)} vs. su media de 200 días · {pct(s.caidaDesdeMaximo)} bajo su máximo</p>
                <p className="text-[11px] text-zinc-500 dark:text-[#71717a] mt-1">{s.estado === 'rojo' ? 'Se sigue comprando, más barato.' : 'Tendencia sana.'}</p>
              </div>
            ))}
          </div>
          {datos?.mercado && datos.mercado.indicadores.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {datos.mercado.indicadores.map(x => (
                <span key={x.ticker} className={`${tarjeta} px-2.5 py-1.5 text-[11px] font-mono text-zinc-700 dark:text-zinc-300`}>
                  {x.nombre} {x.unidad === '%' ? `${x.valor.toFixed(2)}%` : x.valor.toLocaleString('es-CL', { maximumFractionDigits: x.valor < 100 ? 2 : 0 })}
                  {x.cambio3m !== null && <span className={x.cambio3m >= 0 ? ' text-emerald-600 dark:text-emerald-400' : ' text-red-600 dark:text-red-400'}> {signo(x.cambio3m)} 3m</span>}
                </span>
              ))}
            </div>
          )}
          {reb.avisos.filter(x => x.nivel !== 'info').length > 0 && (
            <button onClick={() => irA('AVISOS')} className="text-xs font-mono uppercase text-[#60a5fa] inline-flex items-center gap-1">
              {reb.avisos.filter(x => x.nivel !== 'info').length} avisos de tu cartera <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </section>
      )}

      {/* Hechos relevantes y titulares de tu cartera */}
      {datos && (hechosCartera.length > 0 || noticiasCartera.length > 0 || cargandoOps) && (
        <section className="space-y-3">
          <h3 className={titulo}><Newspaper className="w-4 h-4 text-violet-500" /> Lo que pasa en tus empresas</h3>
          <div className={`${tarjeta} p-4 space-y-2`}>
            {hechosCartera.slice(0, 6).map(e => (
              <a key={e.url} href={e.url} target="_blank" rel="noopener noreferrer" className={`flex gap-2 text-sm hover:underline ${e.gravedad === 'grave' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                <FileWarning className="w-4 h-4 shrink-0 mt-0.5" /><span><strong>{e.ticker}</strong> · SEC {fecha(e.fecha)}: {e.titulo}</span><ExternalLink className="w-3 h-3 shrink-0 mt-1" />
              </a>
            ))}
            {noticiasCartera.map(n => (
              <a key={n.url} href={n.url} target="_blank" rel="noopener noreferrer" className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white">
                <Newspaper className="w-4 h-4 shrink-0 mt-0.5 text-zinc-400" /><span><strong>{sinSufijo(n.ticker)}</strong> · {n.titulo} <span className="text-xs text-zinc-400">{n.fuente} {fecha(n.fecha)}</span></span>
              </a>
            ))}
            {cargandoOps && !noticiasCartera.length && <p className="text-xs text-zinc-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando titulares…</p>}
            <p className="text-[11px] text-zinc-500 dark:text-[#71717a] pt-1">
              Hechos relevantes: lo que las empresas de EE.UU. informan a la SEC{datos.eventos ? ` (revisado el ${fecha(datos.eventos.fecha)})` : ' (los revisa el agente cada mañana)'}. Uno grave frena las compras de esa empresa hasta que lo revises. Los titulares informan; no mueven las órdenes.
            </p>
          </div>
        </section>
      )}

      {/* Oportunidades */}
      {datos && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className={titulo}><Sparkles className="w-4 h-4 text-fuchsia-500" /> Oportunidades del mercado{ops?.fecha ? ` · escaneo del ${fecha(ops.fecha)}` : ''}</h3>
            <div className="flex gap-1">
              {(['todas', 'EE.UU.', 'Chile', 'aporte'] as const).map(f => (
                <button key={f} onClick={() => setFiltro(f)} className={`text-[11px] font-mono uppercase px-2 py-1 rounded border ${filtro === f ? 'border-fuchsia-400 text-fuchsia-600 dark:text-fuchsia-300 bg-fuchsia-500/10' : 'border-zinc-200 dark:border-[#27272a] text-zinc-500'}`}>
                  {f === 'aporte' ? 'En tu plan' : f === 'todas' ? 'Todas' : f}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-zinc-600 dark:text-[#a1a1aa]">
            Lo que el escáner encontró en todo el S&P 500 y el IPSA con los dos métodos que tienen ventaja medida: en EE.UU., la utilidad más respaldada por caja de cada sector;
            en Chile, las de mayor alza de 12 meses. Junto a cada una, el consenso de los analistas, sus hechos relevantes y sus titulares.
          </p>
          {cargandoOps && !ops && <div className="flex items-center gap-2 py-10 justify-center text-sm text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /> Juntando precios, analistas y noticias…</div>}
          {ops && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {ideas.map(i => (
                <TarjetaIdea key={i.ticker} i={i} noticias={ops.noticias[i.ticker] ?? []} eventos={eventos[i.ticker] ?? []}
                  tienes={tienes.get(i.ticker) ?? 0} enAporte={enAporte.has(i.ticker)} registrar={registrar} />
              ))}
              {!ideas.length && <p className="text-sm text-zinc-500">Nada en este filtro.</p>}
            </div>
          )}
        </section>
      )}

      {items.length > 0 && <ChatAsesor contexto={contexto} items={items} perfil={perfil} />}

      {datos && datos.avisosDatos.length > 0 && (
        <details className="text-[11px] text-zinc-500 dark:text-[#71717a]">
          <summary className="cursor-pointer font-mono uppercase">Datos de hoy</summary>
          <ul className="mt-1 space-y-1">{datos.avisosDatos.map(x => <li key={x}>• {x}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
