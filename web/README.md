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
| `ANTHROPIC_API_KEY` | IA principal: Claude (`claude-opus-5-5`). Se crea en console.anthropic.com |
| `GEMINI_API_KEY` | IA de respaldo: si Claude falla o no hay clave, se usa Gemini |

Nunca subas claves al repositorio: `.env*` está en `.gitignore`.

## IA

`src/lib/ai.ts` es el único punto de entrada: intenta Claude (`src/lib/claude.ts`) y, ante cualquier error (cuota, saturación, rechazo, red), usa Gemini (`src/lib/gemini.ts`). Las rutas que gastan cuota tienen límite por IP (`src/lib/rateLimit.ts`).

## Datos del bot

`analisis_ia`, `alertas_mercado` y `precios_historicos` los escribe el bot en Python de la carpeta superior (GitHub Actions). Para la web son de solo lectura.
