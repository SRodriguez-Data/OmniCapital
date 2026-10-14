import os
import sys
import time
import importlib
import requests
import json
import logging
import pandas as pd
import yfinance as yf
import numpy as np
from datetime import datetime
from supabase import create_client, Client
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

REST = None
try:
    REST = importlib.import_module("alpaca_trade_api").REST
except ModuleNotFoundError:
    REST = None

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

ALPACA_API_KEY = os.getenv('ALPACA_API_KEY')
ALPACA_SECRET_KEY = os.getenv('ALPACA_SECRET_KEY')
ALPACA_BASE_URL = 'https://paper-api.alpaca.markets'

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Tickers will be dynamically fetched from mi_portafolio

if SUPABASE_URL and SUPABASE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    supabase = None

# Si un modelo falla o se agota su cuota gratis, se usa el siguiente. gemini-3.5-flash no tiene cuota gratis con
# esta clave (429) y el SDK reintentaba varios minutos antes de rendirse: por eso el tope de tiempo por modelo
MODELOS_GEMINI = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite']
TIEMPO_MAXIMO_GEMINI = 180
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

def compute_quant_math(tickers):
    if not tickers or not supabase:
        return {}, []
    try:
        res = supabase.table("precios_historicos")\
            .select("date, ticker, close")\
            .in_("ticker", tickers)\
            .order("date", desc=True)\
            .limit(100 * len(tickers)).execute()
            
        if not res.data:
            return {}, []
            
        df = pd.DataFrame(res.data)
        df_pivot = df.pivot_table(index="date", columns="ticker", values="close")
        df_pivot = df_pivot.sort_index()
        
        returns = df_pivot.pct_change().dropna()
        if returns.empty:
            return {}, []
            
        corr_matrix = returns.corr().round(2)
        # Un precio congelado no varía y su correlación sale NaN, que no se puede guardar como JSON
        corr_json = {t: {k: (None if pd.isna(v) else v) for k, v in corr_matrix[t].items()} for t in corr_matrix.columns}
            
        num_portfolios = 3000
        risk_free_rate = 0.04
        mean_returns = returns.mean() * 252
        cov_matrix = returns.cov() * 252
        
        results = []
        num_assets = len(returns.columns)
        np.random.seed(42)
        
        for _ in range(num_portfolios):
            weights = np.random.random(num_assets)
            weights /= np.sum(weights)
            
            port_return = np.sum(mean_returns * weights)
            port_std_dev = np.sqrt(np.dot(weights.T, np.dot(cov_matrix, weights)))
            port_sharpe = (port_return - risk_free_rate) / port_std_dev
            
            w_dict = {returns.columns[i]: round(weights[i], 3) for i in range(num_assets)}
            
            results.append({
                "riesgo": round(port_std_dev * 100, 2),
                "retorno": round(port_return * 100, 2),
                "sharpe": round(port_sharpe, 2),
                "pesos": w_dict
            })
            
        import random
        max_sharpe = max(results, key=lambda x: x["sharpe"])
        min_vol = min(results, key=lambda x: x["riesgo"])
        
        sample_results = random.sample(results, min(300, len(results)))
        if max_sharpe not in sample_results: sample_results.append(max_sharpe)
        if min_vol not in sample_results: sample_results.append(min_vol)
        
        return corr_json, sample_results
    except Exception as e:
        logging.error(f"Error calculando Matemáticas Cuantitativas: {e}")
        return {}, []


def tickers_con_datos_frescos(tickers, max_date):
    """Yahoo a veces repite el mismo cierre por semanas en acciones chilenas; un RSI calculado sobre eso es falso
    (precio plano y luego una caída da RSI cercano a 0). Se descartan los tickers con pocos cierres distintos
    en sus últimos 20 días."""
    desde = (pd.Timestamp(max_date) - pd.Timedelta(days=40)).strftime("%Y-%m-%d")
    buenos = set()
    for i in range(0, len(tickers), 25):
        lote = tickers[i:i + 25]
        res = supabase.table("precios_historicos").select("date, ticker, close")            .in_("ticker", lote).gte("date", desde).order("date", desc=True).limit(1000).execute()
        if not res.data:
            continue
        df = pd.DataFrame(res.data)
        for t, g in df.groupby("ticker"):
            ultimos = g.sort_values("date", ascending=False).head(20)["close"]
            if len(ultimos) >= 15 and ultimos.nunique() >= 12:
                buenos.add(t)
    return buenos

