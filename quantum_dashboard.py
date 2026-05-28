import streamlit as st
import sqlite3
import pandas as pd
import yfinance as yf
import os
from dotenv import load_dotenv, set_key
import google.generativeai as genai

# Configuración de página DEBE ser el primer comando de Streamlit
st.set_page_config(page_title="Quantum Portfolio Bot", layout="wide", page_icon="🌌", initial_sidebar_state="expanded")

# Cargar variables de entorno
load_dotenv()
ENV_PATH = ".env"

# Inicializar portafolio en Session State
if "portfolio" not in st.session_state:
    raw_tickers = os.getenv("PORTFOLIO_TICKERS", "")
    st.session_state.portfolio = [t.strip().upper() for t in raw_tickers.split(",") if t.strip()]

def save_portfolio(new_list):
    st.session_state.portfolio = new_list
    new_val = ",".join(new_list)
    # Actualizar .env usando set_key de python-dotenv
    try:
        set_key(ENV_PATH, "PORTFOLIO_TICKERS", new_val)
    except Exception as e:
        st.sidebar.error(f"No se pudo guardar en .env: {e}")
    os.environ["PORTFOLIO_TICKERS"] = new_val

# ==========================================
# 1. BARRA LATERAL (SIDEBAR) - MI PORTAFOLIO
# ==========================================
with st.sidebar:
    st.title("💼 Mi Portafolio")
    st.markdown("Gestión de activos cuánticos")
    
    st.markdown("### 📋 Activos Actuales")
    
    # Mostrar activos con botón de eliminar
    for ticker in st.session_state.portfolio:
        cols = st.columns([3, 1])
        cols[0].markdown(f"<div style='padding-top: 8px; font-weight: bold;'>{ticker}</div>", unsafe_allow_html=True)
        if cols[1].button("🗑️", key=f"del_{ticker}", help=f"Eliminar {ticker}"):
            new_port = [t for t in st.session_state.portfolio if t != ticker]
            save_portfolio(new_port)
            st.rerun()
            
    st.markdown("---")
    
    # Formulario para agregar activos
    st.markdown("### ➕ Agregar Activo")
    new_ticker = st.text_input("Símbolo (Ticker):", placeholder="Ej: AAPL").upper()
    if st.button("Añadir al Portafolio", use_container_width=True):
        if new_ticker and new_ticker not in st.session_state.portfolio:
            new_port = st.session_state.portfolio + [new_ticker]
            save_portfolio(new_port)
            st.success(f"¡{new_ticker} añadido!")
            st.rerun()
        elif new_ticker in st.session_state.portfolio:
            st.warning(f"{new_ticker} ya está en tu portafolio.")

# ==========================================
# PANEL PRINCIPAL
# ==========================================
st.title("🌌 Quantum Portfolio Dashboard")
st.markdown("Bienvenido al terminal financiero de próxima generación.")

# Pestañas principales
tab_scanner, tab_robo = st.tabs(["📊 Escáner Cuantitativo", "🤖 Robo-Advisor"])

