import React, { useEffect, useMemo, useState } from 'react';
import { UploadCloud, FileText, CheckCircle, AlertCircle, Database, AlertTriangle, Copy, Info, Trash2 } from 'lucide-react';
import { usePortfolio, type PortfolioItem } from '../context/PortfolioContext';
import { parsePdfToCartola, type Moneda, type ResultadoCartola, type TipoMovimiento } from '@/lib/CartolaParser';
import {
  construirLibro, formatoMonto, posicionesParaPortafolio, tickerYahoo, valorizarHoy,
  type LibroInversiones, type ValorHoy,
} from '@/lib/LibroInversiones';
import { supabase } from '@/lib/supabase';

interface DataWarehouseTabProps {
  onPortfolioUpdate?: () => void;
}

// El libro (no los PDFs) queda guardado en este navegador para no tener que volver a subir las cartolas
const CLAVE_LIBRO = 'libroInversiones';
const leerLibroGuardado = (): LibroInversiones | null => {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(CLAVE_LIBRO) : null;
    const libro = raw ? (JSON.parse(raw) as LibroInversiones) : null;
    // Un libro guardado por una versión anterior de la página se descarta
    return libro && Array.isArray(libro.cuentas) && Array.isArray(libro.movimientos) && Array.isArray(libro.conciliaciones) ? libro : null;
  } catch {
    return null;
  }
};