def es_numero(x):
    return isinstance(x, (int, float)) and not pd.isna(x)

def deuda_desde_balance(tk):
    """Yahoo no informa debtToEquity en bancos y otras financieras (ni en algunas empresas): se calcula con el
    último balance, trimestral o anual, que traiga deuda y patrimonio. Devuelve (deuda/patrimonio en %,
    patrimonio/activos en %, fecha del balance); deuda/patrimonio es None si el patrimonio es negativo."""
    for balance in (tk.quarterly_balance_sheet, tk.balance_sheet):
        if balance is None or balance.empty or 'Stockholders Equity' not in balance.index or 'Total Debt' not in balance.index:
            continue
        for col in sorted(balance.columns, reverse=True):
            patrimonio, deuda = balance.at['Stockholders Equity', col], balance.at['Total Debt', col]
            if not (es_numero(patrimonio) and es_numero(deuda)) or patrimonio == 0:
                continue
            activos = balance.at['Total Assets', col] if 'Total Assets' in balance.index else None
            pat_activos = patrimonio / activos * 100 if es_numero(activos) and activos > 0 else None
            return (deuda / patrimonio * 100 if patrimonio > 0 else None), pat_activos, col.strftime('%Y-%m-%d')
    return None, None, None

def proximos_resultados(info):
    """Fecha del próximo reporte trimestral, si Yahoo la conoce: comprar justo antes es apostar al resultado."""
    ahora = time.time()
    fechas = [info.get(k) for k in ('earningsTimestamp', 'earningsTimestampStart')]
    futuras = [f for f in fechas if es_numero(f) and f > ahora - 86400]
    return datetime.utcfromtimestamp(min(futuras)).strftime('%Y-%m-%d') if futuras else None

def ultimas_filas(max_date, dias=5):
    """La última fila guardada de cada activo en los últimos días. Si solo se miraran las filas de la fecha más
    reciente, un feriado en una bolsa (el 12 de octubre en Chile) o Yahoo atrasado en publicar el cierre de la
    otra (el de EE.UU. sale pasadas las 21:00 de Nueva York) dejaría a ese mercado entero fuera del análisis."""
    desde = (pd.Timestamp(max_date) - pd.Timedelta(days=dias)).strftime("%Y-%m-%d")
    filas, inicio = [], 0
    while True:
        lote = (supabase.table("precios_historicos").select("*").gte("date", desde)
                .order("date", desc=True).order("ticker").range(inicio, inicio + 999).execute().data or [])
        filas += lote
        if len(lote) < 1000:
            break
        inicio += 1000
    ultimas = {}
    for f in filas:  # de la más reciente a la más antigua: queda la última de cada activo
        ultimas.setdefault(f['ticker'], f)
    return list(ultimas.values())

