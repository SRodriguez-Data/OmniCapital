import sqlite3
import pandas as pd
from supabase import create_client, Client
import logging
import math
import os
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

load_dotenv()

# These will be set in the .env file
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    logging.error("Faltan credenciales de Supabase en el archivo .env")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def migrate_data():
    logging.info("🔌 Conectando a SQLite (quantum_database.db)...")
    try:
        conn = sqlite3.connect("quantum_database.db")
        df = pd.read_sql_query("SELECT * FROM precios_historicos", conn)
        conn.close()
    except Exception as e:
        logging.error(f"Error al leer SQLite: {e}")
        return

    total_rows = len(df)
    logging.info(f"📊 {total_rows} registros encontrados en SQLite.")

    if total_rows == 0:
        logging.info("Nada que migrar.")
        return

    # Clean up NaN/NaT values for JSON serialization
    df = df.replace({float('nan'): None})
    df['date'] = df['date'].astype(str)

    # We need to insert in chunks because Supabase/Postgrest has a payload limit
    chunk_size = 5000
    total_chunks = math.ceil(total_rows / chunk_size)

    logging.info(f"🚀 Iniciando subida a Supabase en {total_chunks} bloques de {chunk_size}...")

    for i in range(total_chunks):
        start_idx = i * chunk_size
        end_idx = min((i + 1) * chunk_size, total_rows)
        chunk = df.iloc[start_idx:end_idx]
        
        # Convert to list of dicts
        records = chunk.to_dict(orient='records')
        
        try:
            response = supabase.table("precios_historicos").insert(records).execute()
            logging.info(f"✅ Bloque {i+1}/{total_chunks} migrado exitosamente.")
        except Exception as e:
            logging.error(f"❌ Error al migrar el bloque {i+1}: {e}")

    logging.info("🎉 Migración a Supabase completada.")

if __name__ == "__main__":
    migrate_data()
