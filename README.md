# OmniCapital · asesor de inversiones cuantitativo

Plataforma web que consolida las inversiones de una persona en varias corredoras chilenas e internacionales y las analiza como lo haría un asesor: rentabilidad real con dividendos, riesgo de la cartera completa, análisis técnico y fundamental de cada activo, contexto de mercado y noticias, todo ajustado al perfil del inversionista.

**Demo en vivo:** https://quantum-trader-app.vercel.app (botón *Entrar en modo demo*, con un portafolio ficticio)

![Informe del asesor](docs/capturas/informe.png)

## Qué hace

- **Lee las cartolas en PDF** de cinco corredoras (Racional, BTG Pactual, Vector/Zesty, XTB y Fintual), incluso las protegidas con clave, y arma un libro único de compras, ventas, dividendos, impuestos y comisiones. Detecta movimientos duplicados entre archivos, avisa de los meses que faltan y concilia cada período contra el saldo que informa la corredora.
- **Valoriza el portafolio** en pesos y dólares con precios en vivo, y calcula la rentabilidad desde la compra, la TIR y la comparación contra índices.
- **Asesor en cuatro pilares** con reglas explícitas:
  - **Técnico:** tendencia sobre la media de 200 días con banda de ±3%, momentum 12-1, RSI y stop de volatilidad, sobre precios ajustados por dividendos.
  - **Fundamental:** P/U frente a su mercado, ROE, crecimiento, payout, deuda y consenso de analistas. En los ETF, el costo y la composición.
  - **Riesgo:** volatilidad (Newey-West), VaR y Expected Shortfall históricos, covarianza con *shrinkage* de Ledoit-Wolf, beta de Dimson, aporte de cada activo al riesgo y exposición real por empresa, sector y país, contando lo que hay dentro de los fondos.
  - **Mercado:** régimen favorable, cauteloso o defensivo según las tendencias del S&P 500, el IPSA y las acciones globales, más el VIX, el dólar, el cobre y las tasas.
- **Perfil del inversionista:** un cuestionario corto (plazo, tolerancia a caídas, fondo de emergencia, deudas, experiencia) que cambia las recomendaciones. Por ejemplo, no propone aumentar acciones individuales a alguien que necesita el dinero en dos años.
- **Reglas a nivel de cartera:** frena las compras que empeorarían la concentración por sector (más de 35%) o en un país (más de 60%), las de activos casi idénticos a otro que ya se tiene (correlación ≥ 0,9) y las de alto riesgo cuando el mercado está defensivo.
- **IA acotada:** Gemini solo redacta el diagnóstico a partir de los números calculados. Si el texto menciona otra acción o un porcentaje que no está en los datos, se descarta.
- **Noticias** de los últimos 30 días por empresa (Google News y Yahoo Finance), filtradas para que de verdad hablen de la empresa, con su tono resumido.
- **Otras herramientas:** las cinco oportunidades del día según el *screener*, el calendario de dividendos, un optimizador de compras con nuevo capital y *backtesting*.

| Perfil del inversionista | Mi portafolio |
|---|---|
| ![Cuestionario de perfil](docs/capturas/perfil.png) | ![Portafolio](docs/capturas/portafolio.png) |

## Arquitectura

```mermaid
flowchart LR
  GA["GitHub Actions<br/>(Python, días hábiles)"] -->|precios, indicadores,<br/>dividendos, fundamentales| DB[("Supabase<br/>Postgres + Auth + RLS")]
  Y["Yahoo Finance"] --> GA
  DB --> API["Next.js API routes<br/>(Vercel)"]
  Y -. "si la base no está al día" .-> API
  R["Respaldo: Nasdaq, FRED,<br/>mindicador.cl"] -. "si Yahoo falla" .-> API
  API --> IA["Gemini<br/>(solo redacción)"]
  API --> UI["React 19<br/>(navegador)"]
  PDF["Cartolas PDF"] --> UI
```

- Un **minero en Python** corre en GitHub Actions cada madrugada de día hábil, con las bolsas cerradas. Sigue unos 600 activos (S&P 500, Nasdaq 100, acciones chilenas, ETFs y los activos de los usuarios) y es incremental: baja solo el último tramo, de a 100 activos por llamada, continúa los indicadores técnicos desde lo guardado y escribe en Supabase solo los días nuevos (cierre real, dividendos y fundamentales). Nunca guarda un día con la bolsa abierta, corrige los días que Yahoo cambió y, si un split cambia el historial, reescribe el activo.
- La **web** lee primero de la base, así que un informe se arma en segundos sin descargar años de precios. Solo si la base no está al día recurre a Yahoo, y si Yahoo falla, a fuentes gratuitas de respaldo.
- Las **cartolas se procesan en el navegador** con pdf.js: los PDF con datos personales no se suben a ningún servidor.

## Tecnologías

| Capa | Herramientas |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Recharts |
| Backend | API routes de Next.js en Vercel (Node), yahoo-finance2, pdf.js |
| Datos | Supabase (PostgreSQL, Auth, Row Level Security) |
| Pipeline | Python (pandas, NumPy, yfinance) en GitHub Actions |
| IA | Google Gemini (plan gratuito), con salida en JSON validada |
| Cuantitativo | Ledoit-Wolf, Newey-West, VaR y ES históricos, beta de Dimson, paridad de riesgo, frontera eficiente |

## Seguridad y privacidad

- Cada usuario solo ve su portafolio y su perfil (políticas RLS en Postgres). Las tablas de mercado son de solo lectura para la web; únicamente el minero escribe, con una clave que vive en los secretos de GitHub.
- No hay claves en el código: todo va en variables de entorno de Vercel y secretos de GitHub Actions.
- Las cartolas reales no se versionan (`Cartolas/` está en `.gitignore`) y se leen en el navegador.
- Las rutas de la API validan tamaño y forma de lo que reciben y tienen límite de solicitudes por IP.

## Estructura

```
miner.py                       minero diario: precios, indicadores, dividendos y fundamentales -> Supabase
quantum_trader_serverless.py   screener diario (Top 5), correlaciones y frontera eficiente
supabase/                      SQL de tablas, índices y políticas de seguridad
web/src/lib/                   motor: advisor.ts, quant.ts, CartolaParser.ts, LibroInversiones.ts, perfil.ts
web/src/app/api/               rutas de la API (informe, redacción, noticias, precios, backtest)
web/src/app/components/        pestañas de la interfaz
legacy/                        primera versión en Python (Streamlit y bot de Telegram)
```

## Correrlo localmente

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

Variables necesarias en `web/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y, opcionalmente, `GEMINI_API_KEY`. Más detalle en [web/README.md](web/README.md).

---

Proyecto personal. Es una herramienta de apoyo y no constituye asesoría financiera.