def get_fundamentals(ticker):
    """P/E, dividendo y deuda/patrimonio (en %), cada uno con su fuente o el motivo por el que no aplica:
    la web no muestra un dato en blanco sin explicar por qué."""
    try:
        tk = yf.Ticker(ticker)
        info = tk.info
        tipo = 'etf' if info.get('quoteType') in ('ETF', 'MUTUALFUND') else 'accion'
        sector = info.get('sector')

        pe, pe_nota = info.get('trailingPE'), None
        if not es_numero(pe):
            pe, pe_nota = info.get('forwardPE'), 'estimado'
        if not es_numero(pe) or pe <= 0:
            eps = info.get('trailingEps')
            pe, pe_nota = -1, 'perdidas' if es_numero(eps) and eps < 0 else 'sin dato'
        # En inmobiliarias/REITs el P/E (ganancia contable) no mide su valor: se valoran por su flujo (FFO)
        if sector == 'Real Estate':
            pe, pe_nota = -1, 'reit'

        # Yahoo cambió 'dividendYield' a porcentaje (3.46 = 3,46%); multiplicarlo por 100 daba 346%.
        # Se calcula como dividendo anual / precio, que no depende de ese formato.
        rate = info.get('dividendRate')
        price = info.get('currentPrice') or info.get('regularMarketPrice') or info.get('previousClose')
        if es_numero(rate) and es_numero(price) and price > 0:
            div_pct = rate / price * 100
        else:
            div = info.get('dividendYield')
            div_pct = div if es_numero(div) else 0
        div_str = f"{div_pct:.2f}%"

        deuda, deuda_fuente, deuda_nota, pat_activos = None, None, None, None
        if tipo == 'etf':
            deuda_nota = 'etf'
        else:
            if es_numero(info.get('debtToEquity')):
                deuda, deuda_fuente = info['debtToEquity'], 'yahoo'
            # En bancos y aseguradoras la deuda es parte del negocio: su colchón se mide como patrimonio / activos
            financiera = sector == 'Financial Services'
            if deuda is None or financiera:
                dte, pat_activos, fecha = deuda_desde_balance(tk)
                if deuda is None and fecha:
                    deuda, deuda_fuente = dte, f'balance {fecha}'
                    if dte is None:
                        deuda_nota = 'patrimonio negativo'
                if not financiera:
                    pat_activos = None
            if deuda is None and deuda_nota is None:
                deuda_nota = 'sin dato'

        return {"pe": pe, "pe_nota": pe_nota, "div_str": div_str, "deuda": deuda, "deuda_fuente": deuda_fuente,
                "deuda_nota": deuda_nota, "patrimonio_activos": pat_activos, "tipo": tipo, "sector": sector,
                "industria": info.get('industry'), "proximos_resultados": proximos_resultados(info)}
    except Exception as e:
        logging.error(f"Error fetching YF for {ticker}: {e}")
        return {"pe": -1, "pe_nota": "sin dato", "div_str": "0.00%", "deuda": None, "deuda_nota": "sin dato", "tipo": "accion"}

def texto_fundamentales(c):
    pe = {'reit': 'P/E no aplica (REIT)', 'perdidas': 'P/E negativo (pérdidas)'}.get(c.get('pe_nota'), f"P/E {c['pe']:.1f}")
    if c.get('deuda') is not None:
        deuda = f"Deuda/Patrimonio {c['deuda']:.0f}%"
    else:
        deuda = {'etf': 'Deuda no aplica (ETF)', 'patrimonio negativo': 'Patrimonio negativo'}.get(c.get('deuda_nota'), 'Deuda sin dato')
    return f"{pe}, Dividend Yield {c['div_str']}, {deuda}"

METODO_TOP = "v2"
IDEAS_EEUU = 20
IDEAS_CHILE = 5

def ideas_calidad_eeuu(filas):
    """Las acciones del S&P 500 con la utilidad más respaldada por caja frente a su sector: el método
    calidad_eeuu de evidencia.py, el único que en 10 años le ganó al mercado de forma consistente (en las dos
    mitades de la muestra). Excluye bancos y aseguradoras y a las que reparten más que su utilidad.
    `filas`: ticker -> última fila de precio. Devuelve (ideas, tabla de calidad de todas las evaluadas)."""
    import evidencia
    import fundamentales_sec
    sp = evidencia.tabla_sp500()
    if sp is None:
        return [], {}
    sector_de = dict(zip(sp["ticker"], sp["GICS Sector"]))
    sec = fundamentales_sec.Sec()
    hoy = pd.Timestamp.now().normalize()
    anual = fundamentales_sec.anuales(sec, [hoy.year - 2, hoy.year - 1, hoy.year])
    # La última cifra anual ya conocida de cada empresa, si no tiene más de 15 meses
    vigente = (anual[(anual["conocido"] <= hoy) & (anual["cierre"] >= hoy - pd.Timedelta(days=455))]
               .sort_values("cierre").groupby("cik").tail(1).set_index("cik"))
    ciks = sec.ciks()
    regs = []
    for t in sp["ticker"]:
        if t not in filas or ciks.get(t) not in vigente.index or sector_de.get(t) == "Financials":
            continue
        f = vigente.loc[ciks[t]]
        if not (es_numero(f.get("activos")) and f["activos"] > 0 and es_numero(f.get("flujo_operacional")) and es_numero(f.get("utilidad"))):
            continue
        pago = f.get("pago_en_acciones") if es_numero(f.get("pago_en_acciones")) else 0
        div = f.get("dividendos")
        calidad = (f["flujo_operacional"] - pago - f["utilidad"]) / f["activos"]
        # Igual que evidencia.py: una diferencia mayor a la mitad de los activos es una cifra mal escalada
        if abs(calidad) > 0.5:
            logging.warning(f"{t}: calidad de utilidades implausible ({calidad:.0%} de los activos), se descarta.")
            continue
        regs.append({"ticker": t, "sector_gics": sector_de.get(t), "calidad": calidad,
                     "payout_alto": bool(es_numero(div) and f["utilidad"] > 0 and div / f["utilidad"] > 1),
                     "cierre_fiscal": f["cierre"].strftime("%Y-%m-%d")})
    if not regs:
        return [], {}
    df = pd.DataFrame(regs)
    df["percentil_sector"] = df.groupby("sector_gics")["calidad"].rank(pct=True)
    tabla = {r.ticker: {"c": round(float(r.calidad), 4), "p": round(float(r.percentil_sector), 3), "pa": r.payout_alto}
             for r in df.itertuples()}
    elegidas = df[~df["payout_alto"]].sort_values(["percentil_sector", "calidad"], ascending=False).head(IDEAS_EEUU)
    logging.info(f"Calidad de utilidades: {len(df)} acciones evaluadas, elegidas {', '.join(elegidas['ticker'])}")
    ideas = []
    for r in elegidas.itertuples():
        fila = filas[r.ticker]
        ideas.append({"ticker": r.ticker, "price": fila["close"], "fecha_precio": fila["date"][:10],
                      "score": round(float(r.percentil_sector), 4), "calidad": round(float(r.calidad), 4),
                      "percentil_sector": round(float(r.percentil_sector), 3), "sector_gics": r.sector_gics,
                      "cierre_fiscal": r.cierre_fiscal, **get_fundamentals(r.ticker)})
    return ideas, tabla

