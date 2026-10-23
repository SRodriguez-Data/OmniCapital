"""Cuánto invertir en cada idea del Top, según teoría de portafolio.

Los métodos del Top eligen acciones, pero no dicen que una vaya a rendir más que otra: todas las elegidas tienen el
mismo retorno esperado (el que midió el método). Con retornos esperados iguales, la cartera eficiente de Markowitz
(máximo retorno por unidad de riesgo) es la de mínima varianza: pesa más a las acciones que bajan el riesgo del
conjunto, por su volatilidad y por cómo se mueven entre sí. La covarianza se estima con un año de retornos diarios y
el encogimiento de Ledoit-Wolf, porque la muestra sola sobreajusta y da pesos extremos.

El laboratorio (evidencia.py) mide cada ponderación durante 10 años y el Top usa la que mejor razón retorno/riesgo
tuvo en cada mercado; partes iguales queda como referencia. Cada acción va entre la mitad y 1,5 veces su parte
igual: ninguna elegida queda fuera y ninguna domina la cartera.
"""
import numpy as np
import pandas as pd
from scipy.optimize import minimize

PONDERACIONES = {
    "igual": "Partes iguales",
    "inversa_volatilidad": "Inversa a la volatilidad",
    "minima_varianza": "Mínima varianza (Markowitz)",
}
LIMITES = (0.5, 1.5)    # veces la parte igual (1/N)
MINIMO_DIAS = 120       # con menos historia la covarianza no es confiable: partes iguales


def covarianza(x: np.ndarray) -> np.ndarray:
    """Covarianza de Ledoit-Wolf (2004): la muestral encogida hacia una diagonal con la varianza promedio, en la
    proporción que minimiza el error esperado. `x`: días x acciones."""
    x = x - x.mean(axis=0)
    t, n = x.shape
    s = x.T @ x / t
    mu = np.trace(s) / n
    objetivo = mu * np.eye(n)
    d2 = np.sum((s - objetivo) ** 2) / n
    b2 = sum(np.sum((np.outer(f, f) - s) ** 2) for f in x) / (t ** 2 * n)
    encogimiento = min(b2, d2) / d2 if d2 > 0 else 1.0
    return encogimiento * objetivo + (1 - encogimiento) * s


def acotar(w: np.ndarray, minimo: float, maximo: float) -> np.ndarray:
    """Lleva los pesos a [minimo, maximo] sumando 1, repartiendo lo recortado en proporción entre los demás."""
    w = w / w.sum()
    for _ in range(50):
        fijo = (w <= minimo) | (w >= maximo)
        w = np.clip(w, minimo, maximo)
        resto = 1 - w[fijo].sum()
        libres = ~fijo
        if not libres.any() or abs(w.sum() - 1) < 1e-12:
            break
        w[libres] = w[libres] / w[libres].sum() * resto
    return w / w.sum()


def pesos(retornos: pd.DataFrame, metodo: str) -> pd.Series:
    """Peso de cada acción (columnas de `retornos`, retornos diarios del último año) según `metodo`."""
    n = retornos.shape[1]
    igual = pd.Series(1 / n, index=retornos.columns)
    datos = retornos.dropna(how="all")
    if metodo == "igual" or n < 2 or len(datos) < MINIMO_DIAS:
        return igual
    x = datos.fillna(0).to_numpy()
    minimo, maximo = LIMITES[0] / n, LIMITES[1] / n
    if metodo == "inversa_volatilidad":
        vol = x.std(axis=0)
        if (vol <= 0).any():
            return igual
        return pd.Series(acotar(1 / vol, minimo, maximo), index=retornos.columns)
    if metodo == "minima_varianza":
        c = covarianza(x) * 252
        r = minimize(lambda w: w @ c @ w, np.full(n, 1 / n), jac=lambda w: 2 * c @ w, method="SLSQP",
                     bounds=[(minimo, maximo)] * n, constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1}],
                     options={"maxiter": 200, "ftol": 1e-12})
        if not r.success:
            return igual
        return pd.Series(acotar(np.clip(r.x, minimo, maximo), minimo, maximo), index=retornos.columns)
    raise ValueError(f"Ponderación desconocida: {metodo}")
