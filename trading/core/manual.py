"""Cuenta real de Chile, operada a mano. Las corredoras chilenas no dan una API para que un programa envíe órdenes,
así que el bot decide igual que en la simulación (las mismas ideas, pesos y reglas de riesgo) y le manda cada orden
por Telegram a su dueño, que la ejecuta en su corredora y responde:

- ✅ Hecha: se anota con la cantidad y el precio del aviso.
- Responder al aviso con «cantidad precio» (por ejemplo «17 23650»): se anota con lo que de verdad se hizo.
- ❌ No la haré: se descarta y ese día no se vuelve a pedir.

Mientras quede una orden sin respuesta el bot no decide nada nuevo, así nunca pide dos veces lo mismo; si pasa un día,
la recuerda. «/cartera» muestra lo que el bot cree que hay en la cuenta. Las respuestas se leen en cada corrida, así
que se anotan en la siguiente (Telegram las guarda unas 24 horas: si una se pierde, el recordatorio la vuelve a pedir).

El libro de la cuenta (efectivo, acciones, órdenes) es el de la simulación (core/simulado.py) con lo que el dueño
confirma, y se guarda en Supabase (real_trading_cl, que solo ve su dueño). El capital es CHILE_REAL_TOPE_CLP, los
pesos que el dueño destina a esto: si lo sube, la diferencia entra como aporte (no cuenta como ganancia); si lo baja,
sale del efectivo.
"""
import logging
import math
import re
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from types import SimpleNamespace

import bolsa_chile

from .broker import Cuenta
from .simulado import COMISION, BrokerSimulado, precio_de_ejecucion
from .telegram import ErrorTelegram, Telegram

PENDIENTE = 'pendiente'   # no está entre los estados finales de broker.FINALES: la corrida espera la respuesta
MOTIVOS = {'reb': 'rebalanceo mensual', 'cam': 'cambio de la lista', 'stop': 'stop loss'}
AYUDA = ('Así se responde a cada aviso de orden:\n'
         '• ✅ Hecha: la hiciste tal cual.\n'
         '• Responder al aviso con «cantidad precio» (ej.: 17 23650): la hiciste con otra cantidad o a otro precio.\n'
         '• ❌ No la haré: se descarta por hoy.\n'
         '/cartera muestra lo que hay en la cuenta según OmniCapital.')


def nombre(ticker: str) -> str:
    return ticker.removesuffix('.SN')


def pesos(x: float) -> str:
    return f'${x:,.0f}'.replace(',', '.')


def leer_numero(texto: str) -> float | None:
    """Un número escrito a la chilena: «23.650», «23650», «23.650,5» o «23650,5»."""
    t = texto.strip().strip('$').strip()
    if ',' in t:
        t = t.replace('.', '').replace(',', '.')
    elif re.fullmatch(r'\d{1,3}(\.\d{3})+', t):
        t = t.replace('.', '')
    try:
        return float(t)
    except ValueError:
        return None


def leer_respuesta(texto: str) -> tuple[int, float] | None:
    """«cantidad precio» → (cantidad, precio). Acepta palabras en medio («17 a $23.650»)."""
    numeros = [leer_numero(n) for n in re.findall(r'\$?\d[\d.,]*', texto)]
    if len(numeros) != 2 or None in numeros:
        return None
    cantidad, precio = numeros
    if cantidad != int(cantidad) or cantidad < 0 or precio <= 0:
        return None
    return int(cantidad), precio


