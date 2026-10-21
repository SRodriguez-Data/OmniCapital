"""Estado de la simulación en Supabase (tabla paper_trading, una fila por día) para la pestaña Simulación de la web.

La web nunca ve las claves de Alpaca: lee solo esta tabla, de lectura pública. La escribe el job con la clave
secreta de Supabase. Si la tabla no existe (falta ejecutar supabase/paper_trading.sql) se avisa y se sigue: operar
no depende de poder registrar.
"""
import logging
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone

from .broker import Broker, Cuenta, Posicion, estado
from .risk import Limites

TABLA = 'paper_trading'
INDICE = '^GSPC'   # sin dividendos, igual que la cuenta de paper, que no los paga
MAX_EVENTOS = 30


def ultimo_estado(supabase) -> dict | None:
    """Lo último que se registró, o None si la tabla aún no existe o está vacía."""
    try:
        filas = supabase.table(TABLA).select('datos').order('fecha', desc=True).limit(1).execute().data or []
        return filas[0]['datos'] if filas else {}
    except Exception as e:
        logging.warning(f'No se pudo leer {TABLA} ({str(e)[:120]}). ¿Falta ejecutar supabase/paper_trading.sql?')
        return None


def _clave(e: dict) -> tuple:
    # El freno y la espera se repiten en cada corrida del día con otro número: basta un aviso por día
    return (e.get('fecha'), e.get('tipo')) if e.get('tipo') in ('freno', 'espera') else (e.get('fecha'), e.get('tipo'), e.get('texto'))


def _sp500(supabase, desde: str) -> dict[str, float]:
    filas = (supabase.table('precios_historicos').select('date, close').eq('ticker', INDICE)
             .gte('date', desde).order('date').limit(5000).execute().data or [])
    return {r['date'][:10]: float(r['close']) for r in filas if r.get('close')}


def _orden(o) -> dict:
    partes = (o.client_order_id or '').split('-')
    return {
        'fecha': (o.filled_at or o.submitted_at or o.created_at).astimezone(timezone.utc).strftime('%Y-%m-%d'),
        'ticker': o.symbol, 'lado': 'compra' if str(getattr(o.side, 'value', o.side)) == 'buy' else 'venta',
        'motivo': partes[1] if len(partes) > 1 else '', 'estado': estado(o),
        'cantidad': float(o.filled_qty or 0), 'precio': float(o.filled_avg_price) if o.filled_avg_price else None,
        'monto_pedido': float(o.notional) if o.notional else None,
    }


def _curva(supabase, broker: Broker, inicio: str) -> list[dict]:
    """Patrimonio de la cartera y S&P 500 al cierre de cada día, desde el último cierre antes de la primera compra
    (ahí la cartera era solo efectivo). Solo días con cierre de ambos: el de hoy espera el cierre del índice."""
    previo = date.fromisoformat(inicio) - timedelta(days=7)
    cartera = broker.historial(previo)
    sp = _sp500(supabase, previo.isoformat())
    base = max((d for d, _ in cartera if d < inicio), default=inicio)
    return [{'f': d, 'c': round(e, 2), 's': sp[d]} for d, e in cartera if d >= base and d in sp]


def guardar(supabase, broker: Broker, prefijo: str, titulo: str, hoy: date, cuenta: Cuenta, posiciones: dict[str, Posicion],
            eventos: list[dict], limites: Limites, rebalanceo: dict | None, proximo_rebalanceo: str) -> None:
    """`rebalanceo`: el que se completó en esta corrida ({'mes', 'fecha', 'descripcion'}); si es None se conserva el anterior."""
    try:
        previo = ultimo_estado(supabase) or {}
        # Las órdenes salen de Alpaca, no de esta corrida: con varias corridas al día ninguna borra lo de otra
        propias = broker.ordenes(cuenta.creada or datetime.now(timezone.utc) - timedelta(days=400), prefijo)
        inicio = min((_orden(o)['fecha'] for o in propias if float(o.filled_qty or 0) > 0), default=None)

        # Los avisos se acumulan entre días (los últimos MAX_EVENTOS): la web muestra solo la fila más reciente
        bitacora = list(previo.get('eventos') or [])
        vistos = {_clave(e) for e in bitacora}
        for e in eventos:
            if _clave(e) not in vistos:
                vistos.add(_clave(e))
                bitacora.append(e)

        total = cuenta.patrimonio or 1
        datos = {
            'estrategia': prefijo, 'titulo': titulo,
            'actualizado': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'cuenta': {'patrimonio': cuenta.patrimonio, 'patrimonio_ayer': cuenta.patrimonio_ayer, 'efectivo': cuenta.efectivo},
            'inicio': inicio,
            'rebalanceo': rebalanceo or previo.get('rebalanceo'),
            'proximo_rebalanceo': proximo_rebalanceo,
            'posiciones': sorted(({'ticker': p.simbolo, 'cantidad': p.cantidad, 'valor': round(p.valor, 2),
                                   'peso': round(p.valor / total, 4), 'costo': p.costo_promedio,
                                   'ganancia_pct': round(p.ganancia_pct, 4)} for p in posiciones.values()),
                                 key=lambda x: -x['valor']),
            'ordenes': [_orden(o) for o in propias[-80:]][::-1],
            'eventos': bitacora[-MAX_EVENTOS:],
            'curva': _curva(supabase, broker, inicio) if inicio else [],
            'limites': asdict(limites),
        }
        supabase.table(TABLA).upsert({'fecha': hoy.isoformat(), 'datos': datos,
                                      'actualizado': datetime.now(timezone.utc).isoformat()}).execute()
        logging.info(f'Estado guardado en Supabase ({TABLA}, {hoy}).')
    except Exception as e:
        logging.warning(f'No se guardó el estado en Supabase: {str(e)[:200]}. ¿Falta ejecutar supabase/paper_trading.sql?')
