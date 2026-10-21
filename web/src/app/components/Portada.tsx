'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { animate, motion, useInView, useReducedMotion, type Variants } from 'framer-motion';
import {
  Activity, ArrowRight, Briefcase, Calculator, CircleCheck, Database, DollarSign, Eye, FileText, FlaskConical, History,
  Loader2, Lock, Search, Target, type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useBienvenida } from './Bienvenida';
import { LogoMarca, LogoNombre } from './Logo';
import MacroPanel from './MacroPanel';
import { SUAVE } from './Movimiento';
import { ThemeToggle } from './ThemeToggle';

// Portada pública: lo que ve quien abre la app sin sesión. Explica qué es OmniCapital, muestra el mercado en vivo
// (la misma cinta del panel) y lleva al demo o al login. Entra cuando se va la bienvenida (components/Bienvenida.tsx);
// cada sección aparece al llegar a ella. Todo lo que describe está en el panel: si cambia una pestaña, cambia aquí.

const INSTITUCIONES = ['BTG Pactual', 'Racional', 'Fintual', 'XTB', 'Zesty'];

const TEXTOS = {
  es: {
    nav: { plataforma: 'Plataforma', como: 'Cómo funciona', seguridad: 'Seguridad', entrar: 'Iniciar sesión', entrarCorto: 'Entrar', demo: 'Probar demo' },
    mercado: 'Mercado',
    hero: {
      etiqueta: 'Mercados de EE.UU. y Chile, al día cada madrugada',
      titulo1: 'Tu patrimonio,',
      titulo2: 'invertido con evidencia.',
      bajada: 'OmniCapital junta todas tus cuentas de inversión en un solo panel, mide cuánto ganas de verdad, en pesos y en dólares, y te propone qué hacer con criterios que le ganaron al mercado en 10 años de datos. No con corazonadas.',
      demo: 'Probar el demo',
      crear: 'Crear cuenta gratis',
      nota: 'Sin tarjeta y sin conectar tu banco: el demo no pide ni registro.',
      lee: 'Lee las cartolas de',
    },
    maqueta: {
      ejemplo: 'Ejemplo ilustrativo',
      patrimonio: 'Patrimonio total',
      periodo: 'últimos 12 meses',
      distribucion: 'Distribución',
      clases: ['Acciones EE.UU.', 'Acciones Chile', 'Fondos y ETF', 'Caja'],
      posiciones: 'Posiciones',
      diag: 'Diagnóstico IA',
      diagTexto: 'Diversificación sana · riesgo moderado',
      top: 'Ideas con evidencia',
      topTexto: '5 acciones elegidas hoy',
    },
    cifras: [
      'módulos en un solo panel',
      'instituciones cuyas cartolas sabe leer',
      'años de datos detrás de cada criterio',
      'mercados: Estados Unidos y Chile',
    ],
    plataforma: {
      etiqueta: 'Plataforma',
      titulo: 'Todo para invertir con la cabeza fría',
      bajada: 'Nueve módulos que trabajan juntos, desde ordenar tus cartolas hasta probar una estrategia antes de arriesgar un peso.',
    },
    modulos: [
      ['Motor de cartolas', 'Sube los PDF de tus cuentas y se arma un libro con cada compra, venta y dividendo, tus posiciones y tu rentabilidad anual real.'],
      ['Mi portafolio', 'Todo tu patrimonio en pesos y en dólares, con la ganancia o pérdida por el tipo de cambio incluida.'],
      ['Diagnóstico IA', 'Un informe diario de tu cartera y su exposición real, contando lo que hay dentro de cada fondo.'],
      ['Ideas con evidencia', 'Cada día, las acciones que eligen los únicos criterios que, medidos en 10 años sin mirar el futuro, le ganaron a su mercado.'],
      ['Ingresos pasivos', 'Los dividendos que cobraste, los que vienen y cuánto rinde tu cartera por ellos.'],
      ['Buscador', 'Análisis técnico de cualquier acción del mundo, con una lectura escrita por IA.'],
      ['Optimizador', '¿Llegó plata nueva? Te dice cuánto comprar de cada activo por paridad de riesgo, sin vender nada.'],
      ['Backtesting', 'La máquina del tiempo: cuánto tendrías hoy si hubieras invertido antes, comparado con el índice.'],
      ['Simulación', 'La estrategia operando sola con dinero ficticio, con su bitácora diaria y reglas de riesgo.'],
    ],
    como: {
      etiqueta: 'Cómo funciona',
      titulo: 'De tus cartolas a una decisión, en cuatro pasos',
    },
    pasos: [
      ['Sube tus cartolas', 'Los PDF de tus cuentas se leen en tu propio navegador y quedan ordenados en un solo libro de movimientos.'],
      ['Se ponen al día solos', 'Cada madrugada el sistema descarga precios y balances de EE.UU. y Chile, sin que hagas nada.'],
      ['Recibe tu diagnóstico', 'Cada posición se juzga por cuatro pilares: técnico, fundamental, riesgo y contexto de mercado. La IA solo lo redacta.'],
      ['Prueba antes de arriesgar', 'Mide una idea en el pasado con backtesting y mírala operar con dinero ficticio antes de mover dinero real.'],
    ],
    seguridad: {
      etiqueta: 'Seguridad y transparencia',
      titulo: 'Tus datos son tuyos. Los números, a la vista.',
    },
    garantias: [
      ['Cada cuenta ve solo lo suyo', 'La base de datos aplica permisos fila por fila: tu portafolio no lo puede leer nadie más.'],
      ['Tus PDF no se suben', 'Las cartolas se procesan en tu navegador y su clave nunca sale de él. Solo se guardan tus posiciones.'],
      ['Sin cajas negras', 'Cada idea muestra los datos que la respaldan y su historial real, con aciertos y errores.'],
    ],
    final: {
      titulo: 'Mira cómo se ve con un portafolio de ejemplo',
      bajada: 'Entra al demo en un clic: sin registrarte, con datos de ejemplo y todos los módulos abiertos.',
      entrar: 'Ya tengo cuenta',
    },
    aviso: 'OmniCapital es una herramienta de análisis e información. No es asesoría financiera personalizada ni una recomendación de compra o venta. Invertir conlleva riesgos y las rentabilidades pasadas no garantizan resultados futuros.',
  },
  en: {
    nav: { plataforma: 'Platform', como: 'How it works', seguridad: 'Security', entrar: 'Sign in', entrarCorto: 'Sign in', demo: 'Try the demo' },
    mercado: 'Markets',
    hero: {
      etiqueta: 'US and Chilean markets, refreshed every night',
      titulo1: 'Your wealth,',
      titulo2: 'invested on evidence.',
      bajada: 'OmniCapital brings all your investment accounts into one dashboard, measures what you are really earning, in pesos and in dollars, and suggests what to do with rules that beat the market over 10 years of data. Not hunches.',
      demo: 'Try the demo',
      crear: 'Create a free account',
      nota: 'No card and no bank connection: the demo does not even ask you to sign up.',
      lee: 'Reads statements from',
    },
    maqueta: {
      ejemplo: 'Illustrative example',
      patrimonio: 'Total wealth',
      periodo: 'last 12 months',
      distribucion: 'Allocation',
      clases: ['US stocks', 'Chilean stocks', 'Funds and ETFs', 'Cash'],
      posiciones: 'Holdings',
      diag: 'AI diagnosis',
      diagTexto: 'Healthy diversification · moderate risk',
      top: 'Evidence-backed ideas',
      topTexto: '5 stocks picked today',
    },
    cifras: [
      'modules in a single dashboard',
      'institutions whose statements it reads',
      'years of data behind every rule',
      'markets: the United States and Chile',
    ],
    plataforma: {
      etiqueta: 'Platform',
      titulo: 'Everything to invest with a cool head',
      bajada: 'Nine modules that work together, from sorting your statements to testing a strategy before risking a single peso.',
    },
    modulos: [
      ['Statement engine', 'Upload your account PDFs and get a ledger of every buy, sell and dividend, your holdings and your real annual return.'],
      ['My portfolio', 'All your wealth in pesos and dollars, including the gain or loss from the exchange rate.'],
      ['AI diagnosis', 'A daily report on your portfolio and its real exposure, counting what sits inside each fund.'],
      ['Evidence-backed ideas', 'Every day, the stocks picked by the only rules that, measured over 10 years without looking ahead, beat their market.'],
      ['Passive income', 'The dividends you collected, the ones coming, and the yield they give your portfolio.'],
      ['Screener', 'Technical analysis of any stock in the world, with a write-up by AI.'],
      ['Optimizer', 'New money in? It tells you how much to buy of each asset by risk parity, without selling anything.'],
      ['Backtesting', 'The time machine: what you would have today had you invested earlier, against the index.'],
      ['Simulation', 'The strategy trading on its own with play money, with a daily log and risk rules.'],
    ],
    como: {
      etiqueta: 'How it works',
      titulo: 'From your statements to a decision, in four steps',
    },
    pasos: [
      ['Upload your statements', 'Your account PDFs are read in your own browser and sorted into a single ledger of transactions.'],
      ['They update themselves', 'Every night the system downloads prices and balance sheets from the US and Chile, with nothing for you to do.'],
      ['Get your diagnosis', 'Each holding is judged on four pillars: technical, fundamental, risk and market context. AI only writes it up.'],
      ['Test before you risk it', 'Measure an idea in the past with backtesting and watch it trade with play money before moving real money.'],
    ],
    seguridad: {
      etiqueta: 'Security and transparency',
      titulo: 'Your data is yours. The numbers, in plain sight.',
    },
    garantias: [
      ['Each account sees only its own', 'The database enforces row-level permissions: nobody else can read your portfolio.'],
      ['Your PDFs are not uploaded', 'Statements are processed in your browser and their password never leaves it. Only your holdings are saved.'],
      ['No black boxes', 'Every idea shows the data behind it and its real track record, hits and misses.'],
    ],
    final: {
      titulo: 'See it with a sample portfolio',
      bajada: 'Open the demo in one click: no sign-up, sample data and every module unlocked.',
      entrar: 'I have an account',
    },
    aviso: 'OmniCapital is an analysis and information tool. It is not personalized financial advice nor a recommendation to buy or sell. Investing involves risk and past returns do not guarantee future results.',
  },
};

