import React, { useState } from 'react';
import { UploadCloud, FileText, CheckCircle, AlertCircle, Database } from 'lucide-react';
import { usePortfolio, type PortfolioItem } from '../context/PortfolioContext';
import { parsePdfToCartola, consolidarCartolas, type ResultadoCartola, type PosicionConsolidada } from '@/lib/CartolaParser';
import { supabase } from '@/lib/supabase';

interface DataWarehouseTabProps {
  onPortfolioUpdate?: () => void;
}

const fmtCantidad = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 8 });
const fmtPrecio = (n: number, moneda: string) => moneda === 'CLP'
  ? `$${n.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`
  : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export default function DataWarehouseTab({ onPortfolioUpdate }: DataWarehouseTabProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [results, setResults] = useState<ResultadoCartola[]>([]);
  const [posiciones, setPosiciones] = useState<PosicionConsolidada[]>([]);
  const [duplicadas, setDuplicadas] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const { isDemo, isCartolaMode, items, setItems, refreshPortfolio } = usePortfolio();
  const isLocalMode = isDemo || isCartolaMode;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  // Reemplaza en el estado local las posiciones de los tickers importados; el resto se mantiene
  const aplicarLocalmente = (nuevas: PosicionConsolidada[]) => {
    const importados = new Set(nuevas.map(p => p.ticker));
    setItems(prev => [
      ...prev.filter(i => !importados.has(i.ticker)),
      ...nuevas.map((p): PortfolioItem => ({ id: `cartola-${p.ticker}`, ...p })),
    ]);
    if (onPortfolioUpdate) setTimeout(() => onPortfolioUpdate(), 800);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    setError(null);
    setSaveMessage(null);
    setResults([]);
    setPosiciones([]);

    try {
      // PROCESAR 100% EN EL NAVEGADOR: los PDFs nunca salen de tu computador
      const parsed: ResultadoCartola[] = [];
      for (const file of files) {
        parsed.push(await parsePdfToCartola(file));
      }
      setResults(parsed);

      const { posiciones: nuevas, duplicadas: dup } = consolidarCartolas(parsed);
      setDuplicadas(dup);
      if (nuevas.length === 0) {
        throw new Error('No se encontraron operaciones ni posiciones reconocidas en las cartolas subidas.');
      }
      setPosiciones(nuevas);

      if (isLocalMode) aplicarLocalmente(nuevas);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Error desconocido al procesar el PDF en el navegador.');
    } finally {
      setIsUploading(false);
    }
  };

  // Usuario con cuenta: reemplaza en Supabase las filas de los tickers importados
  const guardarEnPortafolio = async () => {
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` };

      const importados = new Set(posiciones.map(p => p.ticker));
      const filasDb = items.filter(i => importados.has(i.ticker) && !i.id.startsWith('cartola-') && !i.id.startsWith('demo-'));
      for (const row of filasDb) {
        const res = await fetch(`/api/portfolio?id=${encodeURIComponent(row.id)}`, { method: 'DELETE', headers });
        if (!res.ok) throw new Error(`No se pudo reemplazar la posición anterior de ${row.ticker}`);
      }
      for (const p of posiciones) {
        const res = await fetch('/api/portfolio', { method: 'POST', headers, body: JSON.stringify(p) });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(`No se pudo guardar ${p.ticker}: ${body.error || res.statusText}`);
        }
      }
      await refreshPortfolio();
      setSaveMessage(`${posiciones.length} posiciones guardadas en tu portafolio.`);
      if (onPortfolioUpdate) setTimeout(() => onPortfolioUpdate(), 800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar en tu portafolio.');
      // Lo que alcanzó a guardarse queda reflejado al recargar
      await refreshPortfolio();
    } finally {
      setSaving(false);
    }
  };

  const ilegibles = results.filter(r => r.sinTexto);
  const desconocidos = results.filter(r => !r.sinTexto && r.broker === 'Desconocido');
  const tickersExistentes = new Set(items.map(i => i.ticker));
  const reemplazos = posiciones.filter(p => tickersExistentes.has(p.ticker)).map(p => p.ticker);

  return (
    <div className="space-y-6 fade-in">
      {/* HEADER SECTION */}
      <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-6 shadow-sm dark:shadow-none relative overflow-hidden transition-colors duration-300">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Database className="w-32 h-32 text-orange-500" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-orange-100 dark:bg-orange-500/20 p-2 rounded-lg text-orange-600 dark:text-orange-400">
              <Database className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold font-sans text-zinc-900 dark:text-[#fafafa]">
              MOTOR DE CARTOLAS
            </h2>
          </div>
          <p className="text-sm font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider">
            Racional (EE.UU. y Chile) · Fintual
          </p>
        </div>
      </div>

      {/* UPLOAD SECTION */}
      <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-6 shadow-sm dark:shadow-none transition-colors duration-300">
        <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-zinc-300 dark:border-[#3f3f46] rounded-xl bg-zinc-50 dark:bg-[#09090b] hover:bg-zinc-100 dark:hover:bg-[#18181b] transition-colors relative">
          <UploadCloud className="w-12 h-12 text-zinc-400 dark:text-[#71717a] mb-4" />
          <h3 className="text-lg font-bold text-zinc-900 dark:text-[#e4e4e7] mb-2 font-sans">
            Sube tus cartolas de brokers en PDF
          </h3>
          <p className="text-xs font-mono text-zinc-500 dark:text-[#a1a1aa] mb-6 text-center max-w-md">
            Selecciona todas tus cartolas juntas (puedes repetir archivos: los duplicados se ignoran). Se procesan en tu navegador; los PDFs no se suben a ningún servidor.
          </p>

          <input
            type="file"
            multiple
            accept=".pdf"
            onChange={handleFileChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />

          <button className="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-2 rounded-lg font-mono text-sm font-bold shadow-sm pointer-events-none">
            SELECCIONAR ARCHIVOS
          </button>
        </div>

        {files.length > 0 && (
          <div className="mt-6">
            <h4 className="text-xs font-mono text-zinc-500 dark:text-[#a1a1aa] uppercase tracking-wider mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Archivos Preparados ({files.length})
            </h4>
            <div className="flex flex-wrap gap-2 mb-6">
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
              {isUploading ? (
                <>Procesando en tu navegador...</>
              ) : (
                <>🚀 PROCESAR CARTOLAS</>
              )}
            </button>
          </div>
        )}

        {error && (
          <div className="mt-6 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg text-sm font-mono border border-red-200 dark:border-red-900/50 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {(ilegibles.length > 0 || desconocidos.length > 0 || duplicadas > 0) && (
          <div className="mt-6 bg-amber-50 dark:bg-amber-900/10 text-amber-800 dark:text-amber-300 p-4 rounded-lg text-xs font-mono border border-amber-200 dark:border-amber-900/50 space-y-1">
            {ilegibles.map(r => <p key={r.file_name}>⚠️ {r.file_name}: el PDF no tiene texto (parece escaneado), no se pudo leer.</p>)}
            {desconocidos.map(r => <p key={r.file_name}>⚠️ {r.file_name}: broker no soportado todavía, se omitió.</p>)}
            {duplicadas > 0 && <p>ℹ️ Se ignoraron {duplicadas} operaciones repetidas en archivos duplicados.</p>}
          </div>
        )}
      </div>

      {/* CONSOLIDATED POSITIONS */}
      {posiciones.length > 0 && (
        <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-6 shadow-sm dark:shadow-none transition-colors duration-300">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-[#e4e4e7] mb-2 font-sans flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-500" /> Posiciones Consolidadas ({posiciones.length})
          </h3>
          <p className="text-xs font-mono text-zinc-500 dark:text-[#a1a1aa] mb-4">
            Compras menos ventas con costo promedio ponderado. En Racional Chile se usa la foto de cartera del estado de cuenta más reciente.
          </p>

          <div className="overflow-x-auto border border-zinc-200 dark:border-[#27272a] rounded-lg">
            <table className="w-full text-left font-mono text-xs whitespace-nowrap">
              <thead className="bg-zinc-100 dark:bg-[#09090b] text-zinc-500 dark:text-[#a1a1aa] uppercase">
                <tr>
                  <th className="px-4 py-2">Ticker</th>
                  <th className="px-4 py-2 text-right">Cantidad</th>
                  <th className="px-4 py-2 text-right">Precio Promedio</th>
                  <th className="px-4 py-2">Moneda</th>
                  <th className="px-4 py-2">Desde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a] text-zinc-700 dark:text-[#e4e4e7]">
                {posiciones.map(p => (
                  <tr key={p.ticker}>
                    <td className="px-4 py-2 font-bold">{p.ticker}</td>
                    <td className="px-4 py-2 text-right">{fmtCantidad(p.cantidad)}</td>
                    <td className="px-4 py-2 text-right">{fmtPrecio(p.precio_compra, p.moneda)}</td>
                    <td className="px-4 py-2">{p.moneda}</td>
                    <td className="px-4 py-2">{p.purchase_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isLocalMode ? (
            <div className="mt-6 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/50 p-4 rounded-lg text-center">
              <span className="text-emerald-600 dark:text-emerald-400 font-bold font-sans block mb-1">
                ¡Posiciones importadas!
              </span>
              <span className="text-xs text-emerald-700 dark:text-emerald-500 font-mono">
                Ve a la pestaña [01] Mi Portafolio para ver tus activos y P&L en vivo.
              </span>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {reemplazos.length > 0 && (
                <p className="text-xs font-mono text-amber-700 dark:text-amber-400">
                  Al guardar se reemplazarán tus posiciones actuales de: {reemplazos.join(', ')}.
                </p>
              )}
              <button
                onClick={guardarEnPortafolio}
                disabled={saving}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-mono font-bold text-sm py-3 rounded-lg shadow transition-colors disabled:opacity-50"
              >
                {saving ? 'GUARDANDO...' : '💾 GUARDAR EN MI PORTAFOLIO'}
              </button>
              {saveMessage && (
                <p className="text-sm font-mono text-emerald-600 dark:text-emerald-400 text-center">{saveMessage}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* RAW RESULTS PER FILE */}
      {results.some(r => r.data.length > 0) && (
        <details className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-6 shadow-sm dark:shadow-none transition-colors duration-300">
          <summary className="cursor-pointer text-sm font-bold text-zinc-900 dark:text-[#e4e4e7] font-sans">
            Ver operaciones extraídas por archivo
          </summary>
          <div className="space-y-8 mt-6">
            {results.filter(r => r.data.length > 0).map((result, idx) => (
              <div key={idx} className="border border-zinc-200 dark:border-[#27272a] rounded-lg overflow-hidden">
                <div className="bg-zinc-50 dark:bg-[#09090b] border-b border-zinc-200 dark:border-[#27272a] px-4 py-3 flex justify-between items-center gap-4">
                  <div className="font-mono text-sm font-bold text-zinc-900 dark:text-[#e4e4e7]">
                    Broker: <span className="text-orange-600 dark:text-orange-400">{result.broker}</span>
                  </div>
                  <div className="font-mono text-xs text-zinc-500 dark:text-[#71717a] truncate">
                    {result.file_name} ({result.data.length} operaciones)
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs whitespace-nowrap">
                    <thead className="bg-zinc-100 dark:bg-[#18181b] text-zinc-500 dark:text-[#a1a1aa] border-b border-zinc-200 dark:border-[#27272a]">
                      <tr>
                        {['Fecha', 'Tipo', 'Ticker', 'Cantidad', 'Precio', 'Moneda'].map(col => (
                          <th key={col} className="px-4 py-2 uppercase tracking-wider">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a] text-zinc-700 dark:text-[#e4e4e7]">
                      {result.data.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-zinc-50 dark:hover:bg-[#09090b]">
                          <td className="px-4 py-2">{row.Fecha}</td>
                          <td className="px-4 py-2">{row.Tipo}</td>
                          <td className="px-4 py-2 font-bold">{row.Ticker}</td>
                          <td className="px-4 py-2">{fmtCantidad(row.Cantidad)}</td>
                          <td className="px-4 py-2">{fmtPrecio(row.Precio, row.Moneda)}</td>
                          <td className="px-4 py-2">{row.Moneda}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
