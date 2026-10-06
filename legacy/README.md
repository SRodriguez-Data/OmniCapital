# Primera versión (Python)

Prototipos con los que empezó el proyecto, antes de la web en Next.js. Ya no se ejecutan en producción;
quedan como referencia.

- `quantum_bot.py`: bot de Telegram con análisis técnico, señales y alertas.
- `quantum_dashboard.py`: panel en Streamlit sobre la base local (SQLite).
- `backend.py`: API en FastAPI para procesar cartolas.
- `migrate_to_supabase.py`: migración de la base local (SQLite) a Supabase.

Lo que sigue en uso está en la raíz: `miner.py` (datos de mercado diarios) y `quantum_trader_serverless.py`
(screener diario), ambos ejecutados por GitHub Actions.
