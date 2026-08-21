import React, { useState } from 'react';
import { UploadCloud, FileText, CheckCircle, AlertCircle, Database } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';
import { parsePdfToCartola } from '@/lib/CartolaParser';

interface DataWarehouseTabProps {
  onPortfolioUpdate?: () => void;
}

export default function DataWarehouseTab({ onPortfolioUpdate }: DataWarehouseTabProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { isCartolaMode, setItems } = usePortfolio();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    setError(null);
    setResults([]);

    try {
      // PROCESAR 100% EN EL NAVEGADOR
      const extractedResults = [];
      for (const file of files) {
        const res = await parsePdfToCartola(file);
        if (res.data.length > 0) {
           extractedResults.push(res);
        }
      }

      if (extractedResults.length === 0) {
        throw new Error('No se encontraron operaciones reconocidas en las cartolas subidas.');
      }

      setResults(extractedResults);

      // Si estamos en Modo Cartola, auto-poblar el portafolio con los resultados extraídos!
      if (isCartolaMode && extractedResults.length > 0) {
        const newItems: any[] = [];
        extractedResults.forEach((res: any) => {
          if (res.data && Array.isArray(res.data)) {
            res.data.forEach((row: any) => {
              if (row.Tipo?.toUpperCase() === 'COMPRA' || row.Tipo?.toUpperCase() === 'BUY') {
                newItems.push({
                  id: `cartola-${Math.random().toString(36).substr(2, 9)}`,
                  ticker: row.Ticker || 'UNKNOWN',
                  cantidad: Number(row.Cantidad) || 1,
                  precio_compra: Number(row.Precio) || 0,
                  moneda: row.Moneda || (row.Precio > 1000 ? 'CLP' : 'USD'),
                  purchase_date: row.Fecha || new Date().toISOString().split('T')[0]
                });
              }
            });
          }
        });
        
        if (newItems.length > 0) {
          setItems(prev => {
            const updated = [...prev, ...newItems];
            if (onPortfolioUpdate) {
              setTimeout(() => onPortfolioUpdate(), 500);
            }
            return updated;
          });
        }
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error desconocido al procesar el PDF en el navegador.');
    } finally {
      setIsUploading(false);
    }
  };

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
            Ingestión de Datos Multi-Broker Institucional
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
            Selecciona múltiples archivos. El motor local OCR y Regex extraerá automáticamente todas tus operaciones financieras.
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
                <>Procesando en Servidor Local...</>
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
      </div>

      {/* RESULTS SECTION */}
      {results.length > 0 && (
        <div className="bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-6 shadow-sm dark:shadow-none transition-colors duration-300">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-[#e4e4e7] mb-6 font-sans flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-500" /> Resultados de Extracción
          </h3>
          
          {isCartolaMode && (
            <div className="mb-6 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/50 p-4 rounded-lg flex flex-col items-center justify-center text-center">
              <span className="text-emerald-600 dark:text-emerald-400 font-bold mb-2 font-sans">
                ¡Operaciones importadas exitosamente!
              </span>
              <span className="text-xs text-emerald-700 dark:text-emerald-500 font-mono">
                Ve a la pestaña [01] Mi Portafolio para ver tus activos y P&L en vivo.
              </span>
            </div>
          )}

          <div className="space-y-8">
            {results.map((result, idx) => (
              <div key={idx} className="border border-zinc-200 dark:border-[#27272a] rounded-lg overflow-hidden">
                <div className="bg-zinc-50 dark:bg-[#09090b] border-b border-zinc-200 dark:border-[#27272a] px-4 py-3 flex justify-between items-center">
                  <div className="font-mono text-sm font-bold text-zinc-900 dark:text-[#e4e4e7]">
                    Broker: <span className="text-orange-600 dark:text-orange-400">{result.broker}</span>
                  </div>
                  <div className="font-mono text-xs text-zinc-500 dark:text-[#71717a]">
                    {result.file_name} ({result.data.length} operaciones)
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs whitespace-nowrap">
                    <thead className="bg-zinc-100 dark:bg-[#18181b] text-zinc-500 dark:text-[#a1a1aa] border-b border-zinc-200 dark:border-[#27272a]">
                      <tr>
                        {result.data.length > 0 && Object.keys(result.data[0]).map((col) => (
                          <th key={col} className="px-4 py-2 uppercase tracking-wider">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-[#27272a] text-zinc-700 dark:text-[#e4e4e7]">
                      {result.data.map((row: any, rIdx: number) => (
                        <tr key={rIdx} className="hover:bg-zinc-50 dark:hover:bg-[#09090b]">
                          {Object.values(row).map((val: any, cIdx: number) => (
                            <td key={cIdx} className="px-4 py-2">{String(val)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