const hoyISO = () => new Date().toISOString().slice(0, 10);
const fecha = (f?: string) => (f ? `${f.slice(8, 10)}-${f.slice(5, 7)}-${f.slice(0, 4)}` : '—');
const fmt = (n: number | undefined, moneda: Moneda) => (n === undefined || !Number.isFinite(n) ? '—' : formatoMonto(n, moneda));
const pct = (n?: number) => (n === undefined || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`);
const fmtCantidad = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 8 });
const colorSigno = (n?: number) => (n === undefined ? '' : n >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400');

const NOMBRE_TIPO: Record<TipoMovimiento, string> = {
  COMPRA: 'Compra', VENTA: 'Venta', DIVIDENDO: 'Dividendo', IMPUESTO: 'Impuesto retenido', COMISION: 'Comisión',
  INTERES: 'Interés', APORTE: 'Aporte', RETIRO: 'Retiro', SPLIT: 'Split', CANJE: 'Canje',
  SALDO_INICIAL: 'Saldo previo', NO_INFORMADO: 'Sin detalle',
};

const tarjeta = 'bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-6 shadow-sm dark:shadow-none transition-colors duration-300';
const th = 'px-3 py-2 uppercase tracking-wider';
const td = 'px-3 py-2';

export default function DataWarehouseTab({ onPortfolioUpdate }: DataWarehouseTabProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [libro, setLibro] = useState<LibroInversiones | null>(leerLibroGuardado);
  const [hoy, setHoy] = useState<{ valores: ValorHoy[]; dolar?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [borrarAusentes, setBorrarAusentes] = useState(false);
  const [filtroCuenta, setFiltroCuenta] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [limite, setLimite] = useState(100);
  const { isDemo, isCartolaMode, items, setItems, refreshPortfolio } = usePortfolio();
  const isLocalMode = isDemo || isCartolaMode;

  // Valor de cada cuenta a hoy con los precios de Yahoo (si falla, se queda con el valor de las cartolas)
  const cargarPrecios = async (l: LibroInversiones) => {
    try {
      const simbolos = [...new Set(l.posiciones.map(p => tickerYahoo(p.ticker, p.moneda))), 'CLP=X'];
      const res = await fetch(`/api/portfolio/live?symbols=${encodeURIComponent(simbolos.join(','))}`);
      if (!res.ok) return;
      const precios: Record<string, number> = await res.json();
      const dolar = precios['CLP=X'] ?? l.dolar?.valor;
      setHoy({ valores: valorizarHoy(l, precios, dolar, hoyISO()), dolar });
    } catch {
      setHoy(null);
    }
  };

  useEffect(() => {
    // Al abrir la pestaña con un libro guardado: el estado cambia recién cuando llegan los precios.
    // El resto de las veces se llama al procesar cartolas.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (libro) cargarPrecios(libro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(Array.from(e.target.files));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setIsUploading(true);
    setError(null);
    setSaveMessage(null);
    try {
      // PROCESAR 100% EN EL NAVEGADOR: los PDFs nunca salen de tu computador
      const parsed: ResultadoCartola[] = [];
      for (const file of files) parsed.push(await parsePdfToCartola(file));
      const nuevo = construirLibro(parsed, hoyISO());
      if (nuevo.movimientos.length === 0 && nuevo.posiciones.length === 0) {
        throw new Error('No se encontraron movimientos ni posiciones en las cartolas subidas.');
      }
      setLibro(nuevo);
      setHoy(null);
      setLimite(100);
      try { localStorage.setItem(CLAVE_LIBRO, JSON.stringify(nuevo)); } catch { /* sin espacio o bloqueado: solo se pierde al recargar */ }
      cargarPrecios(nuevo);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Error desconocido al procesar las cartolas en el navegador.');
    } finally {
      setIsUploading(false);
    }
  };

  const borrarLibro = () => {
    setLibro(null);
    setHoy(null);
    try { localStorage.removeItem(CLAVE_LIBRO); } catch { /* nada que borrar */ }
  };

  const posicionesPortafolio = useMemo(() => (libro ? posicionesParaPortafolio(libro) : []), [libro]);
  const importados = new Set(posicionesPortafolio.map(p => p.ticker));
  const ausentes = items.filter(i => !importados.has(i.ticker) && !i.id.startsWith('demo-'));
  const reemplazos = posicionesPortafolio.filter(p => items.some(i => i.ticker === p.ticker)).map(p => p.ticker);

  const guardarEnPortafolio = async () => {
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    const nuevas = posicionesPortafolio.map(({ ticker, cantidad, precio_compra, moneda, purchase_date }) => ({ ticker, cantidad, precio_compra, moneda, purchase_date }));
    const quitar = (i: PortfolioItem) => importados.has(i.ticker) || (borrarAusentes && ausentes.some(a => a.id === i.id));
    try {
      if (isLocalMode) {
        setItems(prev => [...prev.filter(i => !quitar(i)), ...nuevas.map((p): PortfolioItem => ({ id: `cartola-${p.ticker}`, ...p }))]);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` };
        for (const row of items.filter(i => quitar(i) && !i.id.startsWith('cartola-'))) {
          const res = await fetch(`/api/portfolio?id=${encodeURIComponent(row.id)}`, { method: 'DELETE', headers });
          if (!res.ok) throw new Error(`No se pudo reemplazar la posición anterior de ${row.ticker}`);
        }
        for (const p of nuevas) {
          const res = await fetch('/api/portfolio', { method: 'POST', headers, body: JSON.stringify(p) });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(`No se pudo guardar ${p.ticker}: ${body.error || res.statusText}`);
          }
        }
        await refreshPortfolio();
      }
      setSaveMessage(`${nuevas.length} posiciones guardadas en tu portafolio, cada una con su fecha de compra.`);
      if (onPortfolioUpdate) setTimeout(() => onPortfolioUpdate(), 800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar en tu portafolio.');
      if (!isLocalMode) await refreshPortfolio(); // lo que alcanzó a guardarse queda reflejado al recargar
    } finally {
      setSaving(false);
    }
  };

  // Totales en pesos (las cuentas en dólares al dólar de hoy o, si no hay precios, al de la última cartola)
  const totales = useMemo(() => {
    if (!libro) return null;
    const dolar = hoy?.dolar ?? libro.dolar?.valor;
    if (!dolar) return null;
    let invertido = 0, retiros = 0, valor = 0, dividendos = 0, comisiones = 0;
    let completo = true;
    for (const c of libro.cuentas) {
      const aClp = (n: number) => (c.moneda === 'USD' ? n * dolar : n);
      const v = hoy?.valores.find(x => x.cuenta === c.cuenta)?.valor ?? c.valorActual;
      if (v === undefined) { completo = false; continue; }
      invertido += aClp(c.aportes + c.capitalInicial);
      retiros += aClp(c.retiros);
      valor += aClp(v);
      dividendos += aClp(c.dividendos + c.impuestos);
      comisiones += aClp(c.comisiones + c.comisionesIncluidas);
    }
    const ganancia = valor + retiros - invertido;
    return { dolar, invertido, retiros, valor, ganancia, rentabilidad: invertido > 0 ? ganancia / invertido : undefined, dividendos, comisiones, completo };
  }, [libro, hoy]);

  const movimientosFiltrados = useMemo(() => {
    if (!libro) return [];
    const texto = filtroTexto.trim().toUpperCase();
    return libro.movimientos
      .filter(m => (!filtroCuenta || m.cuenta === filtroCuenta) && (!filtroTipo || m.tipo === filtroTipo)
        && (!texto || (m.ticker ?? '').includes(texto) || m.detalle.toUpperCase().includes(texto)))
      .slice()
      .reverse();
  }, [libro, filtroCuenta, filtroTipo, filtroTexto]);

  const alertasPorNivel = (nivel: string) => libro?.alertas.filter(a => a.nivel === nivel) ?? [];
  const cuadran = libro?.conciliaciones.filter(c => c.ok).length ?? 0;

  return (
    <div className="space-y-6 fade-in">
      {/* HEADER */}
      <div className={`${tarjeta} relative overflow-hidden`}>
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Database className="w-32 h-32 text-orange-500" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-orange-100 dark:bg-orange-500/20 p-2 rounded-lg text-orange-600 dark:text-orange-400">
              <Database className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa]">MOTOR DE CARTOLAS</h2>
          </div>
          <p className="text-sm font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider">
            Racional (USD y CLP) · Zesty · BTG Pactual · XTB · Fintual
          </p>
        </div>
      </div>

      {/* UPLOAD */}
      <div className={tarjeta}>
        <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-zinc-300 dark:border-[#3f3f46] rounded-xl bg-zinc-50 dark:bg-[#09090b] hover:bg-zinc-100 dark:hover:bg-[#18181b] transition-colors relative">
          <UploadCloud className="w-12 h-12 text-zinc-400 dark:text-[#71717a] mb-4" />
          <h3 className="text-lg font-bold text-zinc-900 dark:text-[#e4e4e7] mb-2 font-sans">Sube todas tus cartolas en PDF</h3>
          <p className="text-xs font-mono text-zinc-500 dark:text-[#a1a1aa] mb-6 text-center max-w-lg">
            Todas juntas, de todos los brokers y todos los meses: así se arma el historial completo, se detectan las que faltan y los duplicados se cuentan una sola vez. Se procesan en tu navegador; los PDFs no se suben a ningún servidor.
          </p>
          <input type="file" multiple accept=".pdf" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
          <button className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-2 rounded-lg font-mono text-sm font-bold shadow-sm pointer-events-none">
            SELECCIONAR ARCHIVOS
          </button>
        </div>

        {files.length > 0 && (
          <div className="mt-6">
            <h4 className="text-xs font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Archivos preparados ({files.length})
            </h4>
            <div className="flex flex-wrap gap-2 mb-6 max-h-40 overflow-y-auto">
              {files.map((f, i) => (
                <div key={i} className="bg-zinc-100 dark:bg-[#27272a] border border-zinc-200 dark:border-[#3f3f46] text-zinc-700 dark:text-[#e4e4e7] px-3 py-1.5 rounded text-xs font-mono flex items-center gap-2">
                  <span className="truncate max-w-[200px]">{f.name}</span>
                  <span className="text-zinc-400 dark:text-[#71717a]">{(f.size / 1024).toFixed(0)} KB</span>
                </div>
              ))}
            </div>
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-mono font-bold text-sm py-3 rounded-lg shadow transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isUploading ? 'Procesando en tu navegador...' : '🚀 PROCESAR CARTOLAS'}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-6 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg text-sm font-mono border border-red-200 dark:border-red-900/50 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {libro && (
        <>
          {/* CÓMO VAS */}
          <div className={tarjeta}>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-[#e4e4e7] font-sans">Cómo vas</h3>
                <p className="text-xs font-mono text-zinc-500 dark:text-[#a1a1aa]">
                  Ganancia = valor + retiros − lo que pusiste (aportes y lo que ya había antes de la primera cartola).
                  {hoy ? ` Valor a hoy con precios de mercado; dólar $${hoy.dolar?.toLocaleString('es-CL', { maximumFractionDigits: 2 })}.` : ' Valor según la última cartola de cada cuenta.'}
                </p>
              </div>
              <button onClick={borrarLibro} className="text-xs font-mono text-zinc-500 hover:text-red-500 flex items-center gap-1 border border-zinc-200 dark:border-[#27272a] rounded px-2 py-1">
                <Trash2 className="w-3.5 h-3.5" /> Borrar de este navegador
              </button>
            </div>

            {totales && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                {[
                  ['Pusiste', fmt(totales.invertido, 'CLP'), ''],
                  ['Retiraste', fmt(totales.retiros, 'CLP'), ''],
                  ['Valor', fmt(totales.valor, 'CLP'), ''],
                  ['Ganancia', fmt(totales.ganancia, 'CLP'), colorSigno(totales.ganancia)],
                  ['Rentabilidad', pct(totales.rentabilidad), colorSigno(totales.rentabilidad)],
                ].map(([titulo, valor, color]) => (
                  <div key={titulo} className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded-lg p-3">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-[#a1a1aa]">{titulo}</div>
                    <div className={`text-lg font-bold font-mono ${color || 'text-zinc-900 dark:text-[#fafafa]'}`}>{valor}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-x-auto border border-zinc-200 dark:border-[#27272a] rounded-lg">
              <table className="w-full text-left font-mono text-xs whitespace-nowrap">
                <thead className="bg-zinc-100 dark:bg-[#09090b] text-zinc-500 dark:text-[#a1a1aa]">
                  <tr>
                    <th className={th}>Cuenta</th>
                    <th className={th}>Período</th>
                    <th className={`${th} text-right`}>Pusiste</th>
                    <th className={`${th} text-right`}>Retiros</th>
                    <th className={`${th} text-right`}>Dividendos netos</th>
                    <th className={`${th} text-right`}>Comisiones</th>
                    <th className={`${th} text-right`}>Valor cartola</th>
                    <th className={`${th} text-right`}>Valor hoy</th>
                    <th className={`${th} text-right`}>Ganancia</th>
                    <th className={`${th} text-right`}>Rentab.</th>
                    <th className={`${th} text-right`} title="Tasa interna de retorno anual (solo con más de un año de historia)">TIR anual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a] text-zinc-700 dark:text-[#e4e4e7]">
                  {libro.cuentas.map(c => {
                    const v = hoy?.valores.find(x => x.cuenta === c.cuenta);
                    const ganancia = v?.ganancia ?? c.ganancia;
                    const rentab = v?.rentabilidad ?? c.rentabilidad;
                    return (
                      <tr key={c.cuenta}>
                        <td className={`${td} font-bold`}>{c.cuenta}<span className="block font-normal text-[10px] text-zinc-400">{c.cartolas} cartola{c.cartolas === 1 ? '' : 's'}</span></td>
                        <td className={td}>{fecha(c.desde)} → {fecha(c.hasta)}</td>
                        <td className={`${td} text-right`} title={c.capitalInicial ? `Incluye ${fmt(c.capitalInicial, c.moneda)} que ya había antes de la primera cartola` : undefined}>
                          {fmt(c.aportes + c.capitalInicial, c.moneda)}{c.capitalInicial > 0 && <span className="text-amber-500">*</span>}
                          {c.aportesImplicitos > 0 && <span className="block text-[10px] text-zinc-400">deducidos de las compras</span>}
                        </td>
                        <td className={`${td} text-right`}>{fmt(c.retiros, c.moneda)}</td>
                        <td className={`${td} text-right`}>{fmt(c.dividendos + c.impuestos, c.moneda)}</td>
                        <td className={`${td} text-right`}>{fmt(c.comisiones + c.comisionesIncluidas, c.moneda)}</td>
                        <td className={`${td} text-right`}>{fmt(c.valorActual, c.moneda)}<span className="block text-[10px] text-zinc-400">{c.fechaValor ? fecha(c.fechaValor) : 'sin valor en cartola'}</span></td>
                        <td className={`${td} text-right`}>{fmt(v?.valor, c.moneda)}</td>
                        <td className={`${td} text-right font-bold ${colorSigno(ganancia)}`}>{fmt(ganancia, c.moneda)}</td>
                        <td className={`${td} text-right ${colorSigno(rentab)}`}>{pct(rentab)}</td>
                        <td className={`${td} text-right`}>{pct(v?.tir ?? c.tir)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totales && !totales.completo && (
              <p className="mt-2 text-[11px] font-mono text-zinc-500 dark:text-[#a1a1aa]">
                Los totales no incluyen las cuentas sin valor (sin precios de mercado ni valor en la cartola).
              </p>
            )}
            {libro.cuentas.some(c => c.capitalInicial > 0) && (
              <p className="mt-2 text-[11px] font-mono text-zinc-500 dark:text-[#a1a1aa]">
                <span className="text-amber-500">*</span> Incluye lo que ya había en la cuenta al inicio de la primera cartola (valorizado por el broker a esa fecha), porque faltan las cartolas anteriores.
              </p>
            )}
          </div>

          {/* ALERTAS */}
          <div className={tarjeta}>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-[#e4e4e7] mb-4 font-sans">Revisión de las cartolas</h3>
            <div className="space-y-3 text-xs font-mono">
              {alertasPorNivel('error').map((a, i) => (
                <p key={`e${i}`} className="flex gap-2 text-red-700 dark:text-red-400"><AlertCircle className="w-4 h-4 flex-shrink-0" />{a.texto}</p>
              ))}
              {alertasPorNivel('faltante').map((a, i) => (
                <p key={`f${i}`} className="flex gap-2 text-amber-700 dark:text-amber-400"><AlertTriangle className="w-4 h-4 flex-shrink-0" />{a.texto}</p>
              ))}
              {libro.duplicados.map((d, i) => (
                <p key={`d${i}`} className="flex gap-2 text-sky-700 dark:text-sky-400"><Copy className="w-4 h-4 flex-shrink-0" />{d.texto}</p>
              ))}
              {[...alertasPorNivel('aviso'), ...alertasPorNivel('info')].map((a, i) => (
                <p key={`a${i}`} className="flex gap-2 text-zinc-600 dark:text-[#a1a1aa]"><Info className="w-4 h-4 flex-shrink-0" />{a.texto}</p>
              ))}
              {libro.alertas.length === 0 && libro.duplicados.length === 0 && (
                <p className="flex gap-2 text-emerald-700 dark:text-emerald-400"><CheckCircle className="w-4 h-4" />No falta ninguna cartola y no hay duplicados.</p>
              )}
              {libro.duplicados.length === 0 && libro.alertas.length > 0 && (
                <p className="flex gap-2 text-emerald-700 dark:text-emerald-400"><CheckCircle className="w-4 h-4" />No se encontraron cartolas ni movimientos duplicados.</p>
              )}
            </div>
            {libro.conciliaciones.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-mono font-bold text-zinc-700 dark:text-[#e4e4e7]">
                  Cuadratura mes a mes: {cuadran} de {libro.conciliaciones.length} cartolas cuadran con los movimientos
                </summary>
                <ul className="mt-2 space-y-1 text-[11px] font-mono text-zinc-600 dark:text-[#a1a1aa]">
                  {libro.conciliaciones.map((c, i) => (
                    <li key={i}>{c.ok ? '✅' : '❌'} {c.cuenta} al {fecha(c.fecha)}{c.ok ? '' : `: ${c.diferencias.join(' ')}`}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* POSICIONES */}
          <div className={tarjeta}>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-[#e4e4e7] mb-2 font-sans flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" /> Posiciones actuales ({libro.posiciones.length})
            </h3>
            <p className="text-xs font-mono text-zinc-500 dark:text-[#a1a1aa] mb-4">
              Costo promedio ponderado. &quot;Desde&quot; es la fecha de la primera compra de la posición que tienes hoy (si vendiste todo y volviste a comprar, cuenta desde la nueva compra).
            </p>
            <div className="overflow-x-auto border border-zinc-200 dark:border-[#27272a] rounded-lg">
              <table className="w-full text-left font-mono text-xs whitespace-nowrap">
                <thead className="bg-zinc-100 dark:bg-[#09090b] text-zinc-500 dark:text-[#a1a1aa]">
                  <tr>
                    <th className={th}>Cuenta</th>
                    <th className={th}>Activo</th>
                    <th className={`${th} text-right`}>Cantidad</th>
                    <th className={`${th} text-right`}>Costo prom.</th>
                    <th className={`${th} text-right`}>Costo total</th>
                    <th className={th}>Desde</th>
                    <th className={`${th} text-right`}>Compras</th>
                    <th className={`${th} text-right`}>Dividendos</th>
                    <th className={`${th} text-right`}>Valor cartola</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a] text-zinc-700 dark:text-[#e4e4e7]">
                  {libro.posiciones.map(p => (
                    <tr key={`${p.cuenta}-${p.ticker}`}>
                      <td className={td}>{p.cuenta}</td>
                      <td className={`${td} font-bold`}>{p.ticker}</td>
                      <td className={`${td} text-right`}>{fmtCantidad(p.cantidad)}</td>
                      <td className={`${td} text-right`}>{p.costo !== undefined ? fmt(p.costo / p.cantidad, p.moneda) : 'no informado'}</td>
                      <td className={`${td} text-right`}>{fmt(p.costo, p.moneda)}</td>
                      <td className={td}>{p.fechaCompraAproximada ? <span className="text-amber-600 dark:text-amber-400" title="La compra es anterior a la primera cartola de esta cuenta">{fecha(p.fechaCompra)} o antes</span> : fecha(p.fechaCompra)}</td>
                      <td className={`${td} text-right`} title={p.compras.map(c => `${fecha(c.fecha)}: ${fmtCantidad(c.cantidad)} a ${fmt(c.precio, p.moneda)}`).join('\n')}>{p.compras.length || '—'}</td>
                      <td className={`${td} text-right`}>{p.dividendos ? fmt(p.dividendos, p.monedaDividendos) : '—'}</td>
                      <td className={`${td} text-right`}>{fmt(p.valor, p.moneda)}{p.fechaPrecio && <span className="block text-[10px] text-zinc-400">{fecha(p.fechaPrecio)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Guardar en el portafolio */}
            <div className="mt-6 space-y-3">
              {reemplazos.length > 0 && (
                <p className="text-xs font-mono text-amber-700 dark:text-amber-400">
                  Al guardar se reemplazarán tus posiciones actuales de: {reemplazos.join(', ')}.
                </p>
              )}
              {ausentes.length > 0 && (
                <label className="flex items-start gap-2 text-xs font-mono text-zinc-600 dark:text-[#a1a1aa]">
                  <input type="checkbox" checked={borrarAusentes} onChange={e => setBorrarAusentes(e.target.checked)} className="mt-0.5" />
                  <span>Quitar también de mi portafolio lo que no está en ninguna cartola ({ausentes.map(a => a.ticker).join(', ')}): márcalo si ya lo vendiste.</span>
                </label>
              )}
              {posicionesPortafolio.some(p => p.costoEstimado) && (
                <p className="text-xs font-mono text-zinc-500 dark:text-[#a1a1aa]">
                  Sin costo de compra en la cartola ({posicionesPortafolio.filter(p => p.costoEstimado).map(p => p.ticker).join(', ')}): se guarda con el precio de mercado de la cartola como costo.
                </p>
              )}
              <button
                onClick={guardarEnPortafolio}
                disabled={saving || posicionesPortafolio.length === 0}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-mono font-bold text-sm py-3 rounded-lg shadow transition-colors disabled:opacity-50"
              >
                {saving ? 'GUARDANDO...' : `💾 GUARDAR ${posicionesPortafolio.length} POSICIONES EN MI PORTAFOLIO`}
              </button>
              {saveMessage && <p className="text-sm font-mono text-emerald-600 dark:text-emerald-400 text-center">{saveMessage}</p>}
            </div>
          </div>

          {/* MOVIMIENTOS */}
          <div className={tarjeta}>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-[#e4e4e7] mb-2 font-sans">Libro de movimientos ({libro.movimientos.length})</h3>
            <p className="text-xs font-mono text-zinc-500 dark:text-[#a1a1aa] mb-4">
              Todo lo que dicen las cartolas, con fecha: compras, ventas, dividendos, impuestos retenidos, comisiones, aportes y retiros. Lo marcado como &quot;deducido&quot; no viene como línea propia en la cartola.
            </p>
            <div className="flex flex-wrap gap-2 mb-4 text-xs font-mono">
              <select value={filtroCuenta} onChange={e => { setFiltroCuenta(e.target.value); setLimite(100); }} className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded px-2 py-1.5 text-zinc-700 dark:text-[#e4e4e7]">
                <option value="">Todas las cuentas</option>
                {libro.cuentas.map(c => <option key={c.cuenta} value={c.cuenta}>{c.cuenta}</option>)}
              </select>
              <select value={filtroTipo} onChange={e => { setFiltroTipo(e.target.value); setLimite(100); }} className="bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded px-2 py-1.5 text-zinc-700 dark:text-[#e4e4e7]">
                <option value="">Todos los tipos</option>
                {(Object.keys(NOMBRE_TIPO) as TipoMovimiento[]).filter(t => libro.movimientos.some(m => m.tipo === t)).map(t => <option key={t} value={t}>{NOMBRE_TIPO[t]}</option>)}
              </select>
              <input value={filtroTexto} onChange={e => { setFiltroTexto(e.target.value); setLimite(100); }} placeholder="Buscar activo o glosa" className="flex-1 min-w-[160px] bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-[#27272a] rounded px-2 py-1.5 text-zinc-700 dark:text-[#e4e4e7]" />
            </div>
            <div className="overflow-x-auto border border-zinc-200 dark:border-[#27272a] rounded-lg">
              <table className="w-full text-left font-mono text-xs whitespace-nowrap">
                <thead className="bg-zinc-100 dark:bg-[#09090b] text-zinc-500 dark:text-[#a1a1aa]">
                  <tr>
                    <th className={th}>Fecha</th>
                    <th className={th}>Cuenta</th>
                    <th className={th}>Tipo</th>
                    <th className={th}>Activo</th>
                    <th className={`${th} text-right`}>Cantidad</th>
                    <th className={`${th} text-right`}>Precio</th>
                    <th className={`${th} text-right`}>Monto</th>
                    <th className={th}>Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a] text-zinc-700 dark:text-[#e4e4e7]">
                  {movimientosFiltrados.slice(0, limite).map(m => {
                    const monto = m.montoIncluido ?? m.monto;
                    return (
                      <tr key={m.id} className="hover:bg-zinc-50 dark:hover:bg-[#09090b]">
                        <td className={td}>{fecha(m.fecha)}{m.fechaLiquidacion && m.fechaLiquidacion !== m.fecha && <span className="block text-[10px] text-zinc-400">liq. {fecha(m.fechaLiquidacion)}</span>}</td>
                        <td className={td}>{m.cuenta}</td>
                        <td className={td}>{NOMBRE_TIPO[m.tipo]}{m.implicito && <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">deducido</span>}</td>
                        <td className={`${td} font-bold`}>{m.ticker ?? ''}</td>
                        <td className={`${td} text-right`}>{m.cantidad !== undefined ? fmtCantidad(m.cantidad) : ''}</td>
                        <td className={`${td} text-right`}>{m.precio !== undefined && m.tipo !== 'SPLIT' ? fmt(m.precio, m.moneda) : ''}</td>
                        <td className={`${td} text-right ${colorSigno(monto || undefined)}`}>{monto ? fmt(monto, m.moneda) : ''}</td>
                        <td className={`${td} max-w-[420px] truncate`} title={`${m.detalle}\n${m.archivo}`}>{m.detalle}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {movimientosFiltrados.length > limite && (
              <button onClick={() => setLimite(l => l + 200)} className="mt-3 w-full text-xs font-mono text-zinc-600 dark:text-[#a1a1aa] border border-zinc-200 dark:border-[#27272a] rounded py-2 hover:bg-zinc-50 dark:hover:bg-[#09090b]">
                Mostrar más ({movimientosFiltrados.length - limite} restantes)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