def dividendos_desde(tickers, desde):
    filas = []
    for i in range(0, len(tickers), 50):
        filas += (supabase.table("dividendos").select("ticker, fecha, monto").in_("ticker", tickers[i:i + 50])
                  .gte("fecha", desde).execute().data or [])
    por = {}
    for f in filas:
        por.setdefault(f["ticker"], []).append((f["fecha"][:10], f["monto"]))
    return por

def ideas_momentum_chile(filas):
    """Las acciones chilenas con mayor retorno (con dividendos) entre hace 12 meses y hace 1 mes: el método
    momentum_chile de evidencia.py (evidencia débil). `filas`: ticker -> última fila con volumen (precio de hoy
    real). Yahoo deja semanas sin actualizar en Chile: se aceptan esos huecos si no son más de la mitad del año."""
    tickers = sorted(filas)
    if not tickers:
        return []
    desde = (pd.Timestamp.now() - pd.Timedelta(days=420)).strftime("%Y-%m-%d")
    precios = cierres(tickers, desde)
    divs = dividendos_desde(tickers, desde)
    candidatos = []
    for t, serie in precios.items():
        if len(serie) < 253 or serie.iloc[-253:].nunique() < 0.5 * 253:
            continue
        inicio, fin = serie.index[-253], serie.index[-22]
        pagado = sum(m for f, m in divs.get(t, []) if inicio < f <= fin)
        candidatos.append((t, (serie.iloc[-22] + pagado) / serie.iloc[-253] - 1))
    candidatos.sort(key=lambda x: -x[1])
    ideas = []
    for t, mom in candidatos[:IDEAS_CHILE]:
        fila = filas[t]
        ideas.append({"ticker": t, "price": fila["close"], "fecha_precio": fila["date"][:10], "score": round(float(mom), 4),
                      "momentum": round(float(mom), 4), **get_fundamentals(t)})
    logging.info(f"Momentum Chile: {len(candidatos)} acciones evaluadas, elegidas {', '.join(i['ticker'] for i in ideas)}")
    return ideas

def linea_prompt(c):
    if 'calidad' in c:
        return (f"- {c['ticker']} ({c.get('sector_gics')}): utilidad respaldada por caja {c['calidad']*100:.1f}% de los activos "
                f"(percentil {c['percentil_sector']*100:.0f} de su sector), {texto_fundamentales(c)}")
    return f"- {c['ticker']}: alza de {c['momentum']*100:.1f}% entre hace 12 meses y hace 1 mes, {texto_fundamentales(c)}"

