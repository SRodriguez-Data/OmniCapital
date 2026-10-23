"""El Top v2 operado automáticamente: el de EE.UU. en Alpaca (la cuenta de paper o, con --real, la de dinero real)
y el de Chile en una cuenta simulada con los precios de la Bolsa de Santiago (Alpaca no opera acciones chilenas).

Cada corrida revisa los stops y aplica el freno diario. Una vez al mes lleva la cartera a las ideas del último
escaneo del Top, a partes iguales. En las simulaciones el bot además opera cuando quiere, en cualquier corrida: vende
la acción que sale de la lista (y de su margen en el ranking), compra la que entra y corrige un peso muy desviado. La
cuenta real solo opera en el rebalanceo mensual. Correrla varias veces el mismo día no duplica órdenes: si una corrida
se corta a la mitad, la siguiente termina lo pendiente.

    python -m trading.main                           # muestra qué haría en la cuenta de paper, sin enviar nada
    python -m trading.main --enviar                  # envía las órdenes a la cuenta de paper (lo usa GitHub Actions)
    python -m trading.main --mercado chile --enviar  # opera la cuenta simulada de la Bolsa de Santiago
    python -m trading.main --real                    # lo mismo con la cuenta real: solo muestra el plan
    python -m trading.main --real --enviar           # opera con dinero real, hasta ALPACA_REAL_TOPE_USD

En modo real el log no muestra montos: los logs de GitHub Actions de un repositorio público los ve cualquiera.
"""
import argparse
import logging
import os
import sys
from datetime import date, timedelta
from pathlib import Path

from alpaca.common.exceptions import APIError
from dotenv import load_dotenv
from supabase import create_client

from trading.core import risk
from trading.core.broker import CLAVES, FINALES, Broker, ErrorConfiguracion, estado, hace, inicio_de_mes
from trading.core.plan import Orden, planificar
from trading.core.registro import TABLA_CHILE, TABLAS, guardar, ultimo_estado
from trading.core.simulado import BrokerSimulado
from trading.strategies.momentum_chile import MomentumChile
from trading.strategies.top_calidad import TopCalidad

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logging.getLogger('httpx').setLevel(logging.WARNING)  # cada consulta a Supabase no aporta en el log

BANDA_MENSUAL = 0.005           # del patrimonio: en el rebalanceo, una diferencia menor no se opera
BANDA_ENTRE_REBALANCEOS = 0.25  # del peso objetivo: entre rebalanceos solo se corrige un peso muy desviado
MONEDA = {'USD': 'US$', 'CLP': '$'}


def motivo(orden) -> str:
    partes = (orden.client_order_id or '').split('-')
    return partes[1] if len(partes) > 1 else ''


