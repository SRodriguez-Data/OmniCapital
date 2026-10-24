import os
import sys
import json
import time
import logging
import pandas as pd
import yfinance as yf
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

import cartera

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

# Las órdenes en Alpaca (paper) las envía trading/main.py, no este bot: aquí solo se eligen las ideas
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")


# Tickers will be dynamically fetched from mi_portafolio

if SUPABASE_URL and SUPABASE_KEY:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
else:
    supabase = None

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
    momentum_chile de evidencia.py. `filas`: ticker -> última fila con volumen (precio de hoy
    real). Devuelve (ideas, ranking de todas las evaluadas): la simulación mantiene una acción mientras siga cerca
    de la cabeza del ranking, aunque salga de las 5."""
    tickers = sorted(filas)
    if not tickers:
        return [], []
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
    return ideas, [{"ticker": t, "momentum": round(float(m), 4)} for t, m in candidatos]

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

# Lo que midió el laboratorio (evidencia.py --web): qué ponderación tuvo mejor razón retorno/riesgo en cada método
EVIDENCIA_METODOS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "src", "data", "evidencia_metodos.json")

def ponderacion_medida(metodo):
    try:
        with open(EVIDENCIA_METODOS, encoding="utf-8") as f:
            elegida = json.load(f)["metodos"][metodo]["cartera"]["elegida"]
        return elegida if elegida in cartera.PONDERACIONES else "igual"
    except Exception as e:
        logging.warning(f"Sin la ponderación medida de {metodo} ({str(e)[:80]}): partes iguales.")
        return "igual"

def evidencia_significativa(metodo):
    """(sí o no, motivo): el método publica ideas solo si el laboratorio midió que su cartera, tal como se opera
    (rebalanceada cada mes con su ponderación), le ganó a su mercado con t de 2 o más y en ambas mitades de la
    historia. La misma regla que muestra la web (lib/evidenciaMetodos.ts)."""
    try:
        with open(EVIDENCIA_METODOS, encoding="utf-8") as f:
            c = json.load(f)["metodos"][metodo]["cartera"]
        x = c["ponderaciones"][c["elegida"]]
        mitades = [m["exceso_anual"] for m in x["mitades"].values()]
    except Exception as e:
        return False, f"no hay medición del laboratorio para {metodo} ({str(e)[:60]})"
    if x["exceso_t"] is None or x["exceso_t"] < 2 or not mitades or min(mitades) <= 0:
        return False, (f"su cartera rindió {x['exceso_anual']:+.1%} al año sobre su mercado con t = {x['exceso_t']}, "
                       "sin evidencia significativa en ambas mitades de la historia")
    return True, ""

def asignar_pesos(ideas, metodo):
    """El peso de cada idea según la ponderación que el laboratorio eligió para su método (cartera.py), con un año
    de retornos diarios guardados. Devuelve la ponderación usada."""
    if not ideas:
        return None
    ponderacion = ponderacion_medida(metodo)
    tickers = [i["ticker"] for i in ideas]
    desde = (pd.Timestamp.now() - pd.Timedelta(days=400)).strftime("%Y-%m-%d")
    precios = pd.DataFrame(cierres(tickers, desde)).sort_index().ffill(limit=5)
    retornos = precios.reindex(columns=tickers).pct_change(fill_method=None).tail(252)
    pesos = cartera.pesos(retornos, ponderacion)
    for i in ideas:
        i["peso"] = round(float(pesos[i["ticker"]]), 4)
    logging.info(f"Pesos {metodo} ({cartera.PONDERACIONES[ponderacion]}): "
                 + ", ".join(f"{i['ticker']} {i['peso']:.1%}" for i in ideas))
    return ponderacion

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

def avisar_cambios(top_us, top_cl, liquidos):
    """Avisos de la campana (alertas_mercado): una acción que entra o sale de las ideas con evidencia frente al
    último escaneo del mismo método. Un escaneo repetido con los mismos precios da las mismas listas: sin avisos."""
    previo = (supabase.table("analisis_ia").select("us:candidatos_json->us, cl:candidatos_json->cl, metodo:candidatos_json->metodo")
              .order("fecha", desc=True).limit(1).execute().data or [])
    if not previo or previo[0].get("metodo") != METODO_TOP:
        return  # primer escaneo del método: no hay contra qué comparar
    antes = {c["ticker"] for c in (previo[0].get("us") or []) + (previo[0].get("cl") or [])}
    ahora = {c["ticker"]: c for c in top_us + top_cl}
    lista = lambda t: "Chile, mayor alza de 12 meses" if t.endswith(".SN") else "EE.UU., utilidad respaldada por caja"
    precio = lambda t: float(ahora[t]["price"]) if t in ahora else float((liquidos.get(t) or {}).get("close") or 0)
    filas = [{"ticker": t, "tipo": "ENTRA_LISTA", "precio_actual": precio(t),
              "mensaje": f"{t} entró a las ideas con evidencia ({lista(t)})."} for t in ahora if t not in antes]
    filas += [{"ticker": t, "tipo": "SALE_LISTA", "precio_actual": precio(t),
               "mensaje": f"{t} salió de las ideas con evidencia ({lista(t)}): ya no cumple el criterio."} for t in sorted(antes - set(ahora))]
    if filas:
        supabase.table("alertas_mercado").insert(filas).execute()
        logging.info(f"🔔 {len(filas)} avisos: {', '.join(f['ticker'] + (' entra' if f['tipo'] == 'ENTRA_LISTA' else ' sale') for f in filas)}")

def run_serverless_screener():
    logging.info("🚀 Iniciando Quantum Trader Serverless (Institucional)...")
    
    # Sin credenciales o sin datos el job debe quedar en rojo en GitHub Actions, no en verde sin hacer nada
    if not supabase:
        logging.error("❌ Faltan las credenciales de Supabase.")
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

    # Un precio que no cambia en semanas no sirve para medir (hoy las chilenas vienen de la Bolsa de Santiago)
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
    top_cl, ranking_cl = ideas_momentum_chile({t: r for t, r in liquidos.items() if t.endswith('.SN')})
    if not top_us and not top_cl:
        logging.error("❌ Ningún método entregó ideas.")
        sys.exit(1)

    # Donde la evidencia no es significativa es mejor no recomendar: esa lista queda vacía, con su motivo
    sin_evidencia = {}
    for clave, metodo in (("us", "calidad_eeuu"), ("cl", "momentum_chile")):
        ok, motivo = evidencia_significativa(metodo)
        if not ok:
            sin_evidencia[clave] = motivo
            logging.warning(f"{metodo} sin evidencia significativa: {motivo}. No se publican sus ideas.")
    top_us = [] if "us" in sin_evidencia else top_us
    top_cl = [] if "cl" in sin_evidencia else top_cl

    ponderacion = {}
    for clave, ideas, metodo in (("us", top_us, "calidad_eeuu"), ("cl", top_cl, "momentum_chile")):
        try:
            ponderacion[clave] = asignar_pesos(ideas, metodo)
        except Exception as e:
            logging.warning(f"No se calcularon los pesos de {metodo}: {str(e)[:160]}")

    try:
        avisar_cambios(top_us, top_cl, liquidos)
    except Exception as e:
        logging.warning(f"No se generaron los avisos de la campana: {str(e)[:160]}")

    # 3. Guardar el escaneo (la web lee candidatos_json; el asesor, calidad_us)
    combined_candidates = {
        "metodo": METODO_TOP,
        "us": top_us,
        "cl": top_cl,
        "calidad_us": calidad_us,
        "ranking_cl": ranking_cl,
        # Ponderación de cada lista (cartera.py); cada idea trae su "peso"
        "ponderacion": ponderacion,
        # Mercados cuyo método no tiene evidencia significativa: su lista va vacía y la simulación sale a efectivo
        "sin_evidencia": sin_evidencia,
        # Con qué precios se hizo: la corrida de respaldo no repite el análisis si no hay precios nuevos
        "fecha_precios": max_date,
        "activos_al_dia": al_dia
    }
    try:
        combined_candidates["historial"] = historial_ideas()
    except Exception as e:
        logging.warning(f"No se calculó el historial de las ideas: {str(e)[:160]}")
    
    try:
        # Las columnas de texto venían de Gemini, que ya no se usa: quedan vacías
        supabase.table("analisis_ia").insert({
            "candidatos_json": combined_candidates,
            "vision_radar": "", "seleccion_fondo": "", "setup_tecnico": "",
        }).execute()
    except Exception as e:
        logging.error(f"Error guardando el escaneo en Supabase: {e}")
        sys.exit(1)
            
    logging.info("✅ Pipeline Institucional Finalizado.")

if __name__ == "__main__":
    run_serverless_screener()