# ==========================================
# 2. PANEL PRINCIPAL - ESCÁNER CUANTITATIVO
# ==========================================
with tab_scanner:
    st.header("Escáner Cuantitativo Institucional")
    st.markdown("""
    **Filtros activos:** 
    📉 RSI < 40 &nbsp;&nbsp;|&nbsp;&nbsp; 💰 Dividendos: 2% - 8% &nbsp;&nbsp;|&nbsp;&nbsp; ⚖️ P/E < 25 &nbsp;&nbsp;|&nbsp;&nbsp; 🛡️ Payout < 0.75 &nbsp;&nbsp;|&nbsp;&nbsp; 🏢 Deuda/Equity < 150
    """)
    
    @st.cache_data(ttl=3600, show_spinner=False)
    def run_scanner():
        # 1. Conectar a SQLite y buscar última fecha + RSI < 40
        try:
            conn = sqlite3.connect("quantum_database.db")
            query = """
            SELECT ticker, date, rsi 
            FROM precios_historicos 
            WHERE date = (SELECT MAX(date) FROM precios_historicos)
            AND rsi < 40
            """
            df_rsi = pd.read_sql(query, conn)
            conn.close()
        except Exception as e:
            st.error(f"Error conectando a la base de datos (SQLite): {e}")
            return pd.DataFrame()

        if df_rsi.empty:
            return pd.DataFrame()
            
        results = []
        
        # ProgressBar visual para el usuario
        progress_text = "Escaneando fundamentales en YFinance..."
        bar = st.progress(0, text=progress_text)
        
        total = len(df_rsi)
        
        # 2. Filtrar fundamentales con YFinance
        for idx, row in df_rsi.iterrows():
            # Actualizar barra
            bar.progress(int((idx / total) * 100), text=f"Analizando {row['ticker']} ({idx}/{total})...")
            
            ticker = row['ticker']
            try:
                info = yf.Ticker(ticker).info
                
                div_yield = info.get("dividendYield", 0) or 0
                pe = info.get("trailingPE", info.get("forwardPE", 999)) or 999
                payout = info.get("payoutRatio", 1.0) or 1.0
                debt_eq = info.get("debtToEquity", 999) or 999
                
                # Aplicar los filtros institucionales
                if (0.005 <= div_yield <= 0.10) and (pe < 30) and (payout < 0.85) and (debt_eq < 250):
                    results.append({
                        "Activo (Ticker)": ticker,
                        "Fecha Dato": row['date'][:10], # Solo AAAA-MM-DD
                        "RSI (Técnico)": f"{row['rsi']:.2f} 📉",
                        "Div Yield": f"{div_yield * 100:.2f}% 💰",
                        "P/E Ratio": f"{pe:.2f} ⚖️",
                        "Payout Ratio": f"{payout:.2f} 🛡️",
                        "Debt/Equity": f"{debt_eq:.2f} 🏢"
                    })
            except Exception:
                continue
                
        bar.empty() # Limpiar la barra al terminar
        return pd.DataFrame(results)

    if st.button("🚀 Iniciar Escáner", use_container_width=True):
        with st.spinner("Ejecutando algoritmos cuantitativos..."):
            df_results = run_scanner()
            
        if not df_results.empty:
            st.success(f"¡Se encontraron {len(df_results)} oportunidades de inversión!")
            st.dataframe(
                df_results, 
                use_container_width=True, 
                hide_index=True,
                height=400
            )
        else:
            st.info("📊 Tras escanear la base de datos, ningún activo cumple con los rigurosos filtros institucionales en la sesión actual.")

# ==========================================
# 3. PESTAÑA DE ROBO-ADVISOR (CHATBOT)
# ==========================================
with tab_robo:
    st.header("Robo-Advisor Cuántico 🤖")
    st.markdown("Asesoramiento impulsado por IA con contexto de tu portafolio y base de datos.")
    
    # Inicializar historial de chat
    if "messages" not in st.session_state:
        st.session_state.messages = []
        
    # Mostrar historial
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])
            
    # Input de usuario
    if prompt := st.chat_input("Pregúntale a tu asesor financiero cuántico..."):
        
        # 1. Mostrar mensaje del usuario
        with st.chat_message("user"):
            st.markdown(prompt)
        st.session_state.messages.append({"role": "user", "content": prompt})
        
        # 2. Configurar LLM y Contexto
        api_key = os.getenv("GEMINI_API_KEY")
        
        if not api_key:
            with st.chat_message("assistant"):
                st.error("⚠️ Error: API Key de Gemini no encontrada en el archivo .env")
        else:
            try:
                # Configuración de GenAI
                genai.configure(api_key=api_key)
                
                # BÚSQUEDA AUTOMÁTICA DEL MODELO CORRECTO
                modelo_valido = 'gemini-1.5-flash' # Valor por defecto
                for m in genai.list_models():
                    if 'generateContent' in m.supported_generation_methods:
                        modelo_valido = m.name
                        break # Tomamos el primero que funcione con tu API Key
                
                model = genai.GenerativeModel(modelo_valido)
                
                # Contexto del Sistema
                portfolio_str = ", ".join(st.session_state.portfolio)
                system_context = f"Eres mi asesor financiero cuántico. Basa tus respuestas en los activos de mi portafolio ({portfolio_str}) y los datos técnicos de mi base de datos SQLite."
                
                full_prompt = f"CONTEXTO DEL SISTEMA:\n{system_context}\n\nPREGUNTA DEL USUARIO:\n{prompt}"
                
                with st.chat_message("assistant"):
                    with st.spinner(f"🧠 Procesando con {modelo_valido}..."):
                        response = model.generate_content(full_prompt)
                        st.markdown(response.text)
                
                # Guardar respuesta
                st.session_state.messages.append({"role": "assistant", "content": response.text})
                
            except Exception as e:
                with st.chat_message("assistant"):
                    st.error(f"❌ Error de comunicación con el LLM: {e}")