// Íconos y colores de cada módulo: los mismos de su pestaña en el panel (page.tsx), con su código
const MODULOS: { codigo: string; icono: LucideIcon; color: string }[] = [
  { codigo: '00', icono: Database, color: 'text-orange-500 bg-orange-500/10 ring-orange-500/20' },
  { codigo: '01', icono: Briefcase, color: 'text-blue-500 bg-blue-500/10 ring-blue-500/20' },
  { codigo: '02', icono: Activity, color: 'text-indigo-500 bg-indigo-500/10 ring-indigo-500/20' },
  { codigo: '03', icono: Target, color: 'text-fuchsia-500 bg-fuchsia-500/10 ring-fuchsia-500/20' },
  { codigo: '04', icono: DollarSign, color: 'text-emerald-500 bg-emerald-500/10 ring-emerald-500/20' },
  { codigo: '05', icono: Search, color: 'text-cyan-500 bg-cyan-500/10 ring-cyan-500/20' },
  { codigo: '06', icono: Calculator, color: 'text-amber-500 bg-amber-500/10 ring-amber-500/20' },
  { codigo: '07', icono: History, color: 'text-rose-500 bg-rose-500/10 ring-rose-500/20' },
  { codigo: '08', icono: FlaskConical, color: 'text-purple-500 bg-purple-500/10 ring-purple-500/20' },
];
const GARANTIAS: LucideIcon[] = [Lock, FileText, Eye];
// Las cifras de la franja: 9 pestañas, 5 instituciones en CartolaParser, 10 años del laboratorio, 2 mercados
const CIFRAS = [9, 5, 10, 2];

