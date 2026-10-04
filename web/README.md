# Quantum Trader (OmniCapital) — web

Plataforma de gestión de portafolios: lector de cartolas (Racional EE.UU./Chile, Fintual), P&L con precios en vivo, dividendos, backtesting y análisis con IA. Next.js 16 (App Router) desplegado en Vercel, con Supabase para auth y datos.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # lo mismo que corre Vercel
npx eslint src   # debe quedar en 0 problemas
```

## Variables de entorno

En `.env.local` (local) y en **Vercel → Settings → Environment Variables** (producción):

| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública (publishable) de Supabase |
| `GEMINI_API_KEY` | IA (Google Gemini, plan gratuito). Se crea en aistudio.google.com |

Nunca subas claves al repositorio: `.env*` está en `.gitignore`.

## IA

`src/lib/ai.ts` es el único punto de entrada. Usa Gemini (`src/lib/gemini.ts`) con una cadena de modelos: `gemini-3.5-flash` para análisis más cuidadosos y `gemini-flash-lite-latest` para respuestas rápidas; si un modelo está saturado o sin cuota, se prueba el siguiente. Las rutas que gastan cuota tienen límite por IP (`src/lib/rateLimit.ts`).

## Datos del bot

`analisis_ia`, `alertas_mercado` y `precios_historicos` los escribe el bot en Python de la carpeta superior (GitHub Actions). Para la web son de solo lectura.
