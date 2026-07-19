'use client';

import React, { useEffect, useState } from 'react';
import { Bell, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Alert {
  id: string;
  ticker: string;
  tipo: string;
  precio_actual: number;
  mensaje: string;
  leido: boolean;
  fecha_creacion: string;
}

export default function NotificationBell() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
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
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  const unreadCount = alerts.filter(a => !a.leido).length;

  const markAsRead = async (id: string) => {
    try {
      await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      // Optimistic update
      setAlerts(alerts.map(a => a.id === id ? { ...a, leido: true } : a));
    } catch (e) {
      console.error('Error marking as read', e);
    }
  };

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-zinc-600 dark:text-[#a1a1aa] hover:text-zinc-900 dark:text-[#e4e4e7] transition-colors focus:outline-none"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#f87171] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#f87171]"></span>
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl shadow-sm dark:shadow-none shadow-2xl z-50">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-[#27272a] bg-zinc-50 dark:bg-[#09090b] flex justify-between items-center">
            <h3 className="text-xs font-sans font-medium font-bold uppercase tracking-wider text-zinc-900 dark:text-[#e4e4e7]">Alertas de Mercado</h3>
            {unreadCount > 0 && (
              <span className="text-[10px] font-mono bg-[#f87171]/20 text-[#fca5a5] px-2 py-0.5 rounded">
                {unreadCount} Nuevas
              </span>
            )}
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="p-6 text-center text-zinc-500 dark:text-[#71717a] text-xs font-sans font-medium">
                No hay alertas activas en el mercado.
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-[#27272a]">
                {alerts.map(alert => (
                  <div 
                    key={alert.id} 
                    className={`p-4 transition-colors ${!alert.leido ? 'bg-zinc-50 dark:bg-[#09090b]' : 'bg-white dark:bg-[#18181b] opacity-60'}`}
                  >
                    <div className="flex gap-3">
                      <div className="mt-0.5">
                        {alert.tipo === 'BUY_ZONE' ? (
                          <AlertTriangle className="w-4 h-4 text-[#34d399]" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <p className="text-sm font-bold text-zinc-900 dark:text-[#e4e4e7] font-mono">{alert.ticker}</p>
                          <span className="text-[10px] text-zinc-500 dark:text-[#71717a]">
                            {new Date(alert.fecha_creacion).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-600 dark:text-[#a1a1aa] mt-1 leading-relaxed">
                          {alert.mensaje}
                        </p>
                        {!alert.leido && (
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
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
