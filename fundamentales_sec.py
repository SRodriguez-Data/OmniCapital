"""Estados financieros históricos de las empresas de EE.UU. desde SEC EDGAR (gratis), tal como se conocían en
cada fecha.

La API de "frames" de la SEC entrega, por concepto contable y período, la cifra de todas las empresas que la
reportan en XBRL. Con eso se arma una fila por empresa y año fiscal (utilidad, ventas, patrimonio, deuda...) y
cada cifra se usa recién 90 días después del cierre de su año fiscal, el plazo en que sale el 10-K: así una
medición histórica nunca usa un dato que todavía no se conocía.

Límites que se declaran:
- La SEC entrega la última versión presentada de cada cifra; si una empresa la corrigió después, se usa la
  corregida.
- El valor de mercado se estima con el valor en manos del público (EntityPublicFloat, al cierre del segundo
  trimestre fiscal) movido con el precio. Excluye lo que tienen los controladores, así que la valoración de las
  empresas con controlador grande (fundadores) sale algo más barata de lo que es.

La SEC exige un correo de contacto en cada consulta: se lee de la variable SEC_CONTACTO.
"""
import json
import logging
import os
import time
from pathlib import Path

import pandas as pd
import requests

BASE = "https://data.sec.gov/api/xbrl/frames"
REZAGO_ANUAL = pd.Timedelta(days=90)      # del cierre fiscal al 10-K
REZAGO_FLOTANTE = pd.Timedelta(days=270)  # el valor en manos del público (2.º trimestre) también sale en el 10-K

# Conceptos de flujo (un año fiscal); el primero de cada lista que la empresa reporte es el que vale
DURACION = {
    "utilidad": ["NetIncomeLoss"],
    "ventas": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
               "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"],
    "margen_bruto": ["GrossProfit"],
    "costo_ventas": ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
    "flujo_operacional": ["NetCashProvidedByUsedInOperatingActivities"],
    # Gasto pagado con acciones: suma al flujo de caja sin ser caja libre para el accionista
    "pago_en_acciones": ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
    "dividendos": ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
}
# Conceptos de saldo (a una fecha); se toma el del cierre del año fiscal
INSTANTE = {
    "patrimonio": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "activos": ["Assets"],
    "deuda": ["LongTermDebt", "LongTermDebtNoncurrent"],
}


class Sec:
    def __init__(self, contacto: str | None = None, cache: str | None = None):
        contacto = contacto or os.getenv("SEC_CONTACTO")
        if not contacto:
            raise RuntimeError("Falta SEC_CONTACTO: la SEC exige un correo de contacto en cada consulta.")
        self.sesion = requests.Session()
        self.sesion.headers["User-Agent"] = f"OmniCapital research {contacto}"
        self.cache = Path(cache) if cache else None
        if self.cache:
            self.cache.mkdir(parents=True, exist_ok=True)

    def _get(self, url: str, nombre: str):
        ruta = self.cache / nombre if self.cache else None
        if ruta and ruta.exists():
            return json.loads(ruta.read_text(encoding="utf-8"))
        datos = None
        for intento in range(4):
            r = self.sesion.get(url, timeout=60)
            time.sleep(0.12)  # la SEC permite hasta 10 consultas por segundo
            if r.status_code == 404:
                break
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(2 * (intento + 1))
                continue
            r.raise_for_status()
            datos = r.json()
            break
        if ruta:
            ruta.write_text(json.dumps(datos), encoding="utf-8")
        return datos

    def frame(self, taxonomia: str, tag: str, unidad: str, periodo: str) -> list[dict]:
        d = self._get(f"{BASE}/{taxonomia}/{tag}/{unidad}/{periodo}.json", f"{taxonomia}_{tag}_{unidad}_{periodo}.json")
        return (d or {}).get("data", [])

    def ciks(self) -> dict[str, int]:
        """Ticker (como en Yahoo: BRK-B) -> CIK de la SEC."""
        d = self._get("https://www.sec.gov/files/company_tickers.json", "company_tickers.json") or {}
        return {v["ticker"].upper().replace(".", "-"): int(v["cik_str"]) for v in d.values()}


def anuales(sec: Sec, anios: list[int]) -> pd.DataFrame:
    """Una fila por empresa y año fiscal con el cierre del año, la fecha en que se conoce y cada concepto, más la
    utilidad y los activos del año anterior (para crecimiento)."""
    filas: dict[tuple[int, int], dict] = {}
    for anio in anios:
        for concepto, tags in DURACION.items():
            for tag in tags:
                for r in sec.frame("us-gaap", tag, "USD", f"CY{anio}"):
                    f = filas.setdefault((r["cik"], anio), {"cik": r["cik"], "anio": anio})
                    if concepto not in f:
                        f[concepto] = r["val"]
                        f.setdefault("cierre", r["end"])
                        if concepto == "utilidad":
                            f["cierre"] = r["end"]
    if not filas:
        return pd.DataFrame()
    df = pd.DataFrame(filas.values())
    df["cierre"] = pd.to_datetime(df["cierre"])
    df = _sin_errores_de_escala(df, list(DURACION))

    # Saldos al cierre de cada año fiscal: se buscan en los cuatro trimestres del año y del siguiente (un año
    # fiscal que termina en mayo de 2020 se reporta como CY2019)
    saldos: dict[str, dict[int, list[tuple[pd.Timestamp, int, float]]]] = {c: {} for c in INSTANTE}
    for anio in sorted(set(anios) | {max(anios) + 1}):
        for q in range(1, 5):
            for concepto, tags in INSTANTE.items():
                for prioridad, tag in enumerate(tags):
                    for r in sec.frame("us-gaap", tag, "USD", f"CY{anio}Q{q}I"):
                        saldos[concepto].setdefault(r["cik"], []).append((pd.Timestamp(r["end"]), prioridad, r["val"]))

    def saldo(concepto: str, cik: int, cierre: pd.Timestamp):
        candidatos = [(p, abs((fin - cierre).days), v) for fin, p, v in saldos[concepto].get(cik, [])
                      if abs((fin - cierre).days) <= 20]
        return min(candidatos)[2] if candidatos else None

    for concepto in INSTANTE:
        df[concepto] = [saldo(concepto, c, f) for c, f in zip(df["cik"], df["cierre"])]
    df = _sin_errores_de_escala(df, list(INSTANTE))

    df = df.sort_values(["cik", "cierre"]).reset_index(drop=True)
    # Año anterior de la misma empresa (solo si de verdad es el año previo: entre 10 y 14 meses antes)
    previo = df.groupby("cik")[["cierre", "utilidad", "activos"]].shift(1)
    seguido = (df["cierre"] - previo["cierre"]).dt.days.between(300, 430)
    df["utilidad_previa"] = previo["utilidad"].where(seguido)
    df["activos_previos"] = previo["activos"].where(seguido)
    df["conocido"] = df["cierre"] + REZAGO_ANUAL
    return df