class BrokerManual(BrokerSimulado):
    real = True
    manual = True

    def __init__(self, libro: dict | None, capital: int, avisos: Telegram, cotizar=bolsa_chile.cotizaciones,
                 ahora: datetime | None = None):
        super().__init__(libro, cotizar, ahora, capital=capital)
        self.datos.setdefault('capital', self.datos['capital_inicial'])
        for clave in ('pendientes', 'aportes', 'descartadas'):
            self.datos.setdefault(clave, [])
        self.datos.setdefault('telegram', 0)   # el próximo update de Telegram por leer
        self.avisos = avisos
        self.hoy = self.ahora.date().isoformat()
        self.eventos: list[dict] = []
        # Lo descartado solo cuenta el día en que se descartó
        self.datos['descartadas'] = [d for d in self.datos['descartadas'] if d[0] == self.hoy]
        self._ajustar_capital(capital)

    def evento(self, tipo: str, texto: str) -> None:
        self.eventos.append({'fecha': self.hoy, 'tipo': tipo, 'texto': texto})

    def _ajustar_capital(self, capital: int) -> None:
        cambio = capital - self.datos['capital']
        if cambio < 0:
            # Lo que se retira sale del efectivo: si no alcanza, el resto se retira cuando haya
            cambio = -min(-cambio, max(self.datos['efectivo'], 0.0))
        if abs(cambio) < 1:
            return
        self.datos['efectivo'] += cambio
        self.datos['capital'] += cambio
        self.datos['aportes'].append([self.hoy, round(cambio, 2)])
        self.evento('aporte' if cambio > 0 else 'retiro', f'{"Aporte" if cambio > 0 else "Retiro"} de {pesos(abs(cambio))}: '
                    f'el capital queda en {pesos(self.datos["capital"])}.')

    # --- Lectura -------------------------------------------------------------------------------------------

    def cuenta(self) -> Cuenta:
        c = super().cuenta()
        # Un aporte o retiro de hoy no es ganancia ni pérdida del día (no debe activar el freno diario)
        if any(f < self.hoy for f, _ in self.datos['historial']):
            c = replace(c, patrimonio_ayer=c.patrimonio_ayer + sum(m for f, m in self.datos['aportes'] if f == self.hoy))
        return replace(c, numero='CL-MANUAL')

    def historial(self, desde) -> list[tuple[str, float]]:
        """Valor de la cartera al cierre de cada día sin contar los aportes y retiros como ganancia o pérdida."""
        aportes: dict[str, float] = {}
        for f, m in self.datos['aportes']:
            aportes[f] = aportes.get(f, 0.0) + m
        puntos, valor, previo = [], None, None
        for f, e in self.datos['historial']:
            valor = valor * (e - aportes.get(f, 0.0)) / previo if valor and previo else e
            previo = e
            if f >= desde.isoformat():
                puntos.append((f, valor))
        return puntos

    def ordenes(self, desde: datetime, prefijo: str, abiertas: bool = False) -> list:
        pendientes = [self._orden_pendiente(p) for p in self.datos['pendientes'] if p['client_order_id'].startswith(prefijo + '-')]
        if abiertas:
            return pendientes
        return super().ordenes(desde, prefijo) + [o for o in pendientes if o.submitted_at >= desde]

    @staticmethod
    def _orden_pendiente(p: dict) -> SimpleNamespace:
        hora = datetime.fromisoformat(p['hora'])
        return SimpleNamespace(id=p['id'], symbol=p['ticker'], side='buy' if p['lado'] == 'compra' else 'sell', status=PENDIENTE,
                               client_order_id=p['client_order_id'], filled_qty=0, filled_avg_price=None,
                               notional=round(p['cantidad'] * p['precio'], 2), comision=None, filled_at=None, submitted_at=hora,
                               created_at=hora)

    def omitida(self, simbolo: str, lado: str) -> bool:
        """El dueño la descartó hoy: no se vuelve a pedir hasta mañana."""
        return [self.hoy, simbolo, lado] in self.datos['descartadas']

    def resumen(self) -> str:
        posiciones = self.posiciones()
        lineas = [f'📊 <b>Tu cuenta de Chile según OmniCapital</b>', f'Efectivo: {pesos(self.datos["efectivo"])}']
        lineas += [f'{nombre(s)}: {p.cantidad} acciones ≈ {pesos(p.valor)} ({p.ganancia_pct:+.1%})'
                   for s, p in sorted(posiciones.items(), key=lambda x: -x[1].valor)]
        lineas.append(f'Total: {pesos(self.datos["efectivo"] + sum(p.valor for p in posiciones.values()))} '
                      f'(capital {pesos(self.datos["capital"])})')
        lineas += [f'Pendiente: {self._linea(p)}' for p in self.datos['pendientes']]
        return '\n'.join(lineas)

    # --- Órdenes: se avisan y quedan pendientes ------------------------------------------------------------

    @staticmethod
    def _linea(p: dict) -> str:
        return f'{"COMPRA" if p["lado"] == "compra" else "VENDE"} {p["cantidad"]} {nombre(p["ticker"])}'

    def _avisar(self, simbolo: str, lado: str, cantidad: int, precio: float, prefijo: str, motivo: str, detalle: str):
        p = {'id': uuid.uuid4().hex[:10], 'client_order_id': self._id(prefijo, motivo, simbolo), 'ticker': simbolo, 'lado': lado,
             'cantidad': cantidad, 'precio': round(precio, 2), 'motivo': motivo, 'detalle': detalle,
             'hora': self.ahora.astimezone(timezone.utc).isoformat(timespec='seconds'), 'recordada': None}
        monto = cantidad * precio
        texto = (f'🇨🇱 <b>{self._linea(p)}</b>\n'
                 f'a ~{pesos(precio)} c/u ≈ {pesos(monto)} (+ comisión)\n'
                 f'Por qué: {detalle or MOTIVOS.get(motivo, motivo)}.\n\n'
                 f'Cuando la hagas en tu corredora, toca ✅. Si {"compraste" if lado == "compra" else "vendiste"} otra cantidad '
                 f'o a otro precio, responde a este mensaje con «cantidad precio» (ej.: {cantidad} {precio:.0f}).')
        # Si Telegram falla, la orden no queda pendiente: la corrida la cuenta como error y la próxima la vuelve a pedir
        p['mensaje'] = self.avisos.enviar(texto, [('✅ Hecha', f'ok:{p["id"]}'), ('❌ No la haré', f'no:{p["id"]}')])
        self.datos['pendientes'].append(p)
        self.evento('aviso', f'Se avisó por Telegram: {self._linea(p).lower()} a ~{pesos(precio)} ({detalle or MOTIVOS.get(motivo, motivo)}).')
        return self._orden_pendiente(p)

    def comprar(self, simbolo: str, monto: float, prefijo: str, motivo: str, precio_ref: float | None = None, detalle: str = ''):
        c = self._cotizacion(simbolo)
        if c is None:
            raise ValueError(f'{simbolo} no tiene cotización en la Bolsa de Santiago')
        precio = precio_de_ejecucion(c, 'compra')
        # El efectivo de las compras ya avisadas en esta corrida está comprometido
        comprometido = sum(p['cantidad'] * p['precio'] * (1 + COMISION) for p in self.datos['pendientes'] if p['lado'] == 'compra')
        cantidad = math.floor(min(monto, self.datos['efectivo'] - comprometido) / (precio * (1 + COMISION)))
        if cantidad < 1:
            raise ValueError(f'{simbolo}: el monto no alcanza para una acción')
        return self._avisar(simbolo, 'compra', cantidad, precio, prefijo, motivo, detalle)

    def vender(self, simbolo: str, cantidad: float, prefijo: str, motivo: str, detalle: str = ''):
        p = self.datos['posiciones'].get(simbolo)
        avisadas = sum(x['cantidad'] for x in self.datos['pendientes'] if x['ticker'] == simbolo and x['lado'] == 'venta')
        cantidad = min(math.floor(cantidad), (p['cantidad'] if p else 0) - avisadas)
        if cantidad <= 0:
            raise ValueError(f'{simbolo}: nada que vender')
        c = self._cotizacion(simbolo)
        if c is None:
            raise ValueError(f'{simbolo} no tiene cotización en la Bolsa de Santiago')
        return self._avisar(simbolo, 'venta', cantidad, precio_de_ejecucion(c, 'venta'), prefijo, motivo, detalle)

    def recordar(self) -> None:
        """Una vez al día, recuerda las órdenes avisadas otro día que siguen sin respuesta."""
        for p in self.datos['pendientes']:
            if p['hora'][:10] < self.hoy and p.get('recordada') != self.hoy:
                try:
                    self.avisos.enviar(f'⏰ Sigue pendiente: <b>{self._linea(p)}</b> (avisada el {p["hora"][:10]}). Mientras no la '
                                       f'confirmes o descartes, el bot no avisa nada nuevo en Chile.', responde_a=p.get('mensaje'))
                    p['recordada'] = self.hoy
                except ErrorTelegram as e:
                    logging.warning(f'No se pudo enviar el recordatorio ({e}).')

    # --- Respuestas del dueño ------------------------------------------------------------------------------

    def procesar_respuestas(self) -> int:
        """Anota lo que el dueño respondió en Telegram desde la última corrida. Devuelve cuántas órdenes cambiaron."""
        try:
            novedades = self.avisos.novedades(self.datos['telegram'])
        except ErrorTelegram as e:
            logging.warning(f'No se pudieron leer las respuestas de Telegram ({e}).')
            return 0
        cambios = 0
        for u in novedades:
            self.datos['telegram'] = int(u['update_id']) + 1
            if not self.avisos.es_del_dueno(u):
                continue   # solo atiende al chat de su dueño
            try:
                cambios += self._atender(u)
            except ErrorTelegram as e:
                logging.warning(f'Telegram no respondió al anotar una respuesta ({e}).')
        return cambios

    def _pendiente(self, **clave) -> dict | None:
        (campo, valor), = clave.items()
        return next((p for p in self.datos['pendientes'] if p.get(campo) == valor), None)

    def _atender(self, u: dict) -> int:
        if q := u.get('callback_query'):
            accion, _, oid = (q.get('data') or '').partition(':')
            p = self._pendiente(id=oid)
            if p is None:
                self.avisos.contestar(q['id'], 'Esa orden ya estaba anotada.')
                return 0
            if accion == 'ok':
                self._llenar(p, p['cantidad'], p['precio'])
                self.avisos.contestar(q['id'], 'Anotada ✅')
            else:
                self._descartar(p)
                self.avisos.contestar(q['id'], 'Descartada por hoy')
            return 1

        m = u.get('message') or {}
        texto = (m.get('text') or '').strip()
        comando = texto.lower().lstrip('/').split('@')[0]
        if comando == 'cartera':
            self.avisos.enviar(self.resumen())
            return 0
        if comando in ('start', 'ayuda', 'help'):
            self.avisos.enviar(AYUDA)
            return 0
        respondido = (m.get('reply_to_message') or {}).get('message_id')
        if not respondido:
            return 0
        p = self._pendiente(mensaje=respondido)
        if p is None:
            self.avisos.enviar('Esa orden ya estaba anotada o descartada: no cambié nada.', responde_a=m.get('message_id'))
            return 0
        leido = leer_respuesta(texto)
        if leido is None:
            self.avisos.enviar(f'No te entendí. Responde «cantidad precio», por ejemplo «{p["cantidad"]} {p["precio"]:.0f}».',
                               responde_a=m.get('message_id'))
            return 0
        cantidad, precio = leido
        if cantidad == 0:
            self._descartar(p)
        else:
            self._llenar(p, cantidad, precio)
        return 1

    def _llenar(self, p: dict, cantidad: int, precio: float) -> None:
        self.datos['pendientes'].remove(p)
        if p['lado'] == 'venta':
            cantidad = min(cantidad, (self.datos['posiciones'].get(p['ticker']) or {}).get('cantidad', 0))
            if cantidad <= 0:
                self.avisos.editar(p['mensaje'], f'⚠️ {self._linea(p)}: según OmniCapital no tienes esas acciones; no anoté nada.')
                return
            comision = self._anotar_venta(p['ticker'], cantidad, precio)
        else:
            comision = self._anotar_compra(p['ticker'], cantidad, precio)
        self._registrar(p['ticker'], p['lado'], cantidad, precio, comision, p['client_order_id'])
        verbo = 'Compraste' if p['lado'] == 'compra' else 'Vendiste'
        hecho = f'{verbo} {cantidad} {nombre(p["ticker"])} a {pesos(precio)}'
        self.avisos.editar(p['mensaje'], f'✅ <b>Anotada</b>: {hecho} (≈ {pesos(cantidad * precio)}).')
        self.evento('hecha', f'{hecho}.')

    def _descartar(self, p: dict) -> None:
        self.datos['pendientes'].remove(p)
        self.datos['descartadas'].append([self.hoy, p['ticker'], p['lado']])
        self.avisos.editar(p['mensaje'], f'❌ <b>Descartada</b>: {self._linea(p)}. Hoy no se vuelve a pedir.')
        self.evento('descartada', f'No hiciste: {self._linea(p).lower()}.')