// La maqueta del panel. Los números son inventados (lo dice la etiqueta "Ejemplo ilustrativo")
const SERIE = [22, 25, 23, 29, 27, 33, 31, 28, 36, 40, 38, 45, 43, 50, 56, 53, 61, 66];
const CLASES = [
  { peso: 46, color: 'bg-emerald-500' },
  { peso: 22, color: 'bg-teal-400' },
  { peso: 24, color: 'bg-cyan-400' },
  { peso: 8, color: 'bg-zinc-400 dark:bg-zinc-600' },
];
const POSICIONES = [
  { ticker: 'VOO', nombre: 'Vanguard S&P 500 ETF', cambio: 21.3, linea: [3, 4, 4, 5, 6, 6, 7, 8] },
  { ticker: 'NVDA', nombre: 'NVIDIA', cambio: 34.8, linea: [2, 3, 5, 4, 6, 7, 6, 8] },
  { ticker: 'SQM-B', nombre: 'SQM', cambio: -6.2, linea: [7, 6, 7, 5, 5, 4, 5, 4] },
];

// Curva suave que pasa por los puntos (Catmull-Rom convertida a Bézier), dentro de una caja de ancho × alto
function curva(valores: number[], ancho: number, alto: number, margen = 6) {
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const p = valores.map((v, i) => [(i / (valores.length - 1)) * ancho, alto - margen - ((v - min) / (max - min)) * (alto - margen * 2)]);
  const n = (x: number) => x.toFixed(1);
  let d = `M${n(p[0][0])},${n(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const [a, b, c, e] = [p[i - 1] ?? p[i], p[i], p[i + 1], p[i + 2] ?? p[i + 1]];
    d += ` C${n(b[0] + (c[0] - a[0]) / 6)},${n(b[1] + (c[1] - a[1]) / 6)} ${n(c[0] - (e[0] - b[0]) / 6)},${n(c[1] - (e[1] - b[1]) / 6)} ${n(c[0])},${n(c[1])}`;
  }
  return { linea: d, area: `${d} L${ancho},${alto} L0,${alto} Z`, fin: p[p.length - 1] };
}
const GRAFICO = curva(SERIE, 320, 112);

// Formatos fuera del componente: <Cifra> reinicia su conteo si cambia la función
const enPesos = (v: number) => `$${Math.round(v).toLocaleString('es-CL')}`;
const entero = (v: number) => String(Math.round(v));

// Entradas: el bloque aparece subiendo; el grupo hace que sus hijos aparezcan uno tras otro
const APARECE: Variants = {
  oculto: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: SUAVE } },
};
const GRUPO: Variants = {
  oculto: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const ARRIBA: Variants = {
  oculto: { opacity: 0, y: -24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: SUAVE } },
};
// Las secciones de más abajo se animan al llegar a ellas, una sola vez
const AL_LLEGAR = { initial: 'oculto', whileInView: 'visible', viewport: { once: true, amount: 0.25 } } as const;

export default function Portada({ onDemo }: { onDemo: () => Promise<void> }) {
  const { language, toggleLanguage } = useLanguage();
  const { terminada } = useBienvenida();
  const [entrando, setEntrando] = useState(false);
  const t = TEXTOS[language];
  const estado = terminada ? 'visible' : 'oculto';

  const probarDemo = async () => {
    if (entrando) return;
    setEntrando(true);
    try {
      await onDemo();
    } finally {
      setEntrando(false);
    }
  };

  // Los enlaces del menú bajan suave hasta su sección (sin cambiar el scroll del panel, que no usa anclas)
  const irA = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const botonDemo = (texto: string, clase = '') => (
    <button
      type="button"
      onClick={probarDemo}
      disabled={entrando}
      className={`brillo group items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 font-semibold text-white shadow-lg shadow-emerald-500/25 transition-all hover:shadow-emerald-500/40 hover:brightness-110 disabled:opacity-70 ${clase}`}
    >
      {entrando ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {texto}
      {!entrando && <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />}
    </button>
  );

  return (
    <div id="inicio" className="relative isolate min-h-screen overflow-x-clip bg-zinc-50 dark:bg-[#09090b] text-zinc-900 dark:text-zinc-100 font-sans">
      {/* MENÚ */}
      <motion.nav
        variants={ARRIBA}
        initial="oculto"
        animate={estado}
        className="sticky top-0 z-40 border-b border-zinc-200/80 dark:border-[#27272a] bg-white/75 dark:bg-[#09090b]/75 backdrop-blur-md"
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <a href="#inicio" onClick={irA('inicio')} className="flex min-w-0 items-center gap-2.5" aria-label="OmniCapital">
            <LogoMarca className="h-8 w-8 shrink-0 text-zinc-900 dark:text-white" />
            <LogoNombre className="text-lg sm:text-xl" />
          </a>
          <div className="hidden items-center gap-1 text-sm font-medium text-zinc-600 dark:text-zinc-400 md:flex">
            {([['plataforma', t.nav.plataforma], ['como-funciona', t.nav.como], ['seguridad', t.nav.seguridad]] as const).map(([id, texto]) => (
              <a key={id} href={`#${id}`} onClick={irA(id)} className="rounded-lg px-3 py-2 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800/60 dark:hover:text-white">
                {texto}
              </a>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={toggleLanguage}
              aria-label={language === 'es' ? 'Change language to English' : 'Cambiar idioma a español'}
              className="h-9 rounded-full px-2 text-xs font-mono font-bold text-zinc-500 transition-colors hover:text-emerald-500"
            >
              {language.toUpperCase()}
            </button>
            <ThemeToggle />
            <Link
              href="/login"
              className="rounded-xl border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm font-semibold transition-colors hover:border-zinc-900 dark:hover:border-zinc-300"
            >
              <span className="sm:hidden">{t.nav.entrarCorto}</span>
              <span className="hidden sm:inline">{t.nav.entrar}</span>
            </Link>
            {botonDemo(t.nav.demo, 'hidden lg:inline-flex px-4 py-2 text-sm')}
          </div>
        </div>
      </motion.nav>

      {/* CINTA DEL MERCADO: los mismos indicadores en vivo que arriba del panel */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: terminada ? 1 : 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="relative z-10 flex items-stretch border-b border-zinc-200 dark:border-[#27272a] bg-zinc-50 dark:bg-[#09090b]"
      >
        <div className="flex shrink-0 items-center gap-2 border-r border-zinc-200 dark:border-[#27272a] px-3 md:px-4 text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          {t.mercado}
        </div>
        <div className="min-w-0 flex-1 [&>div]:border-b-0">
          <MacroPanel />
        </div>
      </motion.div>

      {/* PORTADA */}
      <section className="relative">
        {/* Cuadrícula tenue como la de la bienvenida, para que el cierre en círculo caiga sobre lo mismo */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 text-zinc-900 dark:text-white opacity-[0.05] dark:opacity-[0.06] [background-image:linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_50%_30%,black,transparent_70%)]" />
          <div className="flotar absolute -top-40 -left-32 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.16),transparent_65%)]" />
          <div className="flotar-lento absolute top-10 -right-40 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.12),transparent_65%)]" />
        </div>

        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 pt-12 pb-20 sm:px-6 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-28">
          <motion.div variants={GRUPO} initial="oculto" animate={estado}>
            <motion.div
              variants={APARECE}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {t.hero.etiqueta}
            </motion.div>

            <motion.h1 variants={APARECE} className="mt-6 text-[2.6rem] font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-[4.2rem]">
              {t.hero.titulo1}
              <br />
              <span className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 bg-clip-text text-transparent">{t.hero.titulo2}</span>
            </motion.h1>

            <motion.p variants={APARECE} className="mt-6 max-w-xl text-base leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-lg">
              {t.hero.bajada}
            </motion.p>

            <motion.div variants={APARECE} className="mt-8 flex flex-col gap-3 sm:flex-row">
              {botonDemo(t.hero.demo, 'inline-flex px-6 py-3.5 text-sm')}
              <Link
                href="/login?registro"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white/60 dark:bg-zinc-900/60 px-6 py-3.5 text-sm font-semibold backdrop-blur-sm transition-colors hover:border-zinc-900 dark:hover:border-zinc-300"
              >
                {t.hero.crear}
              </Link>
            </motion.div>
            <motion.p variants={APARECE} className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">{t.hero.nota}</motion.p>

            <motion.div variants={APARECE} className="mt-10 border-t border-zinc-200 dark:border-[#27272a] pt-6">
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">{t.hero.lee}</p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-zinc-400 dark:text-zinc-500">
                {INSTITUCIONES.map(i => <span key={i}>{i}</span>)}
              </div>
            </motion.div>
          </motion.div>

          <Maqueta activa={terminada} t={t.maqueta} />
        </div>
      </section>

      {/* CIFRAS */}
      <FranjaCifras textos={t.cifras} />

      {/* PLATAFORMA */}
      <section id="plataforma" className="scroll-mt-16 px-4 py-20 sm:px-6 md:py-28">
        <div className="mx-auto max-w-7xl">
          <Encabezado {...t.plataforma} />
          <motion.div variants={GRUPO} {...AL_LLEGAR} viewport={{ once: true, amount: 0.1 }} className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULOS.map((m, i) => {
              const Icono = m.icono;
              const [titulo, texto] = t.modulos[i];
              return (
                <motion.div key={m.codigo} variants={APARECE}>
                  <Foco className="h-full p-6">
                    <div className="flex items-start justify-between">
                      <span className={`grid h-11 w-11 place-items-center rounded-xl ring-1 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 ${m.color}`}>
                        <Icono className="h-5 w-5" />
                      </span>
                      <span className="font-mono text-xs text-zinc-400 dark:text-zinc-600">[{m.codigo}]</span>
                    </div>
                    <h3 className="mt-5 text-lg font-semibold">{titulo}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{texto}</p>
                  </Foco>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* CÓMO FUNCIONA */}
      <section id="como-funciona" className="scroll-mt-16 border-y border-zinc-200 dark:border-[#27272a] bg-white/70 dark:bg-[#0f0f11] px-4 py-20 sm:px-6 md:py-28">
        <div className="mx-auto max-w-7xl">
          <Encabezado {...t.como} />
          <motion.div variants={GRUPO} {...AL_LLEGAR} className="relative mt-16 grid gap-10 lg:grid-cols-4 lg:gap-6">
            {/* La línea que une los pasos se dibuja al llegar: de punta a punta en pantalla ancha; en el celular, un tramo
                vertical por paso que baja hasta el círculo del siguiente */}
            <motion.div
              aria-hidden
              className="absolute top-6 right-[12.5%] left-[12.5%] hidden h-px origin-left bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 lg:block"
              variants={{ oculto: { scaleX: 0 }, visible: { scaleX: 1, transition: { duration: 1.4, ease: SUAVE } } }}
            />
            {t.pasos.map(([titulo, texto], i) => (
              <motion.div key={titulo} variants={APARECE} className="relative flex gap-5 lg:flex-col lg:items-center lg:gap-0 lg:text-center">
                {i < t.pasos.length - 1 && (
                  <motion.span
                    aria-hidden
                    className="absolute top-12 -bottom-10 left-6 w-px origin-top bg-gradient-to-b from-emerald-500 to-teal-400 lg:hidden"
                    variants={{ oculto: { scaleY: 0 }, visible: { scaleY: 1, transition: { delay: 0.3, duration: 0.6, ease: SUAVE } } }}
                  />
                )}
                <span className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-emerald-500/60 bg-white dark:bg-[#0f0f11] font-mono text-sm font-bold text-emerald-600 shadow-[0_0_0_6px_rgba(16,185,129,0.08)] dark:text-emerald-400">
                  0{i + 1}
                </span>
                <div className="pt-2 lg:pt-0 lg:mt-5">
                  <h3 className="text-lg font-semibold">{titulo}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 lg:mx-auto lg:max-w-[16rem]">{texto}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* SEGURIDAD */}
      <section id="seguridad" className="scroll-mt-16 px-4 py-20 sm:px-6 md:py-28">
        <div className="mx-auto max-w-7xl">
          <Encabezado {...t.seguridad} />
          <motion.div variants={GRUPO} {...AL_LLEGAR} className="mt-14 grid gap-4 md:grid-cols-3">
            {t.garantias.map(([titulo, texto], i) => {
              const Icono = GARANTIAS[i];
              return (
                <motion.div key={titulo} variants={APARECE}>
                  <Foco className="h-full p-6">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20">
                      <Icono className="h-5 w-5" />
                    </span>
                    <h3 className="mt-5 text-lg font-semibold">{titulo}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{texto}</p>
                  </Foco>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* LLAMADO FINAL */}
      <section className="px-4 pb-20 sm:px-6 md:pb-28">
        <LlamadoFinal t={t.final} boton={botonDemo(t.hero.demo, 'inline-flex px-6 py-3.5 text-sm')} />
      </section>

      {/* PIE */}
      <footer className="border-t border-zinc-200 dark:border-[#27272a] px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMarca className="h-7 w-7 text-zinc-900 dark:text-white" />
            <LogoNombre className="text-lg" />
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-zinc-500">{t.aviso}</p>
        </div>
        <p className="mx-auto mt-8 max-w-7xl font-mono text-xs text-zinc-400 dark:text-zinc-600">© {new Date().getFullYear()} OmniCapital</p>
      </footer>
    </div>
  );
}

function Encabezado({ etiqueta, titulo, bajada }: { etiqueta: string; titulo: string; bajada?: string }) {
  return (
    <motion.div variants={GRUPO} {...AL_LLEGAR} className="mx-auto max-w-2xl text-center">
      <motion.p variants={APARECE} className="font-mono text-xs font-bold uppercase tracking-[0.25em] text-emerald-600 dark:text-emerald-400">
        {etiqueta}
      </motion.p>
      <motion.h2 variants={APARECE} className="mt-3 text-balance text-3xl font-bold tracking-tight md:text-[2.6rem] md:leading-tight">{titulo}</motion.h2>
      {bajada && <motion.p variants={APARECE} className="mt-4 leading-relaxed text-zinc-600 dark:text-zinc-400">{bajada}</motion.p>}
    </motion.div>
  );
}

// Tarjeta con una luz que sigue al mouse
function Foco({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mover = (e: React.MouseEvent) => {
    const caja = ref.current?.getBoundingClientRect();
    if (!caja) return;
    ref.current?.style.setProperty('--x', `${e.clientX - caja.left}px`);
    ref.current?.style.setProperty('--y', `${e.clientY - caja.top}px`);
  };
  return (
    <div
      ref={ref}
      onMouseMove={mover}
      className={`group relative overflow-hidden rounded-2xl border border-zinc-200 dark:border-[#27272a] bg-white/80 dark:bg-[#18181b]/70 shadow-sm backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-emerald-500/40 hover:shadow-xl hover:shadow-emerald-500/5 dark:shadow-none ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 [background:radial-gradient(340px_circle_at_var(--x)_var(--y),rgba(16,185,129,0.12),transparent_70%)]"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

// Número que cuenta desde 0 hasta su valor cuando `activa` se vuelve true
function Cifra({ valor, formato, activa, duracion = 1.6 }: { valor: number; formato: (v: number) => string; activa: boolean; duracion?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reducido = useReducedMotion();
  useEffect(() => {
    if (!activa || !ref.current) return;
    if (reducido) {
      ref.current.textContent = formato(valor);
      return;
    }
    const control = animate(0, valor, {
      duration: duracion,
      ease: SUAVE,
      onUpdate: v => { if (ref.current) ref.current.textContent = formato(v); },
    });
    return () => control.stop();
  }, [activa, valor, formato, duracion, reducido]);
  return <span ref={ref} className="tabular-nums">{formato(0)}</span>;
}

function FranjaCifras({ textos }: { textos: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const vista = useInView(ref, { once: true, amount: 0.5 });
  return (
    <section className="border-y border-zinc-200 dark:border-[#27272a] bg-white/70 dark:bg-[#0f0f11] px-4 sm:px-6">
      <div ref={ref} className="mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-8 py-10 md:grid-cols-4 md:py-12">
        {CIFRAS.map((c, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 16 }}
            animate={vista ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: i * 0.1, duration: 0.6, ease: SUAVE }}
            className="md:border-l md:border-zinc-200 md:pl-6 md:first:border-l-0 md:first:pl-0 md:dark:border-[#27272a]"
          >
            <p className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent md:text-5xl">
              <Cifra valor={c} formato={entero} activa={vista} duracion={1.2 + i * 0.15} />
            </p>
            <p className="mt-2 text-sm leading-snug text-zinc-600 dark:text-zinc-400">{textos[i]}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// Maqueta del panel: el patrimonio cuenta hacia arriba, la curva se dibuja y alrededor flotan dos avisos
function Maqueta({ activa, t }: { activa: boolean; t: (typeof TEXTOS)['es']['maqueta'] }) {
  // Sin los caracteres especiales del id de React, que rompen el url(#...) de los degradés
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [x, y] = GRAFICO.fin;
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.96 }}
      animate={activa ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 40, scale: 0.96 }}
      transition={{ duration: 0.9, ease: SUAVE, delay: 0.25 }}
      className="relative mx-auto w-full max-w-lg"
    >
      <div aria-hidden className="absolute -inset-8 rounded-[2.5rem] bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.22),rgba(34,211,238,0.08)_45%,transparent_70%)] blur-2xl" />

      <div className="relative rounded-2xl border border-zinc-200 dark:border-[#27272a] bg-white/90 dark:bg-[#18181b]/90 p-5 shadow-2xl shadow-zinc-300/40 backdrop-blur-md dark:shadow-black/40 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-zinc-500">{t.patrimonio}</p>
          <span className="shrink-0 rounded-full border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            {t.ejemplo}
          </span>
        </div>
        <p className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
          <Cifra valor={24870500} formato={enPesos} activa={activa} duracion={1.8} />
          <span className="ml-1.5 text-sm font-medium text-zinc-500">CLP</span>
        </p>
        <p className="mt-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          ▲ 18,6% <span className="font-normal text-zinc-500">· {t.periodo}</span>
        </p>

        {/* Curva del patrimonio */}
        <svg viewBox="0 0 320 112" className="mt-4 h-auto w-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-linea`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="60%" stopColor="#2dd4bf" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          {[28, 56, 84].map(g => (
            <line key={g} x1="0" x2="320" y1={g} y2={g} className="stroke-zinc-200 dark:stroke-zinc-800" strokeDasharray="3 5" />
          ))}
          <motion.path
            d={GRAFICO.area}
            fill={`url(#${id}-area)`}
            initial={{ opacity: 0 }}
            animate={{ opacity: activa ? 1 : 0 }}
            transition={{ delay: 1.3, duration: 0.8 }}
          />
          <motion.path
            d={GRAFICO.linea}
            fill="none"
            stroke={`url(#${id}-linea)`}
            strokeWidth={2.5}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: activa ? 1 : 0 }}
            transition={{ delay: 0.5, duration: 1.6, ease: SUAVE }}
          />
          {/* El último precio late, como en una pantalla en vivo */}
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: activa ? 1 : 0 }} transition={{ delay: 2 }}>
            <motion.circle cx={x} cy={y} r={4} fill="#22d3ee" animate={{ r: [4, 11], opacity: [0.5, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }} />
            <circle cx={x} cy={y} r={4} fill="#22d3ee" />
          </motion.g>
        </svg>

        {/* Distribución por clase de activo */}
        <div className="mt-5">
          <p className="text-xs font-medium text-zinc-500">{t.distribucion}</p>
          <div className="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {CLASES.map((c, i) => (
              <motion.div
                key={i}
                className={`h-full ${c.color} origin-left`}
                style={{ width: `${c.peso}%` }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: activa ? 1 : 0 }}
                transition={{ delay: 0.9 + i * 0.12, duration: 0.6, ease: SUAVE }}
              />
            ))}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            {CLASES.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${c.color}`} />
                {t.clases[i]} <span className="ml-auto font-mono text-zinc-500">{c.peso}%</span>
              </span>
            ))}
          </div>
        </div>

        {/* Posiciones */}
        <div className="mt-5 border-t border-zinc-100 dark:border-[#27272a] pt-4">
          <p className="text-xs font-medium text-zinc-500">{t.posiciones}</p>
          <ul className="mt-2 space-y-2.5">
            {POSICIONES.map((p, i) => {
              const sube = p.cambio >= 0;
              const mini = curva(p.linea, 56, 20, 2);
              return (
                <motion.li
                  key={p.ticker}
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, x: 16 }}
                  animate={activa ? { opacity: 1, x: 0 } : { opacity: 0, x: 16 }}
                  transition={{ delay: 1.2 + i * 0.12, duration: 0.5, ease: SUAVE }}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-zinc-100 dark:bg-zinc-800 font-mono text-[9px] font-bold">{p.ticker.slice(0, 4)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight">{p.ticker}</p>
                    <p className="truncate text-xs text-zinc-500">{p.nombre}</p>
                  </div>
                  <svg viewBox="0 0 56 20" className="h-5 w-14 shrink-0" aria-hidden>
                    <path d={mini.linea} fill="none" stroke={sube ? '#10b981' : '#f87171'} strokeWidth={1.5} strokeLinecap="round" />
                  </svg>
                  <span className={`w-14 shrink-0 text-right font-mono text-sm font-semibold ${sube ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                    {sube ? '+' : ''}{p.cambio.toFixed(1).replace('.', ',')}%
                  </span>
                </motion.li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Avisos que flotan alrededor de la maqueta (solo donde hay espacio) */}
      <Aviso
        activa={activa}
        retraso={1.6}
        className="-left-10 top-[38%] xl:-left-16"
        icono={<CircleCheck className="h-4 w-4 text-indigo-500" />}
        titulo={t.diag}
        texto={t.diagTexto}
      />
      <Aviso
        activa={activa}
        retraso={1.85}
        className="-right-6 -bottom-10 xl:-right-10"
        icono={<Target className="h-4 w-4 text-fuchsia-500" />}
        titulo={t.top}
        texto={t.topTexto}
        desfase={1.2}
      />
    </motion.div>
  );
}

function Aviso({ activa, retraso, className, icono, titulo, texto, desfase = 0 }: {
  activa: boolean; retraso: number; className: string; icono: React.ReactNode; titulo: string; texto: string; desfase?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={activa ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }}
      transition={{ delay: retraso, type: 'spring', stiffness: 260, damping: 18 }}
      className={`absolute hidden sm:block ${className}`}
    >
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: desfase }}
        className="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-[#27272a] bg-white/95 dark:bg-[#18181b]/95 px-3.5 py-2.5 shadow-xl backdrop-blur-md"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-100 dark:bg-zinc-800">{icono}</span>
        <div>
          <p className="text-xs font-semibold">{titulo}</p>
          <p className="text-[11px] text-zinc-500">{texto}</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Cierre: tarjeta oscura donde el logo se dibuja al llegar a ella
function LlamadoFinal({ t, boton }: { t: (typeof TEXTOS)['es']['final']; boton: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const vista = useInView(ref, { once: true, amount: 0.4 });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={vista ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: SUAVE }}
      className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-zinc-800 bg-[#0b0f0e] px-6 py-14 text-center text-white sm:px-12"
    >
      <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:36px_36px] [mask-image:radial-gradient(circle_at_50%_40%,black,transparent_70%)]" />
      <div aria-hidden className="absolute top-0 left-1/2 h-72 w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.35),transparent_65%)]" />
      <div className="relative">
        <div className="mx-auto h-16 w-16">
          {vista && <LogoMarca className="h-16 w-16 text-white drop-shadow-[0_0_18px_rgba(16,185,129,0.45)]" animar retraso={0.2} duracion={1} />}
        </div>
        <h2 className="mx-auto mt-6 max-w-2xl text-balance text-3xl font-bold tracking-tight md:text-4xl">{t.titulo}</h2>
        <p className="mx-auto mt-4 max-w-xl leading-relaxed text-zinc-400">{t.bajada}</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          {boton}
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-xl border border-zinc-700 px-6 py-3.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-zinc-400 hover:text-white"
          >
            {t.entrar}
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
