"""Precios de la Bolsa de Santiago desde el feed que TradingView recibe de la bolsa (BCS), con 20 minutos de retraso.

Yahoo no es confiable en Chile: deja semanas con el mismo cierre y volumen 0, y guarda días a medio cerrar (cierres que
difieren hasta 9% del oficial, con volúmenes de 16 acciones). Este feed trae el cierre y el volumen completos de cada
día y, en vivo, el último precio y las puntas de compra y venta. Es gratis y sin clave, pero no es una API oficial: si
falla, quien lo usa vuelve a Yahoo.

    diarias(["SQM-B.SN"], barras=300)   # velas diarias, ajustadas por splits y aumentos de capital
    cotizaciones(["SQM-B.SN"])          # último precio, puntas y si la bolsa está en sesión
"""
import json
import logging
import random
import string
import time
from dataclasses import dataclass
from datetime import datetime

import pandas as pd
from websocket import create_connection

URL = "wss://data.tradingview.com/socket.io/websocket"
ZONA = "America/Santiago"
# Transa todos los días: su último precio dice si la bolsa ya abrió hoy
REFERENCIA = "CHILE.SN"


def simbolo(ticker: str) -> str:
    """SQM-B.SN (Yahoo) -> BCS:SQM_B (TradingView)."""
    return "BCS:" + ticker.removesuffix(".SN").replace("-", "_")


def _id(prefijo: str) -> str:
    return prefijo + "".join(random.choices(string.ascii_lowercase, k=12))


def separar(paquete: str) -> list[str]:
    """Un paquete trae uno o más mensajes, cada uno precedido de ~m~<largo>~m~."""
    mensajes, i = [], 0
    while paquete.startswith("~m~", i):
        j = paquete.index("~m~", i + 3)
        largo = int(paquete[i + 3:j])
        mensajes.append(paquete[j + 3:j + 3 + largo])
        i = j + 3 + largo
    return mensajes


