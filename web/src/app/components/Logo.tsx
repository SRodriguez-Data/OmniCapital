'use client';

import { motion } from 'framer-motion';
import { SUAVE } from './Movimiento';

// Logo de OmniCapital: una "O" hecha como gráfico de torta (la cartera repartida en tres) y una línea de precio que
// sube y rompe el anillo por arriba (el capital que crece). Mismo dibujo que src/app/icon.svg.
//
// Ángulos medidos desde las 12 en punto, en el sentido del reloj, sobre un círculo de radio 22 centrado en (32, 32).
// Entre 10° y 85° queda la abertura por donde sale la flecha.
export const SEGMENTOS = [
  { d: 'M53.92 30.08 A22 22 0 0 1 24.48 52.67', color: '#10b981' }, //  85° → 200°
  { d: 'M21.67 51.42 A22 22 0 0 1 12.95 21', color: '#14b8a6' },    // 208° → 300°
  { d: 'M14.66 18.45 A22 22 0 0 1 35.82 10.33', color: '#22d3ee' }, // 308° → 370°
];
// La línea parte dentro del anillo y sale por la abertura (cruza el radio 22 a unos 53°)
export const LINEA = 'M20 40 L28 31.5 L35 37.5 L55 12';
export const PUNTA = 'M47.5 14.2 L55.4 11.5 L54.6 19.8';

interface MarcaProps {
  className?: string;
  /** Dibuja el logo trazo a trazo al aparecer */
  animar?: boolean;
  /** Segundos antes de empezar a dibujarlo */
  retraso?: number;
  /** Duración total del dibujo, en segundos */
  duracion?: number;
}

export function LogoMarca({ className = 'w-10 h-10', animar = false, retraso = 0, duracion = 1.2 }: MarcaProps) {
  const paso = duracion / 5;
  const trazo = (i: number, largo = 1.6) => animar
    ? {
        initial: { pathLength: 0, opacity: 0 },
        animate: { pathLength: 1, opacity: 1 },
        transition: { pathLength: { delay: retraso + i * paso, duration: paso * largo, ease: SUAVE }, opacity: { delay: retraso + i * paso, duration: 0.01 } },
      }
    : {};

  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} role="img" aria-label="OmniCapital">
      {SEGMENTOS.map((s, i) => (
        <motion.path key={i} d={s.d} stroke={s.color} strokeWidth={7} {...trazo(i)} />
      ))}
      {/* La línea usa el color del texto: blanca en el tema oscuro, casi negra en el claro */}
      <motion.path d={LINEA} stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" {...trazo(2.6, 2)} />
      <motion.path
        d={PUNTA}
        stroke="currentColor"
        strokeWidth={4.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ originX: 1, originY: 0 }} // crece desde la punta (esquina superior derecha de la flecha)
        {...(animar ? {
          initial: { scale: 0, opacity: 0 },
          animate: { scale: 1, opacity: 1 },
          transition: { delay: retraso + duracion * 0.95, type: 'spring', stiffness: 500, damping: 15 },
        } : {})}
      />
      <motion.circle
        cx={20}
        cy={40}
        r={3.2}
        fill="currentColor"
        {...(animar ? { initial: { scale: 0 }, animate: { scale: 1 }, transition: { delay: retraso + paso * 2.4, type: 'spring', stiffness: 600, damping: 18 } } : {})}
      />
    </svg>
  );
}

// El nombre: "Omni" grueso y "Capital" liviano, con el degradé de la marca
export function LogoNombre({ className = 'text-xl' }: { className?: string }) {
  return (
    <span className={`tracking-tight bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 bg-clip-text text-transparent ${className}`}>
      <span className="font-black">Omni</span><span className="font-light">Capital</span>
    </span>
  );
}