def proximo_rebalanceo(hoy: date) -> date:
    """Primer día de semana del mes siguiente (si es feriado en la bolsa, corre el día hábil siguiente)."""
    d = date(hoy.year + hoy.month // 12, hoy.month % 12 + 1, 1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def mostrar(ordenes: list[Orden], privado: bool, moneda: str = 'USD') -> None:
    for o in ordenes:
        if privado:
            logging.info(f'  {o.lado:6} {o.simbolo:6} · {o.detalle}')
            continue
        cantidad = f' ({o.cantidad:.4f} acciones)' if o.lado == 'venta' else ''
        logging.info(f'  {o.lado:6} {o.simbolo:6} {MONEDA[moneda]} {o.monto:>12,.2f}{cantidad} · {o.detalle}')


def cartera(lista: list[str], mantener: set[str], posiciones, mensual: bool) -> dict[str, float]:
    """Las acciones objetivo, a partes iguales. El rebalanceo mensual lleva la cartera exactamente a `lista` (en el
    orden del ranking). Entre rebalanceos, una acción que salió de la lista se mantiene mientras siga en `mantener`
    (cerca de la cabeza del ranking) y ocupa el cupo de la última de la lista que aún no se tiene."""
    if mensual:
        elegidas = list(lista)
    else:
        quedan = [s for s in posiciones if s in mantener and s not in lista]
        cupos = max(len(lista) - len(quedan), 0)
        elegidas = quedan + ([s for s in lista if s in posiciones] + [s for s in lista if s not in posiciones])[:cupos]
    return {s: 1 / len(elegidas) for s in elegidas} if elegidas else {}


def tope_real() -> int:
    """Lo máximo que el sistema invierte en la cuenta real (ALPACA_REAL_TOPE_USD). Si la cuenta tiene más, el resto
    queda en efectivo. Es obligatorio: sin tope no se opera con dinero real."""
    texto = os.getenv('ALPACA_REAL_TOPE_USD', '').strip()
    if not texto.isdigit() or int(texto) <= 0:
        raise ErrorConfiguracion('Falta ALPACA_REAL_TOPE_USD: los dólares que el sistema puede invertir en la cuenta real, '
                                 'enteros y sin puntos ni comas (por ejemplo 500).')
    return int(texto)


class Corrida:
    def __init__(self, broker: Broker, supabase, enviar: bool, tope: float | None = None, dueno: str | None = None,
                 mercado: str = 'eeuu', continuo: bool | None = None):
        self.broker, self.supabase, self.enviar = broker, supabase, enviar
        self.real = broker.real
        self.mercado = mercado
        self.chile = mercado == 'chile'
        self.tabla = TABLA_CHILE if self.chile else TABLAS[self.real]
        self.tope, self.dueno = tope, dueno
        self.limites = risk.LIMITES_CHILE if self.chile else risk.Limites()
        self.estrategia = MomentumChile(supabase) if self.chile else TopCalidad(supabase)
        # Las simulaciones operan cuando el bot quiere; la cuenta real, solo en el rebalanceo mensual
        self.continuo = not self.real if continuo is None else continuo
        self.moneda = getattr(broker, 'moneda', 'USD')
        self.reloj = broker.reloj()
        self.hoy = self.reloj.ahora.date()
        self.eventos: list[dict] = []
        self.errores = 0

    def base(self, patrimonio: float) -> float:
        """Patrimonio sobre el que se reparte la cartera: el de la cuenta, hasta el tope."""
        return patrimonio if self.tope is None else min(patrimonio, self.tope)

    def evento(self, tipo: str, texto: str) -> None:
        self.eventos.append({'fecha': self.hoy.isoformat(), 'tipo': tipo, 'texto': texto})

    def rebalanceo_hecho(self) -> bool:
        """El registro dice si el rebalanceo del mes se completó. Sin registro (falta la tabla), basta con que haya
        órdenes de rebalanceo ejecutadas este mes."""
        mes = self.hoy.strftime('%Y-%m')
        previo = ultimo_estado(self.supabase, self.tabla)
        if previo is not None:
            return (previo.get('rebalanceo') or {}).get('mes') == mes
        return any(motivo(o) == 'reb' and float(o.filled_qty or 0) > 0
                   for o in self.broker.ordenes(inicio_de_mes(self.hoy), self.estrategia.nombre))

    def enviar_ordenes(self, ordenes: list[Orden], precios: dict[str, float]) -> list:
        enviadas = []
        for o in ordenes:
            try:
                if o.lado == 'venta':
                    enviadas.append(self.broker.vender(o.simbolo, o.cantidad, self.estrategia.nombre, o.motivo))
                else:
                    enviadas.append(self.broker.comprar(o.simbolo, o.monto, self.estrategia.nombre, o.motivo, precios.get(o.simbolo)))
            except Exception as e:
                self.errores += 1
                logging.error(f'  {o.lado} {o.simbolo}: rechazada ({str(e)[:160]})')
                self.evento('error', f'No se pudo {"vender" if o.lado == "venta" else "comprar"} {o.simbolo}: {str(e)[:120]}')
        return self.broker.esperar(enviadas, segundos=180) if enviadas else []

    def correr(self) -> int:
        cuenta = self.broker.cuenta()
        m = MONEDA[self.moneda]
        bolsa = (f'Bolsa {"abierta" if self.reloj.abierto else "cerrada"} '
                 f'({self.reloj.ahora:%Y-%m-%d %H:%M} {"Santiago" if self.chile else "Nueva York"}).')
        if self.real:
            logging.info(f'💵 Cuenta de DINERO REAL {cuenta.numero[:2]}…: se invierte hasta el tope fijado. {bolsa}')
        elif self.chile:
            logging.info(f'🇨🇱 Cuenta simulada de la Bolsa de Santiago: patrimonio {m} {cuenta.patrimonio:,.0f}, '
                         f'efectivo {m} {cuenta.efectivo:,.0f}. {bolsa}')
        else:
            logging.info(f'🧪 Cuenta de paper {cuenta.numero[:4]}…: patrimonio {m} {cuenta.patrimonio:,.2f}, '
                         f'efectivo {m} {cuenta.efectivo:,.2f}. {bolsa}')
        if problema := risk.bloqueo(cuenta):
            logging.error(f'❌ {problema}')
            return 1

        # Órdenes propias aún vivas (de otra corrida o llenándose de a poco): se espera a que terminen
        vivas = self.broker.ordenes(hace(5), self.estrategia.nombre, abiertas=True)
        if vivas:
            logging.warning(f'Hay {len(vivas)} órdenes propias pendientes ({", ".join(o.symbol for o in vivas)}): se espera a que terminen.')
            return 0

        posiciones = self.broker.posiciones()
        ventas = risk.stops(posiciones, self.limites)
        for o in ventas:
            logging.warning(f'🛑 Stop: {o.simbolo} {o.detalle}')
        detenidas = {o.symbol for o in self.broker.ordenes(inicio_de_mes(self.hoy), self.estrategia.nombre) if motivo(o) == 'stop'}
        detenidas |= {o.simbolo for o in ventas}

        compras: list[Orden] = []
        precios: dict[str, float] = {}
        objetivo = None
        freno = risk.freno_diario(cuenta, self.limites)
        hecho = self.rebalanceo_hecho()
        mensual = not hecho
        if freno:
            logging.warning(f'⛔ {freno}')
        elif hecho and not self.continuo:
            logging.info(f'El rebalanceo de este mes ya se hizo; el próximo es el {proximo_rebalanceo(self.hoy)}.')
        else:
            objetivo = self.estrategia.objetivo(self.hoy)
            if objetivo.problema:
                logging.warning(f'Sin {"rebalanceo" if mensual else "cambios por la lista"}: {objetivo.problema}')
            else:
                if preparar := getattr(self.broker, 'preparar', None):
                    preparar(sorted(set(objetivo.pesos) | objetivo.mantener))
                fuera = sorted(s for s in objetivo.pesos if s in detenidas or not self.broker.activo(s)[0])
                if fuera:
                    logging.warning(f'Quedan fuera (stop este mes o no se pueden operar): {", ".join(fuera)}')
                lista = [s for s in objetivo.pesos if s not in fuera]
                mantener = (objetivo.mantener | set(lista)) - set(fuera)
                pesos = risk.limitar_pesos(cartera(lista, mantener, posiciones, mensual), self.limites)
                banda = BANDA_MENSUAL if mensual else BANDA_ENTRE_REBALANCEOS * min(pesos.values(), default=0)
                plan = planificar(pesos, posiciones, self.base(cuenta.patrimonio), banda=banda,
                                  fraccionable=lambda s: self.broker.activo(s)[1])
                if not mensual:
                    # Entre rebalanceos las órdenes son cambios de la lista (motivo 'cam'), no el rebalanceo del mes
                    for o in plan:
                        o.motivo = 'cam'
                        if o.detalle == 'salió de la lista':
                            o.detalle = f'salió de la lista y de las primeras {len(mantener)} del ranking'
                ventas += [o for o in plan if o.lado == 'venta']
                compras = [o for o in plan if o.lado == 'compra']
                precios = objetivo.precios
                if mensual:
                    logging.info(f'Rebalanceo hacia {objetivo.descripcion}: {len(pesos)} acciones de {max(pesos.values(), default=0):.1%} cada una.')
                else:
                    logging.info(f'Revisión de la cartera con {objetivo.descripcion}: {len(pesos)} acciones objetivo '
                                 f'(se mantienen las que sigan entre las primeras {len(mantener)} del ranking).')

        ventas = risk.ajustar_ventas(ventas, posiciones)
        # Para mostrar el plan se cuenta con el efectivo que liberan las ventas; al enviar se usa el real
        previstas = risk.ajustar_compras(compras, cuenta.efectivo + sum(o.monto for o in ventas), self.base(cuenta.patrimonio),
                                         posiciones, self.limites)
        if len(ventas) + len(previstas) > self.limites.max_ordenes:
            logging.error(f'❌ {len(ventas) + len(previstas)} órdenes superan el máximo de {self.limites.max_ordenes} por corrida: no se envía nada.')
            return 1
        if ventas or previstas:
            logging.info(f'Plan: {len(ventas)} ventas y {len(previstas)} compras.')
            mostrar(ventas + previstas, privado=self.real, moneda=self.moneda)
        else:
            logging.info('Nada que operar.')

        if not self.enviar:
            destino = 'REAL' if self.real else 'simulada de Chile' if self.chile else 'de paper'
            logging.info(f'Modo revisión: no se envió nada. Con --enviar las órdenes van a la cuenta {destino}.')
            return 0
        if not self.reloj.abierto:
            if ventas or previstas:
                logging.info(f'La bolsa está cerrada: se opera en la próxima corrida (abre {self.reloj.proxima_apertura:%Y-%m-%d %H:%M}).')
            return 1 if not self.guardar(None) and self.chile else 0

        if freno:
            self.evento('freno', freno)
        elif objetivo and objetivo.problema and mensual:
            self.evento('espera', f'No se rebalanceó: {objetivo.problema}')
        for o in ventas:
            if o.motivo == 'stop':
                self.evento('stop', f'{o.simbolo} se vende: {o.detalle}.')

        # Primero las ventas: liberan el efectivo de las compras
        vendidas = self.enviar_ordenes(ventas, precios)
        ventas_listas = all(estado(o) in FINALES for o in vendidas)
        compradas = []
        if compras and ventas_listas:
            cuenta, posiciones = self.broker.cuenta(), self.broker.posiciones()
            compradas = self.enviar_ordenes(risk.ajustar_compras(compras, cuenta.efectivo, self.base(cuenta.patrimonio), posiciones,
                                                                 self.limites), precios)
        hechas = vendidas + compradas
        if hechas:
            logging.info(f'✅ {sum(estado(o) == "filled" for o in hechas)} de {len(hechas)} órdenes completadas.')

        rebalanceo = None
        if objetivo and not objetivo.problema and not freno:
            if not ventas_listas:
                # Las compras esperan a que se completen las ventas: la próxima corrida termina lo pendiente
                logging.warning('Algunas ventas no se completaron a tiempo: las compras quedan para la próxima corrida.')
            elif mensual:
                rebalanceo = {'mes': self.hoy.strftime('%Y-%m'), 'fecha': self.hoy.isoformat(), 'descripcion': objetivo.descripcion}
                n_v = sum(1 for o in vendidas if motivo(o) == 'reb')
                self.evento('rebalanceo', f'Rebalanceo mensual hacia {objetivo.descripcion}: {n_v} ventas y {len(compradas)} compras.')
            elif texto := cambios(ventas + compras, hechas):
                self.evento('cambio', texto)
        if not self.guardar(rebalanceo) and self.chile:
            # El libro de la cuenta simulada vive en esa fila: sin guardarla, lo operado en esta corrida no queda
            logging.error('❌ No se guardó el libro de la cuenta simulada.')
            return 1
        return 1 if self.errores else 0

    def guardar(self, rebalanceo: dict | None) -> bool:
        hecho = rebalanceo is not None or self.rebalanceo_hecho()
        return guardar(self.supabase, self.tabla, self.broker, self.estrategia.nombre, self.estrategia.titulo, self.hoy,
                       self.broker.cuenta(), self.broker.posiciones(), self.eventos, self.limites, rebalanceo,
                       (proximo_rebalanceo(self.hoy) if hecho else self.hoy).isoformat(), tope=self.tope, dueno=self.dueno,
                       mercado=self.mercado, continuo=self.continuo)


def cambios(planeadas: list[Orden], hechas: list) -> str:
    """El aviso de la bitácora con lo que el bot compró y vendió entre rebalanceos, y por qué."""
    detalle = {(o.simbolo, o.lado): o.detalle for o in planeadas}
    partes: dict[str, list[str]] = {'venta': [], 'compra': []}
    for o in hechas:
        if motivo(o) == 'cam' and float(o.filled_qty or 0) > 0:
            lado = 'compra' if str(getattr(o.side, 'value', o.side)) == 'buy' else 'venta'
            partes[lado].append(f'{o.symbol} ({detalle[(o.symbol, lado)]})' if (o.symbol, lado) in detalle else o.symbol)
    texto = '; '.join(f'{"vendió" if lado == "venta" else "compró"} {", ".join(v)}' for lado, v in partes.items() if v)
    return texto[:1].upper() + texto[1:] + '.' if texto else ''


def main(enviar: bool, real: bool, mercado: str = 'eeuu') -> int:
    # La consola de Windows no siempre es UTF-8: sin esto, un emoji o un acento corta el programa
    for flujo in (sys.stdout, sys.stderr):
        flujo.reconfigure(encoding='utf-8', errors='replace')
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    try:
        if not (os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_SECRET_KEY')):
            raise ErrorConfiguracion('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY.')
        supabase = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'])
        if mercado == 'chile':
            if real:
                raise ErrorConfiguracion('En Chile solo hay cuenta simulada: Alpaca no opera acciones chilenas.')
            previo = ultimo_estado(supabase, TABLA_CHILE)
            if previo is None:
                raise ErrorConfiguracion(f'Falta la tabla {TABLA_CHILE}: ejecuta supabase/{TABLA_CHILE}.sql en el SQL Editor de Supabase.')
            return Corrida(BrokerSimulado(previo.get('libro')), supabase, enviar, mercado='chile').correr()
        tope = tope_real() if real else None
        broker = Broker(real=real)
        # Quién ve la cuenta real en la web (user_id de Supabase); sin él se opera igual, pero la web no la muestra
        dueno = (os.getenv('TRADING_REAL_USUARIO') or '').strip() if real else ''
        return Corrida(broker, supabase, enviar, tope=tope, dueno=dueno or None).correr()
    except ErrorConfiguracion as e:
        logging.error(f'❌ {e}')
        return 1
    except APIError as e:
        logging.error(f'❌ Alpaca rechazó la consulta ({e.status_code}): {str(e)[:160]}. '
                      f'Con 401 o 403, revisa {" y ".join(CLAVES[real])}.')
        return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='El Top v2 operado: EE.UU. en Alpaca (paper, o dinero real con --real) '
                                                 'y Chile en una cuenta simulada de la Bolsa de Santiago')
    parser.add_argument('--enviar', action='store_true', help='envía las órdenes (sin esto solo muestra el plan)')
    parser.add_argument('--real', action='store_true', help='opera la cuenta de dinero real en vez de la de paper')
    parser.add_argument('--mercado', choices=['eeuu', 'chile'], default='eeuu', help='eeuu (Alpaca) o chile (simulada)')
    args = parser.parse_args()
    sys.exit(main(args.enviar, args.real, args.mercado))
