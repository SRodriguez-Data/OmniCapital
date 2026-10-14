'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import TopIdeasV2 from './TopIdeasV2';
import type { Candidato, Historiales } from './topFormato';

interface Escaneo { fecha: string; us: Candidato[]; cl: Candidato[]; historial: Historiales | null }

export default function TopOportunidadesTab() {
  const [escaneo, setEscaneo] = useState<Escaneo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // El último escaneo del bot (GitHub Actions) es público: también se muestra en modo demo. Solo las ideas y
        // su historial: la tabla de calidad de todo el S&P 500 que va en el mismo escaneo la usa el asesor
        const { data, error } = await supabase
          .from('analisis_ia')
          .select('fecha, metodo:candidatos_json->metodo, us:candidatos_json->us, cl:candidatos_json->cl, historial:candidatos_json->historial')
          .order('fecha', { ascending: false })
          .limit(1);
        const fila = data?.[0] as { fecha: string; metodo?: string; us?: Candidato[]; cl?: Candidato[]; historial?: Historiales } | undefined;
        if (!error && fila?.metodo === 'v2') {
          setEscaneo({ fecha: fila.fecha, us: fila.us ?? [], cl: fila.cl ?? [], historial: fila.historial ?? null });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-center p-12 font-mono text-zinc-600 dark:text-[#a1a1aa]">Cargando las ideas del último escaneo...</div>;

  if (!escaneo) {
    return (
      <div className="text-center p-12 bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl max-w-4xl mx-auto">
        <AlertTriangle className="w-8 h-8 text-[#f59e0b] mx-auto mb-4" />
        <h3 className="text-lg font-sans font-bold tracking-tight text-zinc-900 dark:text-[#e4e4e7] mb-2">Aún no hay ideas generadas</h3>
        <p className="text-sm font-sans text-zinc-600 dark:text-[#a1a1aa]">El escaneo diario corre de madrugada. Vuelve en un momento.</p>
      </div>
    );
  }

  return <TopIdeasV2 us={escaneo.us} cl={escaneo.cl} historial={escaneo.historial} fecha={escaneo.fecha} />;
}
