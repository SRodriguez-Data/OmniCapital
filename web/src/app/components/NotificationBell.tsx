'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { SUAVE } from './Movimiento';

interface Alert {
  id: string;
  ticker: string;
  tipo: string;
  precio_actual: number;
  mensaje: string;
  fecha_creacion: string;
}

// Las alertas son compartidas: qué alertas leyó cada usuario se guarda en su navegador
const READ_KEY = 'quantum_alertas_leidas';

function loadReadIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export default function NotificationBell() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(false);

  const fetchAlerts = async () => {
    try {
      const res = await fetch('/api/alerts');
      if (res.ok) {
        const data = await res.json();
        setAlerts(data);
      }
    } catch (e) {
      console.error('Error fetching alerts', e);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReadIds(loadReadIds());
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  const saveReadIds = (ids: Set<string>) => {
    // Solo guardamos ids de alertas que aún existen, para que la lista no crezca sin límite
    const vigentes = new Set(alerts.map(a => a.id));
    const toSave = [...ids].filter(id => vigentes.has(id));
    try { localStorage.setItem(READ_KEY, JSON.stringify(toSave)); } catch { /* sin almacenamiento */ }
    setReadIds(new Set(toSave));
  };

  const markAsRead = (id: string) => saveReadIds(new Set([...readIds, id]));
  const markAllAsRead = () => saveReadIds(new Set(alerts.map(a => a.id)));

  const unreadCount = alerts.filter(a => !readIds.has(a.id)).length;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-zinc-600 dark:text-[#a1a1aa] hover:text-zinc-900 dark:hover:text-[#e4e4e7] transition-colors focus:outline-none"
        aria-label="Alertas de mercado"
        aria-expanded={isOpen}
      >
        {/* La campana se balancea cuando hay alertas sin leer */}
        <motion.span
          className="block"
          style={{ originY: 0.1 }}
          animate={unreadCount > 0 ? { rotate: [0, 16, -14, 10, -6, 0] } : { rotate: 0 }}
          transition={unreadCount > 0 ? { duration: 1, repeat: Infinity, repeatDelay: 4 } : undefined}
        >
          <Bell className="w-5 h-5" />
        </motion.span>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#f87171] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#f87171]"></span>
          </span>
        )}
      </button>

      {/* Tocar fuera del panel lo cierra */}
      {isOpen && <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />}

      <AnimatePresence>
      {isOpen && (
        // En el celular ocupa el ancho de la pantalla; en pantallas grandes cuelga de la campana
        <motion.div
          key="panel"
          initial={{ opacity: 0, y: -8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.96 }}
          transition={{ duration: 0.2, ease: SUAVE }}
          style={{ originX: 1, originY: 0 }}
          className="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-80 bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-2xl z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-[#27272a] bg-zinc-50 dark:bg-[#09090b] flex justify-between items-center">
            <h3 className="text-xs font-sans font-medium font-bold uppercase tracking-wider text-zinc-900 dark:text-[#e4e4e7]">Alertas de Mercado</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-[10px] font-mono bg-[#f87171]/20 text-red-600 dark:text-[#fca5a5] px-2 py-0.5 rounded hover:bg-[#f87171]/30"
                title="Marcar todas como leídas"
              >
                {unreadCount} Nuevas ✓
              </button>
            )}
          </div>

          <div className="max-h-[70vh] sm:max-h-96 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 dark:text-[#71717a] text-xs font-sans font-medium">
                No hay alertas activas en el mercado.
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-[#27272a]">
                {alerts.map(alert => {
                  const leida = readIds.has(alert.id);
                  return (
                    <div
                      key={alert.id}
                      className={`p-4 transition-colors ${!leida ? 'bg-zinc-50 dark:bg-[#09090b]' : 'bg-white dark:bg-[#18181b] opacity-60'}`}
                    >
                      <div className="flex gap-3">
                        <div className="mt-0.5">
                          <AlertTriangle className={`w-4 h-4 ${alert.tipo === 'ENTRA_LISTA' ? 'text-[#34d399]' : 'text-[#f59e0b]'}`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <p className="text-sm font-bold text-zinc-900 dark:text-[#e4e4e7] font-mono">{alert.ticker}</p>
                            <span className="text-[10px] text-zinc-500 dark:text-[#71717a]">
                              {new Date(alert.fecha_creacion).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] mt-1 leading-relaxed">
                            {alert.mensaje}
                          </p>
                          {!leida && (
                            <button
                              onClick={() => markAsRead(alert.id)}
                              className="mt-3 flex items-center gap-1 text-[10px] uppercase font-mono tracking-wider text-[#60a5fa] hover:text-[#3b82f6] transition-colors"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Marcar como leída
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
