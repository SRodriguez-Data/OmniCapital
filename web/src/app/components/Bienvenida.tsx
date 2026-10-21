'use client';

import { motion, type Variants } from 'framer-motion';
import { LogoMarca } from './Logo';
import { SUAVE } from './Movimiento';

// Pantalla de bienvenida al abrir la app: el logo se dibuja, el nombre aparece letra por letra y la pantalla se cierra
// en un círculo hacia el centro, dejando ver el panel. La página decide cuándo sacarla (page.tsx); dura unos 2,2 s.

// Cada letra lleva su tono del degradé de la marca (esmeralda → turquesa → cian)
const DEGRADE = ['#34d399', '#2dd4bf', '#22d3ee'];
function tono(i: number, total: number): string {
  const t = i / (total - 1);
  const [a, b, f] = t < 0.5 ? [DEGRADE[0], DEGRADE[1], t * 2] : [DEGRADE[1], DEGRADE[2], (t - 0.5) * 2];
  const mezcla = (k: number) => Math.round(parseInt(a.slice(k, k + 2), 16) * (1 - f) + parseInt(b.slice(k, k + 2), 16) * f);
  return `rgb(${mezcla(1)}, ${mezcla(3)}, ${mezcla(5)})`;
}
const LETRAS = [...'Omni'].map(l => ({ l, peso: 'font-black' })).concat([...'Capital'].map(l => ({ l, peso: 'font-light' })));

// `rapida`: ya se vio en esta sesión, así que solo se desvanece en vez de cerrarse en círculo
const SALIDA: Variants = {
  visible: { clipPath: 'circle(150% at 50% 45%)', opacity: 1 },
  fuera: (rapida: boolean) => rapida
    ? { opacity: 0, transition: { duration: 0.2 } }
    : { clipPath: 'circle(0% at 50% 45%)', transition: { duration: 0.8, ease: [0.76, 0, 0.24, 1] } },
};

export default function Bienvenida() {
  return (
    <motion.div
      variants={SALIDA}
      initial="visible"
      animate="visible"
      exit="fuera"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-[#040706] text-white"
    >
      {/* Cuadrícula tenue que se desvanece hacia los bordes */}
      <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(circle_at_50%_45%,black,transparent_65%)]" />

      {/* Resplandor que se enciende detrás del logo */}
      <motion.div
        className="absolute top-[45%] left-1/2 w-[44rem] h-[44rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.28),rgba(34,211,238,0.08)_40%,transparent_65%)]"
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: [0.3, 1, 0.92, 1], opacity: 1 }}
        transition={{ duration: 2.2, ease: SUAVE }}
      />

      <div className="relative flex flex-col items-center">
        <motion.div
          className="relative"
          initial={{ scale: 0.7, rotate: -25 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 14, delay: 0.1 }}
        >
          <LogoMarca className="w-24 h-24 md:w-28 md:h-28 drop-shadow-[0_0_24px_rgba(16,185,129,0.45)]" animar retraso={0.2} duracion={1.1} />
          {/* Onda de luz cuando la flecha termina de salir */}
          {[0, 0.18].map(d => (
            <motion.span
              key={d}
              className="absolute inset-0 rounded-full border-2 border-emerald-400/70"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 2.4, opacity: [0, 0.8, 0] }}
              transition={{ delay: 1.35 + d, duration: 1.1, ease: 'easeOut' }}
            />
          ))}
        </motion.div>

        <h1 className="mt-7 flex text-4xl md:text-5xl tracking-tight [perspective:600px]" aria-label="OmniCapital">
          {LETRAS.map(({ l, peso }, i) => (
            <motion.span
              key={i}
              aria-hidden
              className={`inline-block ${peso}`}
              style={{ color: tono(i, LETRAS.length) }}
              initial={{ opacity: 0, y: 28, rotateX: -80 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              transition={{ delay: 0.95 + i * 0.045, duration: 0.6, ease: SUAVE }}
            >
              {l}
            </motion.span>
          ))}
        </h1>

        <motion.p
          className="mt-3 font-mono text-[10px] md:text-xs uppercase text-zinc-400"
          initial={{ opacity: 0, letterSpacing: '0.9em' }}
          animate={{ opacity: 1, letterSpacing: '0.32em' }}
          transition={{ delay: 1.45, duration: 0.9, ease: SUAVE }}
        >
          Wealth Management Platform
        </motion.p>
      </div>

      {/* Barra de carga */}
      <div className="absolute bottom-16 w-44 h-[3px] rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400"
          style={{ originX: 0 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 2.1, ease: [0.65, 0, 0.35, 1] }}
        />
      </div>
    </motion.div>
  );
}
