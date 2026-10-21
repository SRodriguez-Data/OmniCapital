"""Estado de la cartera en Supabase (una fila por día) para la pestaña Simulación de la web.

La web nunca ve las claves de Alpaca: lee solo estas tablas. La de paper (dinero ficticio) es de lectura pública; la
de la cuenta real solo la ve su dueño (RLS por user_id). Las escribe el job con la clave secreta de Supabase. Si la
tabla no existe (falta ejecutar su .sql de supabase/) se avisa y se sigue: operar no depende de poder registrar.
"""
import logging
from dataclasses import asdict
from datetime import date, datetime, timedelta, timezone

from .broker import Broker, Cuenta, Posicion, estado
from .risk import Limites

TABLAS = {False: 'paper_trading', True: 'real_trading'}   # según si la cuenta es de dinero real
INDICE = '^GSPC'   # sin dividendos, igual que la cuenta de paper, que no los paga
MAX_EVENTOS = 30


def ultimo_estado(supabase, tabla: str) -> dict | None:
    """Lo último que se registró ({} si aún no hay nada), o None si la tabla no existe."""
    try:
        filas = supabase.table(tabla).select('datos').order('fecha', desc=True).limit(1).execute().data or []
        return filas[0]['datos'] if filas else {}
    except Exception as e:
        logging.warning(f'No se pudo leer {tabla} ({str(e)[:120]}). ¿Falta ejecutar supabase/{tabla}.sql?')
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
    """Valor de la cartera (sin depósitos ni retiros) y S&P 500 al cierre de cada día, desde el último cierre antes de
    la primera compra (ahí la cartera era solo efectivo). Solo días con cierre de ambos: el de hoy espera el del índice."""
    previo = date.fromisoformat(inicio) - timedelta(days=7)
    cartera = broker.historial(previo)
    sp = _sp500(supabase, previo.isoformat())
    base = max((d for d, _ in cartera if d < inicio), default=inicio)
    return [{'f': d, 'c': round(e, 2), 's': sp[d]} for d, e in cartera if d >= base and d in sp]


def guardar(supabase, tabla: str, broker: Broker, prefijo: str, titulo: str, hoy: date, cuenta: Cuenta,
            posiciones: dict[str, Posicion], eventos: list[dict], limites: Limites, rebalanceo: dict | None,
            proximo_rebalanceo: str, tope: float | None = None, dueno: str | None = None) -> None:
    """`rebalanceo`: el que se completó en esta corrida ({'mes', 'fecha', 'descripcion'}); si es None se conserva el
    anterior. `dueno`: user_id de Supabase que puede ver la fila en la web (cuenta real)."""
    try:
        previo = ultimo_estado(supabase, tabla) or {}
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
            'tope': tope,
        }
        fila = {'fecha': hoy.isoformat(), 'datos': datos, 'actualizado': datetime.now(timezone.utc).isoformat()}
        if dueno:
            fila['user_id'] = dueno
        supabase.table(tabla).upsert(fila).execute()
        logging.info(f'Estado guardado en Supabase ({tabla}, {hoy}).')
    except Exception as e:
        logging.warning(f'No se guardó el estado en Supabase: {str(e)[:200]}. ¿Falta ejecutar supabase/{tabla}.sql?')