# Índice con el que se compara cada idea (precio sin dividendos, igual que los cierres guardados de las acciones)
INDICE_DE = {'EE.UU.': '^GSPC', 'Chile': 'CFMITNIPSA.SN'}
DIAS_UN_MES = 21

def ideas_mostradas(cj):
    """Las ideas que mostró la web con ese escaneo (TopOportunidadesTab.tsx). Con el método actual, todas; con el
    anterior, las 5 de mayor puntaje entre EE.UU. y Chile, más la mejor chilena si no había ninguna."""
    us, cl = cj.get('us') or [], cj.get('cl') or []
    if cj.get('metodo') == METODO_TOP:
        return us + cl
    clave = lambda c: c['score'] if isinstance(c.get('score'), (int, float)) else float('-inf')
    top = sorted(us + cl, key=clave, reverse=True)[:5]
    if cl and not any(c['ticker'].endswith('.SN') for c in top):
        top.append(max(cl, key=clave))
    return top

def cierres(tickers, desde):
    """Cierres guardados desde `desde`, como {ticker: Serie por fecha}."""
    filas = []
    for i in range(0, len(tickers), 20):
        inicio = 0
        while True:
            lote = (supabase.table("precios_historicos").select("ticker, date, close").in_("ticker", tickers[i:i + 20])
                    .gte("date", desde).order("date").order("ticker").range(inicio, inicio + 999).execute().data or [])
            filas += lote
            if len(lote) < 1000:
                break
            inicio += 1000
    if not filas:
        return {}
    df = pd.DataFrame(filas)
    df['date'] = df['date'].str[:10]
    return {t: g.set_index('date')['close'].sort_index() for t, g in df.groupby('ticker')}

def resumen_excesos(excesos):
    if not excesos:
        return None
    e = pd.Series(excesos)
    return {"ideas": int(len(e)), "exceso_promedio": round(float(e.mean()), 4), "mediana": round(float(e.median()), 4),
            "acierto": round(float((e > 0).mean()), 3)}

def historial_ideas():
    """Historial del método actual y del anterior, por separado: no se mezclan dos formas de elegir."""
    filas = (supabase.table("analisis_ia").select("fecha, metodo:candidatos_json->metodo").order("fecha").execute().data or [])
    actual = [f["fecha"] for f in filas if f.get("metodo") == METODO_TOP]
    return {"metodo": METODO_TOP, "desde_metodo_actual": actual[0][:10] if actual else None,
            "actual": historial_de(lambda m: m == METODO_TOP), "anterior": historial_de(lambda m: m != METODO_TOP)}

