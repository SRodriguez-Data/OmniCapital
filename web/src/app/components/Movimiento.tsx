'use client';

import { MotionConfig, type Transition } from 'framer-motion';

// Curva y resorte comunes de las animaciones de la app
export const SUAVE = [0.22, 1, 0.36, 1] as const;
export const RESORTE: Transition = { type: 'spring', stiffness: 420, damping: 34 };

// Quien pidió menos movimiento en su sistema ve solo los fundidos, sin desplazamientos
export function ProveedorMovimiento({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
