"""Avisos por Telegram con la Bot API, sin librerías aparte. Lo usa la cuenta real de Chile (core/manual.py): el bot
manda cada orden al chat de su dueño y lee sus respuestas en la corrida siguiente (getUpdates, sin servidor propio).

El token va en TELEGRAM_TOKEN (de @BotFather) y el chat en TELEGRAM_CHAT_ID. El bot solo atiende a ese chat: lo que
escriba cualquier otro se ignora.
"""
import json
import os
import urllib.error
import urllib.request

from .broker import ErrorConfiguracion


class ErrorTelegram(RuntimeError):
    pass


class Telegram:
    def __init__(self, token: str | None = None, chat: str | None = None):
        self.token = (token if token is not None else os.getenv('TELEGRAM_TOKEN', '')).strip()
        self.chat = str(chat if chat is not None else os.getenv('TELEGRAM_CHAT_ID', '')).strip()
        if not self.token or not self.chat:
            raise ErrorConfiguracion('Faltan TELEGRAM_TOKEN y TELEGRAM_CHAT_ID: sin ellos no hay cómo avisar las órdenes de Chile.')

    def _llamar(self, metodo: str, **params) -> dict | list | bool:
        pedido = urllib.request.Request(f'https://api.telegram.org/bot{self.token}/{metodo}',
                                        data=json.dumps(params).encode(), headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(pedido, timeout=30) as r:
                respuesta = json.load(r)
        except urllib.error.HTTPError as e:
            # El mensaje de error nunca lleva la URL: el token va en ella
            try:
                respuesta = json.load(e)
            except ValueError:
                raise ErrorTelegram(f'{metodo}: HTTP {e.code}') from None
        except urllib.error.URLError as e:
            raise ErrorTelegram(f'{metodo}: sin conexión ({e.reason})') from None
        if not respuesta.get('ok'):
            raise ErrorTelegram(f'{metodo}: {respuesta.get("description", "error")}')
        return respuesta['result']

    def enviar(self, texto: str, botones: list[tuple[str, str]] | None = None, responde_a: int | None = None) -> int:
        """Manda un mensaje al chat del dueño. `botones`: (texto, dato) en una fila. Devuelve el id del mensaje."""
        params: dict = {'chat_id': self.chat, 'text': texto, 'parse_mode': 'HTML', 'disable_web_page_preview': True}
        if botones:
            params['reply_markup'] = {'inline_keyboard': [[{'text': t, 'callback_data': d} for t, d in botones]]}
        if responde_a:
            params['reply_parameters'] = {'message_id': responde_a, 'allow_sending_without_reply': True}
        return int(self._llamar('sendMessage', **params)['message_id'])

    def editar(self, mensaje: int, texto: str) -> None:
        """Cambia el texto de un mensaje y le quita los botones. Si ya decía eso, no pasa nada."""
        try:
            self._llamar('editMessageText', chat_id=self.chat, message_id=mensaje, text=texto, parse_mode='HTML')
        except ErrorTelegram as e:
            if 'not modified' not in str(e):
                raise

    def contestar(self, consulta: str, texto: str) -> None:
        """Responde a un toque de botón. Telegram rechaza las de hace más de unos minutos: da igual, ya se anotó."""
        try:
            self._llamar('answerCallbackQuery', callback_query_id=consulta, text=texto)
        except ErrorTelegram:
            pass

    def novedades(self, desde: int) -> list[dict]:
        """Lo que llegó al bot desde el update `desde` (inclusive). Pedirlas desde un número confirma las anteriores:
        Telegram las borra y no las vuelve a dar. Guarda cada update unas 24 horas."""
        return list(self._llamar('getUpdates', offset=desde, timeout=0, allowed_updates=['message', 'callback_query']))

    def es_del_dueno(self, update: dict) -> bool:
        origen = (update.get('callback_query') or {}).get('from') or (update.get('message') or {}).get('chat') or {}
        return str(origen.get('id', '')) == self.chat
