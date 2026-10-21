"""Simulación automática del Top v2 en una cuenta de paper trading de Alpaca (dinero ficticio).

Cada corrida revisa los stops, aplica el freno diario y, si el rebalanceo de este mes aún no se completó, lleva la
cartera a las ideas del último escaneo del Top, a partes iguales. Correrla varias veces el mismo día no duplica
órdenes: si una corrida se corta a la mitad, la siguiente termina el rebalanceo.

    python -m trading.main            # muestra qué haría, sin enviar nada
    python -m trading.main --enviar   # envía las órdenes a la cuenta de paper (lo usa GitHub Actions)
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
from trading.core.broker import FINALES, Broker, ErrorConfiguracion, estado, hace, inicio_de_mes
from trading.core.plan import Orden, planificar
from trading.core.registro import guardar, ultimo_estado
from trading.strategies.top_calidad import TopCalidad

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logging.getLogger('httpx').setLevel(logging.WARNING)  # cada consulta a Supabase no aporta en el log


def motivo(orden) -> str:
    partes = (orden.client_order_id or '').split('-')
    return partes[1] if len(partes) > 1 else ''


def proximo_rebalanceo(hoy: date) -> date:
    """Primer día de semana del mes siguiente (si es feriado en Nueva York, corre el día hábil siguiente)."""
    d = date(hoy.year + hoy.month // 12, hoy.month % 12 + 1, 1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def mostrar(ordenes: list[Orden]) -> None:
    for o in ordenes:
        cantidad = f' ({o.cantidad:.4f} acciones)' if o.lado == 'venta' else ''
        logging.info(f'  {o.lado:6} {o.simbolo:6} US$ {o.monto:>10,.2f}{cantidad} · {o.detalle}')


class Corrida:
    def __init__(self, broker: Broker, supabase, enviar: bool):
        self.broker, self.supabase, self.enviar = broker, supabase, enviar
        self.limites = risk.Limites()
        self.estrategia = TopCalidad(supabase)
        self.reloj = broker.reloj()
        self.hoy = self.reloj.ahora.date()
        self.eventos: list[dict] = []
        self.errores = 0

    def evento(self, tipo: str, texto: str) -> None:
        self.eventos.append({'fecha': self.hoy.isoformat(), 'tipo': tipo, 'texto': texto})

    def rebalanceo_hecho(self) -> bool:
        """El registro dice si el rebalanceo del mes se completó. Sin registro (falta la tabla), basta con que haya
        órdenes de rebalanceo ejecutadas este mes."""
        mes = self.hoy.strftime('%Y-%m')
        previo = ultimo_estado(self.supabase)
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
        logging.info(f'🧪 Cuenta de paper {cuenta.numero[:4]}…: patrimonio US$ {cuenta.patrimonio:,.2f}, efectivo US$ {cuenta.efectivo:,.2f}. '
                     f'Bolsa {"abierta" if self.reloj.abierto else "cerrada"} ({self.reloj.ahora:%Y-%m-%d %H:%M} Nueva York).')
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
        if freno:
            logging.warning(f'⛔ {freno}')
        elif hecho:
            logging.info(f'El rebalanceo de este mes ya se hizo; el próximo es el {proximo_rebalanceo(self.hoy)}.')
        else:
            objetivo = self.estrategia.objetivo(self.hoy)
            if objetivo.problema:
                logging.warning(f'Sin rebalanceo: {objetivo.problema}')
            else:
                fuera = sorted(s for s in objetivo.pesos if s in detenidas or not self.broker.activo(s)[0])
                if fuera:
                    logging.warning(f'Quedan fuera (stop este mes o no se operan en Alpaca): {", ".join(fuera)}')
                pesos = {s: w for s, w in objetivo.pesos.items() if s not in fuera}
                total = sum(pesos.values()) or 1
                pesos = risk.limitar_pesos({s: w / total for s, w in pesos.items()}, self.limites)
                plan = planificar(pesos, posiciones, cuenta.patrimonio, fraccionable=lambda s: self.broker.activo(s)[1])
                ventas += [o for o in plan if o.lado == 'venta']
                compras = [o for o in plan if o.lado == 'compra']
                precios = objetivo.precios
                logging.info(f'Rebalanceo hacia {objetivo.descripcion}: {len(pesos)} acciones de {max(pesos.values(), default=0):.1%} cada una.')

        ventas = risk.ajustar_ventas(ventas, posiciones)
        # Para mostrar el plan se cuenta con el efectivo que liberan las ventas; al enviar se usa el real
        previstas = risk.ajustar_compras(compras, cuenta.efectivo + sum(o.monto for o in ventas), cuenta.patrimonio, posiciones, self.limites)
        if len(ventas) + len(previstas) > self.limites.max_ordenes:
            logging.error(f'❌ {len(ventas) + len(previstas)} órdenes superan el máximo de {self.limites.max_ordenes} por corrida: no se envía nada.')
            return 1
        if ventas or previstas:
            logging.info(f'Plan: {len(ventas)} ventas y {len(previstas)} compras.')
            mostrar(ventas + previstas)
        else:
            logging.info('Nada que operar.')

        if not self.enviar:
            logging.info('Modo revisión: no se envió nada. Con --enviar las órdenes van a la cuenta de paper.')
            return 0
        if not self.reloj.abierto:
            if ventas or previstas:
                logging.info(f'La bolsa está cerrada: se opera en la próxima corrida (abre {self.reloj.proxima_apertura:%Y-%m-%d %H:%M} Nueva York).')
            self.guardar(None)
            return 0

        if freno:
            self.evento('freno', freno)
        elif objetivo and objetivo.problema:
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
            compradas = self.enviar_ordenes(risk.ajustar_compras(compras, cuenta.efectivo, cuenta.patrimonio, posiciones, self.limites), precios)
        hechas = vendidas + compradas
        if hechas:
            logging.info(f'✅ {sum(estado(o) == "filled" for o in hechas)} de {len(hechas)} órdenes completadas.')

        rebalanceo = None
        if objetivo and not objetivo.problema and not freno:
            if ventas_listas:
                rebalanceo = {'mes': self.hoy.strftime('%Y-%m'), 'fecha': self.hoy.isoformat(), 'descripcion': objetivo.descripcion}
                n_v = sum(1 for o in vendidas if motivo(o) == 'reb')
                self.evento('rebalanceo', f'Rebalanceo mensual hacia {objetivo.descripcion}: {n_v} ventas y {len(compradas)} compras.')
            else:
                # Las compras esperan a que se completen las ventas: la próxima corrida termina el rebalanceo
                logging.warning('Algunas ventas no se completaron a tiempo: las compras quedan para la próxima corrida.')
        self.guardar(rebalanceo)
        return 1 if self.errores else 0

    def guardar(self, rebalanceo: dict | None) -> None:
        hecho = rebalanceo is not None or self.rebalanceo_hecho()
        guardar(self.supabase, self.broker, self.estrategia.nombre, self.estrategia.titulo, self.hoy, self.broker.cuenta(),
                self.broker.posiciones(), self.eventos, self.limites, rebalanceo,
                (proximo_rebalanceo(self.hoy) if hecho else self.hoy).isoformat())


def main(enviar: bool) -> int:
    # La consola de Windows no siempre es UTF-8: sin esto, un emoji o un acento corta el programa
    for flujo in (sys.stdout, sys.stderr):
        flujo.reconfigure(encoding='utf-8', errors='replace')
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    try:
        broker = Broker()
        if not (os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_SECRET_KEY')):
            raise ErrorConfiguracion('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY.')
        corrida = Corrida(broker, create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY']), enviar)
        return corrida.correr()
    except ErrorConfiguracion as e:
        logging.error(f'❌ {e}')
        return 1
    except APIError as e:
        logging.error(f'❌ Alpaca rechazó la consulta ({e.status_code}): {str(e)[:160]}. Con 401 o 403, revisa las claves de paper.')
        return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Simulación del Top v2 en Alpaca paper trading')
    parser.add_argument('--enviar', action='store_true', help='envía las órdenes a la cuenta de paper (sin esto solo muestra el plan)')
    sys.exit(main(parser.parse_args().enviar))