def historial_de(es_del_metodo):
    """Cómo les fue de verdad a las ideas que mostró el Top: cada escaneo guardado se compra al cierre de su fecha
    y se compara con el índice de su mercado a un mes y hasta hoy. Se usan los cierres guardados hoy (ya
    corregidos), no el precio del escaneo, que en los primeros meses a veces era uno de mitad de jornada."""
    filas = (supabase.table("analisis_ia").select("fecha, us:candidatos_json->us, cl:candidatos_json->cl, fp:candidatos_json->fecha_precios, metodo:candidatos_json->metodo")
             .order("fecha").execute().data or [])
    filas = [f for f in filas if (f.get('us') or f.get('cl')) and es_del_metodo(f.get('metodo'))]
    if not filas:
        return None
    desde = filas[0]['fecha'][:10]
    tickers = sorted({c['ticker'] for f in filas for c in ideas_mostradas({'us': f.get('us'), 'cl': f.get('cl'), 'metodo': f.get('metodo')})} | set(INDICE_DE.values()))
    precios = cierres(tickers, (pd.Timestamp(desde) - pd.Timedelta(days=10)).strftime("%Y-%m-%d"))
    calendario = {m: list(precios[t].index) if t in precios else [] for m, t in INDICE_DE.items()}

    # Un escaneo por fecha de precios (el último de ese día); los antiguos sin fecha usan el cierre previo al escaneo
    por_fecha = {}
    for f in filas:
        cal = calendario['EE.UU.']
        entrada = (f.get('fp') or '')[:10] or next((d for d in reversed(cal) if d < f['fecha'][:10]), None)
        if entrada:
            por_fecha[entrada] = ideas_mostradas({'us': f.get('us'), 'cl': f.get('cl'), 'metodo': f.get('metodo')})

    un_mes = {'EE.UU.': [], 'Chile': []}
    a_la_fecha = {'EE.UU.': [], 'Chile': []}
    distintas, excluidas = set(), 0
    for entrada, ideas in por_fecha.items():
        for c in ideas:
            mercado = 'Chile' if c['ticker'].endswith('.SN') else 'EE.UU.'
            serie, indice = precios.get(c['ticker']), precios.get(INDICE_DE[mercado])
            cal = calendario[mercado]
            if serie is None or indice is None or not cal:
                continue
            serie = serie[serie.index >= entrada]
            dias = [d for d in cal if d >= entrada]
            # Acciones con el precio congelado en la fuente no tienen un retorno real que medir
            if len(serie) < 2 or len(dias) < 2 or serie.nunique() < 0.5 * len(serie):
                excluidas += 1
                continue
            p0 = serie.iloc[0]
            i0 = indice[indice.index <= dias[0]].iloc[-1]
            for destino, salida in ((a_la_fecha, dias[-1]), (un_mes, dias[DIAS_UN_MES] if len(dias) > DIAS_UN_MES else None)):
                if salida is None:
                    continue
                p1 = serie[serie.index <= salida].iloc[-1]
                i1 = indice[indice.index <= salida].iloc[-1]
                destino[mercado].append((p1 / p0 - 1) - (i1 / i0 - 1))
            distintas.add(c['ticker'])

    if not por_fecha:
        return None
    return {
        "desde": min(por_fecha), "hasta": max(d for cal in calendario.values() for d in cal[-1:]),
        "escaneos": len(por_fecha), "acciones_distintas": len(distintas), "excluidas_precio_congelado": excluidas,
        "indices": INDICE_DE,
        "un_mes": {m: resumen_excesos(v) for m, v in un_mes.items()},
        "a_la_fecha": {m: resumen_excesos(v) for m, v in a_la_fecha.items()},
        "un_mes_total": resumen_excesos(un_mes['EE.UU.'] + un_mes['Chile']),
    }