def _sin_errores_de_escala(df: pd.DataFrame, columnas: list[str]) -> pd.DataFrame:
    """Algunas presentaciones posteriores repiten cifras en millones sin escalar (Arista: utilidad 2021 de "841"
    dólares en vez de 841 millones). Una cifra distinta de cero bajo 100 mil dólares no es creíble en una empresa
    del S&P 500: se descarta."""
    for c in columnas:
        if c in df:
            df[c] = df[c].where(~((df[c] != 0) & (df[c].abs() < 1e5)))
    return df


def flotantes(sec: Sec, anios: list[int]) -> pd.DataFrame:
    """Valor en manos del público (USD) de cada empresa, con la fecha a la que se mide y la fecha en que se conoce."""
    regs = []
    for anio in sorted(set(anios) | {max(anios) + 1}):
        for q in range(1, 5):
            regs += [(r["cik"], r["end"], r["val"]) for r in sec.frame("dei", "EntityPublicFloat", "USD", f"CY{anio}Q{q}I")]
    df = pd.DataFrame(regs, columns=["cik", "fecha", "flotante"]).drop_duplicates(["cik", "fecha"], keep="last")
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["conocido"] = df["fecha"] + REZAGO_FLOTANTE
    return df[df["flotante"] >= 1e6]


def a_diario(registros: pd.DataFrame, columna: str, indice: pd.DatetimeIndex, limite: int = 300) -> pd.DataFrame:
    """Cifra vigente cada día (fechas x tickers): la última conocida, por hasta `limite` días hábiles."""
    if registros.empty:
        return pd.DataFrame(index=indice)
    tabla = (registros.dropna(subset=[columna]).sort_values("conocido")
             .drop_duplicates(["ticker", "conocido"], keep="last")
             .pivot(index="conocido", columns="ticker", values=columna))
    union = tabla.index.union(indice)
    return tabla.reindex(union).ffill(limit=limite).reindex(indice)


def panel(sec: Sec, precios: pd.DataFrame, anios: list[int]) -> dict[str, pd.DataFrame]:
    """Fundamentales vigentes cada día para los tickers de `precios` (fechas x tickers) y su valor de mercado."""
    mapa = sec.ciks()
    tickers = [t for t in precios.columns if t in mapa]
    logging.info(f"SEC: {len(tickers)} de {len(precios.columns)} acciones con CIK.")
    por_cik: dict[int, list[str]] = {}
    for t in tickers:
        por_cik.setdefault(mapa[t], []).append(t)

    anual = anuales(sec, anios)
    anual = anual[anual["cik"].isin(por_cik)]
    anual = anual.loc[anual.index.repeat(anual["cik"].map(lambda c: len(por_cik[c])))].copy()
    anual["ticker"] = _repartir(anual["cik"], por_cik)

    columnas = ["utilidad", "utilidad_previa", "ventas", "margen_bruto", "costo_ventas", "flujo_operacional",
                "pago_en_acciones", "dividendos",
                "patrimonio", "activos", "activos_previos", "deuda"]
    salida = {c: a_diario(anual, c, precios.index).reindex(columns=precios.columns) for c in columnas}

    flot = flotantes(sec, anios)
    flot = flot[flot["cik"].isin(por_cik)]
    flot = flot.loc[flot.index.repeat(flot["cik"].map(lambda c: len(por_cik[c])))].copy()
    flot["ticker"] = _repartir(flot["cik"], por_cik)
    # Precio de la acción el día al que se midió el valor en manos del público, para moverlo con el precio
    flot["precio_fecha"] = [precios[t].asof(f) if t in precios else None for t, f in zip(flot["ticker"], flot["fecha"])]
    flotante = a_diario(flot, "flotante", precios.index).reindex(columns=precios.columns)
    precio_base = a_diario(flot, "precio_fecha", precios.index).reindex(columns=precios.columns)
    salida["valor_mercado"] = flotante * precios / precio_base
    cobertura = salida["utilidad"].iloc[-1].notna().sum()
    logging.info(f"SEC: fundamentales vigentes hoy para {cobertura} acciones.")
    return salida


def _repartir(ciks: pd.Series, por_cik: dict[int, list[str]]) -> list[str]:
    """Después de repetir cada fila una vez por ticker de su CIK (GOOGL y GOOG), asigna el ticker a cada copia."""
    vistos: dict[tuple[int, int], int] = {}
    tickers = []
    for idx, cik in zip(ciks.index, ciks):
        n = vistos.get((idx, cik), 0)
        tickers.append(por_cik[cik][n])
        vistos[(idx, cik)] = n + 1
    return tickers
