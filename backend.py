import os
import tempfile
import glob
import sys
import pandas as pd
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from typing import List
from fastapi.responses import JSONResponse

# Agregar el directorio actual al sys.path para poder importar Cartolas
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from Cartolas.extractor_cartolas import orquestador_extraccion

app = FastAPI(title="Quantum Trader Backend")

# Habilitar CORS para que Next.js pueda comunicarse
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Permitir todos los dominios (localhost, vercel)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/upload-cartolas")
async def upload_cartolas(files: List[UploadFile] = File(...)):
    if not files:
        return JSONResponse(status_code=400, content={"error": "No files uploaded"})

    results_data = []

    with tempfile.TemporaryDirectory() as tmp_in:
        with tempfile.TemporaryDirectory() as tmp_out:
            # Guardar archivos subidos
            for file in files:
                file_location = os.path.join(tmp_in, file.filename)
                with open(file_location, "wb") as buffer:
                    content = await file.read()
                    buffer.write(content)
            
            # Procesar con el motor
            try:
                orquestador_extraccion(tmp_in, tmp_out)
            except Exception as e:
                return JSONResponse(status_code=500, content={"error": f"Error en extracción: {str(e)}"})
            
            # Leer los CSVs resultantes y transformarlos a JSON
            csv_files = glob.glob(os.path.join(tmp_out, "**/*.csv"), recursive=True)
            for csv_f in csv_files:
                broker_name = os.path.basename(os.path.dirname(csv_f))
                file_name = os.path.basename(csv_f)
                
                try:
                    df = pd.read_csv(csv_f)
                    records = df.to_dict(orient='records')
                    results_data.append({
                        "broker": broker_name,
                        "file_name": file_name,
                        "data": records
                    })
                except Exception as e:
                    pass

    return {"message": "Procesamiento exitoso", "results": results_data}

# Punto de entrada principal
if __name__ == "__main__":
    import uvicorn
    # Se debe correr en nube con el puerto dinámico asignado por Render/Railway
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("backend:app", host="0.0.0.0", port=port)