class Conexion:
    def __init__(self, segundos: float = 20):
        self.ws = create_connection(URL, header=["Origin: https://www.tradingview.com"], timeout=segundos)
        self.enviar("set_auth_token", ["unauthorized_user_token"])

    def enviar(self, metodo: str, parametros: list) -> None:
        texto = json.dumps({"m": metodo, "p": parametros}, separators=(",", ":"))
        self.ws.send(f"~m~{len(texto)}~m~{texto}")

    def recibir(self) -> list[dict]:
        """Los mensajes del próximo paquete. Devuelve los latidos (~h~N): sin eso el servidor corta la conexión."""
        salida = []
        for cuerpo in separar(self.ws.recv()):
            if cuerpo.startswith("~h~"):
                self.ws.send(f"~m~{len(cuerpo)}~m~{cuerpo}")
            elif cuerpo.startswith("{"):
                salida.append(json.loads(cuerpo))
        return salida

    def cerrar(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.cerrar()


def tabla(velas: dict[int, list]) -> pd.DataFrame:
    """Velas [hora, apertura, máximo, mínimo, cierre, volumen] -> date, open, high, low, close, volume, con la fecha
    de Santiago."""
    filas = [v for _, v in sorted(velas.items()) if len(v) >= 5]
    df = pd.DataFrame([v[:5] + [v[5] if len(v) > 5 else None] for v in filas],
                      columns=["hora", "open", "high", "low", "close", "volume"])
    df["date"] = pd.to_datetime(df["hora"], unit="s", utc=True).dt.tz_convert(ZONA).dt.strftime("%Y-%m-%d")
    # Con un aumento de capital el feed ajusta también el volumen anterior y deja fracciones de acción
    df["volume"] = df["volume"].fillna(0).round()
    df = df.drop_duplicates("date", keep="last")
    return df[["date", "open", "high", "low", "close", "volume"]].reset_index(drop=True)


def _diarias(con: Conexion, ticker: str, barras: int, ajuste: str, segundos: float) -> pd.DataFrame | None:
    cs = _id("cs_")
    con.enviar("chart_create_session", [cs, ""])
    pedido = json.dumps({"symbol": simbolo(ticker), "adjustment": ajuste, "session": "regular"}, separators=(",", ":"))
    con.enviar("resolve_symbol", [cs, "simbolo", "=" + pedido])
    con.enviar("create_series", [cs, "serie", "s1", "simbolo", "1D", barras, ""])
    velas: dict[int, list] = {}
    limite = time.monotonic() + segundos
    try:
        while time.monotonic() < limite:
            for m in con.recibir():
                p = m.get("p") or []
                if not p or p[0] != cs:
                    continue
                if m.get("m") in ("timescale_update", "du"):
                    for v in ((p[1] or {}).get("serie") or {}).get("s", []):
                        velas[v["i"]] = v["v"]
                elif m.get("m") == "symbol_error":
                    return None
                elif m.get("m") == "series_completed":
                    return tabla(velas) if velas else None
                elif m.get("m") == "critical_error":
                    raise RuntimeError(f"{ticker}: {p[1:]}")
        raise TimeoutError(f"{ticker}: el historial no llegó en {segundos:.0f} s")
    finally:
        try:
            con.enviar("chart_delete_session", [cs])
        except Exception:
            pass


def diarias(tickers: list[str], barras: int = 300, ajuste: str = "splits", segundos: float = 30) -> dict[str, pd.DataFrame]:
    """Velas diarias de cada ticker chileno de Yahoo (SQM-B.SN), las últimas `barras` sesiones con transacciones.
    `ajuste`: "splits" (splits y aumentos de capital, como el cierre de Yahoo), "dividends" (además dividendos, para
    medir retornos totales) o "none". Los tickers que la bolsa no reconoce o que fallan dos veces no vienen."""
    salida: dict[str, pd.DataFrame] = {}
    con = None
    for t in tickers:
        for intento in range(2):
            try:
                if con is None:
                    con = Conexion()
                df = _diarias(con, t, barras, ajuste, segundos)
                if df is not None and not df.empty:
                    salida[t] = df
                break
            except Exception as e:
                if con is not None:
                    con.cerrar()
                con = None
                if intento:
                    logging.warning(f"{t}: la Bolsa de Santiago no entregó su historial ({str(e)[:100]})")
    if con is not None:
        con.cerrar()
    return salida


@dataclass
class Cotizacion:
    ticker: str
    precio: float                 # último precio transado (con 20 minutos de retraso)
    hora: datetime                # de ese precio, en hora de Santiago
    compra: float | None          # mejor punta de compra: a ese precio se puede vender ya
    venta: float | None           # mejor punta de venta: a ese precio se puede comprar ya
    volumen: float                # acciones transadas en la sesión
    cierre_anterior: float | None
    en_sesion: bool               # la bolsa está en horario de transacciones


CAMPOS = ["lp", "lp_time", "bid", "ask", "volume", "prev_close_price", "current_session"]


def cotizaciones(tickers: list[str], segundos: float = 15) -> dict[str, Cotizacion]:
    """La cotización en vivo de cada ticker. Los que la bolsa no reconoce o sin precio no vienen."""
    simbolos = {simbolo(t): t for t in tickers}
    datos: dict[str, dict] = {s: {} for s in simbolos}
    listos, errores = set(), set()
    qs = _id("qs_")
    with Conexion() as con:
        con.enviar("quote_create_session", [qs])
        con.enviar("quote_set_fields", [qs, *CAMPOS])
        con.enviar("quote_add_symbols", [qs, *simbolos])
        limite = time.monotonic() + segundos
        extra = None
        # Las puntas llegan a veces después del aviso de que la cotización está completa: se espera un poco más
        while time.monotonic() < (extra or limite):
            try:
                mensajes = con.recibir()
            except Exception:
                break
            for m in mensajes:
                p = m.get("p") or []
                if m.get("m") == "qsd" and len(p) > 1 and p[1].get("n") in datos:
                    if p[1].get("s") == "ok":
                        datos[p[1]["n"]].update(p[1].get("v") or {})
                    else:
                        errores.add(p[1]["n"])
                elif m.get("m") == "quote_completed" and len(p) > 1:
                    listos.add(p[1])
            if extra is None and listos | errores >= set(simbolos):
                extra = min(limite, time.monotonic() + 2)
    salida = {}
    for s, d in datos.items():
        if s in errores or not d.get("lp") or not d.get("lp_time"):
            continue
        num = lambda k: float(d[k]) if d.get(k) not in (None, 0) else None
        salida[simbolos[s]] = Cotizacion(
            ticker=simbolos[s], precio=float(d["lp"]),
            hora=pd.Timestamp(int(d["lp_time"]), unit="s", tz="UTC").tz_convert(ZONA).to_pydatetime(),
            compra=num("bid"), venta=num("ask"), volumen=float(d.get("volume") or 0),
            cierre_anterior=num("prev_close_price"), en_sesion=d.get("current_session") == "market")
    return salida