def run_serverless_screener():
    logging.info("🚀 Iniciando Quantum Trader Serverless (Institucional)...")
    
    # Sin credenciales o sin datos el job debe quedar en rojo en GitHub Actions, no en verde sin hacer nada
    if not supabase or not GEMINI_API_KEY:
        logging.error("❌ Faltan credenciales clave (Supabase o Gemini).")
        sys.exit(1)

    # 1. Extraer los datos más recientes
    try:
        res_date = supabase.table("precios_historicos").select("date").order("date", desc=True).limit(1).execute()
        if not res_date.data:
            logging.error("❌ No hay precios guardados.")
            sys.exit(1)
        max_date = res_date.data[0]['date']
        activos_hoy = ultimas_filas(max_date)
        # Cuántos activos ya tienen el cierre más reciente: si Yahoo publicó después los de la otra bolsa, la
        # fecha es la misma pero los precios no, y el análisis se rehace
        al_dia = sum(1 for r in activos_hoy if r['date'] == max_date)

        # La corrida de respaldo no repite el análisis (ni gasta cuota de Gemini) si ya se hizo con estos precios
        if not os.getenv("FORZAR_ANALISIS"):
            ultimo = (supabase.table("analisis_ia").select("candidatos_json->fecha_precios, candidatos_json->activos_al_dia")
                      .order("fecha", desc=True).limit(1).execute().data)
            if ultimo and ultimo[0].get("fecha_precios") == max_date and ultimo[0].get("activos_al_dia") == al_dia:
                logging.info(f"✅ El análisis con los precios del {max_date[:10]} ya está hecho; no se repite.")
                return
        rezagados = len(activos_hoy) - al_dia
        if rezagados:
            logging.info(f"{rezagados} activos sin cierre del {max_date[:10]} (feriado o Yahoo atrasado): se usa su último cierre.")
    except Exception as e:
        logging.error(f"Error consultando Supabase: {e}")
        sys.exit(1)

    liquidos = {}

    # 2. Liquidez: montos transados mínimos (en Chile en pesos). Índices y monedas son referencias, no ideas
    for row in activos_hoy:
        ticker = row['ticker']
        close = row.get('close') or 0
        volumen_nominal = (row.get('volume') or 0) * close
        if ticker.startswith('^') or '=' in ticker or close <= 0:
            continue
        if volumen_nominal < (450_000_000 if ticker.endswith(".SN") else 500_000):
            continue
        liquidos[ticker] = row

    # Yahoo congela el historial de varias acciones chilenas: sin precios reales no hay momentum que medir
    frescos = tickers_con_datos_frescos(list(liquidos), max_date)
    congelados = [t for t in liquidos if t not in frescos]
    if congelados:
        logging.warning(f"{len(congelados)} tickers con precios congelados en Yahoo: {', '.join(congelados[:30])}")

    # Ideas con evidencia medida (evidencia.py, METODOS)
    calidad_us = {}
    try:
        top_us, calidad_us = ideas_calidad_eeuu({t: r for t, r in liquidos.items() if not t.endswith('.SN') and t in frescos})
    except Exception as e:
        logging.error(f"No se calcularon las ideas de EE.UU.: {str(e)[:200]}")
        top_us = []
    # El monto transado mínimo ya exige volumen hoy: el último precio chileno es real aunque haya huecos antes
    top_cl = ideas_momentum_chile({t: r for t, r in liquidos.items() if t.endswith('.SN')})
    if not top_us and not top_cl:
        logging.error("❌ Ningún método entregó ideas.")
        sys.exit(1)

    # 3. Matemáticas de Portafolio Real
    logging.info("🧮 Calculando Matriz de Correlación y Markowitz SOBRE MI PORTAFOLIO...")
    try:
        res_tickers = supabase.table("mi_portafolio").select("ticker").execute()
        if res_tickers.data:
            portfolio_tickers = list(set([row['ticker'] for row in res_tickers.data]))
            if portfolio_tickers:
                corr_json, frontier_points = compute_quant_math(portfolio_tickers)
                if corr_json:
                    supabase.table("correlaciones").insert({"matriz_json": corr_json}).execute()
                if frontier_points:
                    supabase.table("frontera_eficiente").insert({"puntos_json": frontier_points}).execute()
    except Exception as e:
        logging.error(f"Error guardando matemáticas del portafolio en Supabase: {e}")

    # 4. Generación Analista Institucional (Gemini) - Mercado Global
    prompt_us = "\n".join([linea_prompt(c) for c in top_us[:5]])
    prompt_cl = "\n".join([linea_prompt(c) for c in top_cl])
    
    # Nuevo: Extraer info del portafolio del usuario
    portfolio_data = []
    if 'portfolio_tickers' in locals() and portfolio_tickers:
        for t in portfolio_tickers:
            try:
                res_t = supabase.table("precios_historicos").select("*").eq("ticker", t).order("date", desc=True).limit(1).execute()
                if res_t.data:
                    portfolio_data.append(res_t.data[0])
            except Exception as e:
                logging.error(f"Error fetching latest data for {t}: {e}")
                
    prompt_mi_portafolio = "Portafolio Vacío"
    if portfolio_data:
        prompt_mi_portafolio = "\\n".join([f"- {r['ticker']}: Precio ${r.get('close',0):.2f}, RSI {r.get('rsi',0):.1f}, Dist. EMA200 {(r.get('pvc_ema200',0)*100):.1f}%" for r in portfolio_data])

    prompt_macro = f"""Eres el Estratega Cuantitativo Jefe. 
Analiza los siguientes dos mercados y el portafolio del cliente, luego provee un reporte institucional estricto.

Mercado EE.UU. (las 5 primeras de 20 acciones con la utilidad más respaldada por caja frente a su sector):
{prompt_us}

Mercado Chile (las 5 con mayor alza de los últimos 12 meses):
{prompt_cl}

MI PORTAFOLIO ACTUAL:
{prompt_mi_portafolio}

Responde ESTRICTAMENTE EN ESPAÑOL, en formato JSON válido, sin bloques de código markdown, con la siguiente estructura exacta:
{{
  "contexto_macro": "Análisis macroeconómico de 2 párrafos (tasas, inflación, etc).",
  "vision_radar": "Resumen de las anomalías detectadas en los mercados globales.",
  "seleccion_fondo": "Tu selección #1 global justificando su ventaja (Moat).",
  "setup_tecnico": "Evaluación técnica del riesgo de mercado actual.",
  "diagnostico_mi_portafolio": "Un diagnóstico crítico y duro sobre MI PORTAFOLIO ACTUAL. Tu análisis debe ser exhaustivo y de grado institucional. El apartado de ANÁLISIS debe contener al menos 2 párrafos robustos detallando el momentum técnico, riesgos macroeconómicos y justificación de la decisión (BUY/HOLD/SELL). No escatimes en detalles. Usa un tono de banquero de inversión.",
  "recomendaciones_mi_portafolio": [
      // REGLA ABSOLUTA: DEBES incluir un objeto por CADA UNO de los siguientes tickers: {", ".join(portfolio_tickers) if 'portfolio_tickers' in locals() else "ninguno"}
      {{"ticker": "TICKER_AQUI", "accion": "🟢 BUY (Aumentar) / 🟡 HOLD (Mantener) / 🔴 SELL (Recortar)", "stop_loss": "Calcula un precio exacto de salida de emergencia, justificándolo.", "analisis": "Tu análisis debe ser exhaustivo y de grado institucional. Explica el momentum técnico y justifica la decisión fuertemente."}}
  ], // NUNCA recomiendes 'BUY' ciegamente. Exige buen precio. Si la acción está sobrecomprada o el riesgo es alto, recomienda SELL o HOLD.
  "insights_us": {{
      "TICKER_US": "Tesis de inversión institucional y predictiva de grado bancario (mínimo 2 párrafos). Explica qué dice su criterio de selección y qué riesgos tiene, sin inventar datos que no se entregaron."
  }},
  "insights_cl": {{
      "TICKER_CL": "Tesis de inversión institucional y predictiva de grado bancario (mínimo 2 párrafos). Explica qué dice su criterio de selección y qué riesgos tiene, sin inventar datos que no se entregaron."
  }}
}}
Incluye todos los tickers en sus respectivos diccionarios/listas."""

    ia_data = None
    for modelo in MODELOS_GEMINI:
        try:
            response = genai.GenerativeModel(modelo).generate_content(
                prompt_macro,
                generation_config={"response_mime_type": "application/json", "temperature": 0.0},
                request_options={"timeout": TIEMPO_MAXIMO_GEMINI}
            )
            texto_ia = response.text.replace("```json", "").replace("```", "").strip()
            ia_data = json.loads(texto_ia)
            logging.info(f"🧠 Análisis generado con {modelo}.")
            break
        except Exception as e:
            logging.warning(f"{modelo} no respondió: {str(e)[:160]}")
    if ia_data is None:
        logging.error("Error generando IA: ningún modelo de Gemini respondió.")
        ia_data = {
            "contexto_macro": "Error", "vision_radar": "Error", "seleccion_fondo": "Error", "setup_tecnico": "Error",
            "insights_us": {}, "insights_cl": {}
        }

    # 5. Guardar en Supabase (Web Dashboard)
    # Como analisis_ia actual solo tiene candidatos_json, guardaremos un objeto combinado para no romper la DB actual.
    combined_candidates = {
        "metodo": METODO_TOP,
        "us": top_us,
        "cl": top_cl,
        "calidad_us": calidad_us,
        "diagnostico_portafolio": ia_data.get("diagnostico_mi_portafolio", "Sin diagnóstico específico."),
        "recomendaciones_portafolio": ia_data.get("recomendaciones_mi_portafolio", []),
        # Con qué precios se hizo: la corrida de respaldo no repite el análisis si no hay precios nuevos
        "fecha_precios": max_date,
        "activos_al_dia": al_dia
    }
    try:
        combined_candidates["historial"] = historial_ideas()
    except Exception as e:
        logging.warning(f"No se calculó el historial de las ideas: {str(e)[:160]}")
    
    try:
        supabase.table("analisis_ia").insert({
            "candidatos_json": combined_candidates,
            "vision_radar": ia_data.get("vision_radar", ""),
            "seleccion_fondo": ia_data.get("seleccion_fondo", ""),
            "setup_tecnico": ia_data.get("setup_tecnico", ""),
            "contexto_macro": ia_data.get("contexto_macro", ""),
            "insights_tickers": {**ia_data.get("insights_us", {}), **ia_data.get("insights_cl", {})}
        }).execute()
    except Exception as e:
        logging.error(f"Error guardando IA en Supabase: {e}")
        sys.exit(1)
            
    logging.info("✅ Pipeline Institucional Finalizado.")

if __name__ == "__main__":
    run_serverless_screener()
