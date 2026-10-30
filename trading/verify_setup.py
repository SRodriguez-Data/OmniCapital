"""Comprueba que una cuenta está lista para operar. No envía órdenes.

    python -m trading.verify_setup           # la simulación (cuenta de paper, dinero ficticio)
    python -m trading.verify_setup --real    # la cuenta de dinero real de EE.UU. (Alpaca)
    python -m trading.verify_setup --chile   # la cuenta real de Chile (avisos por Telegram): manda un mensaje de prueba
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parents[1]
resultados: list[bool] = []


def revisar(nombre: str, ok: bool, detalle: str = '') -> bool:
    resultados.append(ok)
    print(f'  {"OK   " if ok else "FALLA"} {nombre}{": " + detalle if detalle else ""}')
    return ok


def git(*args: str) -> int:
    return subprocess.run(['git', *args], cwd=RAIZ, capture_output=True).returncode


def main(real: bool) -> int:
    # La consola de Windows no siempre es UTF-8: sin esto, un emoji o un acento corta el programa
    for flujo in (sys.stdout, sys.stderr):
        flujo.reconfigure(encoding='utf-8', errors='replace')
    print(f'Verificación de la {"cuenta de DINERO REAL" if real else "simulación (Alpaca paper trading)"}\n')

    print('Secretos')
    if (RAIZ / '.env').exists():
        revisar('.env ignorado por git', git('check-ignore', '-q', '.env') == 0, 'nunca se sube a GitHub')
        revisar('.env fuera del historial versionado', git('ls-files', '--error-unmatch', '.env') != 0)
    else:
        print('  (sin .env: se usan las variables del entorno, como en GitHub Actions)')
    load_dotenv(RAIZ / '.env')

    print('\nAlpaca')
    from alpaca.common.exceptions import APIError
    from trading.core.broker import CLAVES, Broker, ErrorConfiguracion
    from trading.core.registro import TABLAS
    tope = None
    if real:
        from trading.main import tope_real
        try:
            tope = tope_real()
            revisar('tope de inversión', True, f'US$ {tope:,} como máximo (ALPACA_REAL_TOPE_USD)')
        except ErrorConfiguracion as e:
            revisar('tope de inversión', False, str(e))
    try:
        broker = Broker(real=real)
        revisar('claves con el formato esperado', True)
        servidor = getattr(broker.cliente._base_url, 'value', broker.cliente._base_url)
        esperado = 'https://api.alpaca.markets' if real else 'https://paper-api.alpaca.markets'
        revisar('servidor de dinero real' if real else 'servidor de paper', servidor == esperado, servidor)
        cuenta = broker.cuenta()
        revisar('cuenta de dinero real' if real else 'cuenta de paper (dinero ficticio)', True, f'{cuenta.numero[:2 if real else 4]}…, estado {cuenta.estado}')
        revisar('cuenta habilitada para operar', not cuenta.bloqueada)
        if real:
            revisar('cuenta con fondos', cuenta.patrimonio > 0, '' if cuenta.patrimonio > 0 else
                    'aún no llega el depósito: Alpaca lo acredita cuando recibe la transferencia')
        etiqueta = '' if real else ' simulado'
        print(f'        Patrimonio{etiqueta}: US$ {cuenta.patrimonio:,.2f}')
        print(f'        Efectivo{etiqueta}:   US$ {cuenta.efectivo:,.2f} (es lo único que gasta el sistema: no usa margen)')
        if tope is not None:
            print(f'        Se invertirá:  US$ {min(cuenta.patrimonio, tope):,.2f} (lo menor entre el patrimonio y el tope)')
        posiciones = broker.posiciones()
        print(f'        Posiciones abiertas: {len(posiciones)}' + (f' ({", ".join(sorted(posiciones)[:12])}{"…" if len(posiciones) > 12 else ""})' if posiciones else ''))
        if real and posiciones:
            print('        Ojo: el sistema trata toda la cuenta como suya y vende lo que no esté en el Top al rebalancear.')
        reloj = broker.reloj()
        print(f'        Bolsa de Nueva York: {"abierta" if reloj.abierto else "cerrada"}; '
              f'{"cierra" if reloj.abierto else "abre"} {(reloj.proximo_cierre if reloj.abierto else reloj.proxima_apertura):%Y-%m-%d %H:%M} (hora de Nueva York)')
    except ErrorConfiguracion as e:
        revisar('configuración de Alpaca', False, str(e))
    except APIError as e:
        consejo = (' Las claves no son válidas en la cuenta real: genéralas en la vista Live del panel de Alpaca.' if real else
                   ' Las claves no son válidas en paper: genera unas nuevas en la vista Paper del panel.')
        revisar('conexión con Alpaca', False, f'HTTP {e.status_code}: {str(e)[:120]}.'
                + (consejo if e.status_code in (401, 403) else '') + f' ({" y ".join(CLAVES[real])})')

    print('\nSupabase')
    tabla = TABLAS[real]
    if os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_SECRET_KEY'):
        from supabase import create_client
        sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'])
        try:
            from datetime import date
            from trading.strategies.top_calidad import TopCalidad
            obj = TopCalidad(sb).objetivo(date.today())
            revisar('escaneo del Top para rebalancear', obj.problema is None, obj.problema or obj.descripcion)
        except Exception as e:
            revisar('lectura del Top', False, str(e)[:160])
        try:
            sb.table(tabla).select('fecha').limit(1).execute()
            revisar(f'tabla {tabla} (para la web)', True)
        except Exception:
            revisar(f'tabla {tabla} (para la web)', False, f'ejecuta supabase/{tabla}.sql en el SQL Editor de Supabase')
        if real:
            dueno = (os.getenv('TRADING_REAL_USUARIO') or '').strip()
            print(f'  {"OK   " if dueno else "AVISO"} dueño en la web: '
                  + ('TRADING_REAL_USUARIO definido' if dueno else 'falta TRADING_REAL_USUARIO (tu user_id de Supabase): se opera igual, '
                                                                   'pero la web no muestra la cuenta real'))
    else:
        revisar('credenciales de Supabase', False, 'faltan SUPABASE_URL y SUPABASE_SECRET_KEY')

    listo = all(resultados)
    if not listo:
        print('\n❌ Corrige lo marcado con FALLA antes de operar.')
    elif real:
        print(f'\n✅ Lista para operar con DINERO REAL, hasta US$ {tope:,}. En GitHub se activa con la variable TRADING_REAL = activo.')
    else:
        print('\n✅ Listo para operar en paper (dinero ficticio). La cuenta real usa otras claves y se verifica con --real.')
    return 0 if listo else 1


def chile_real() -> int:
    """La cuenta real de Chile: capital, Telegram (manda un mensaje de prueba a tu chat) y Supabase."""
    for flujo in (sys.stdout, sys.stderr):
        flujo.reconfigure(encoding='utf-8', errors='replace')
    print('Verificación de la cuenta real de Chile (avisos por Telegram)\n')
    load_dotenv(RAIZ / '.env')
    from trading.core.broker import ErrorConfiguracion
    from trading.core.manual import pesos
    from trading.core.registro import TABLA_CHILE_REAL
    from trading.core.telegram import ErrorTelegram, Telegram
    from trading.main import capital_chile

    print('Capital')
    try:
        revisar('capital de la cuenta', True, f'{pesos(capital_chile())} (CHILE_REAL_TOPE_CLP)')
    except ErrorConfiguracion as e:
        revisar('capital de la cuenta', False, str(e))

    print('\nTelegram')
    try:
        tg = Telegram()
        bot = tg._llamar('getMe')
        revisar('bot', True, f'@{bot.get("username")}')
        sin_webhook = not tg._llamar('getWebhookInfo').get('url')
        revisar('webhook apagado', sin_webhook, '' if sin_webhook else
                'el bot lee tus respuestas con getUpdates y con un webhook puesto Telegram no se las entrega: bórralo con deleteWebhook')
        tg.enviar('🇨🇱 OmniCapital: prueba de conexión. Aquí te llegarán las órdenes de tu cuenta de Chile.')
        revisar('mensaje de prueba enviado a tu chat', True, 'revisa Telegram')
    except ErrorConfiguracion as e:
        revisar('configuración de Telegram', False, str(e))
    except ErrorTelegram as e:
        revisar('conexión con Telegram', False, f'{e}. Revisa TELEGRAM_TOKEN y TELEGRAM_CHAT_ID, y escríbele /start al bot.')

    print('\nSupabase')
    if os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_SECRET_KEY'):
        from datetime import date
        from supabase import create_client
        from trading.strategies.momentum_chile import MomentumChile
        sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SECRET_KEY'])
        try:
            obj = MomentumChile(sb).objetivo(date.today())
            revisar('escaneo del Top de Chile', obj.problema is None, obj.problema or obj.descripcion)
        except Exception as e:
            revisar('lectura del Top de Chile', False, str(e)[:160])
        try:
            sb.table(TABLA_CHILE_REAL).select('fecha').limit(1).execute()
            revisar(f'tabla {TABLA_CHILE_REAL}', True)
        except Exception:
            revisar(f'tabla {TABLA_CHILE_REAL}', False, f'ejecuta supabase/{TABLA_CHILE_REAL}.sql en el SQL Editor de Supabase')
        dueno = (os.getenv('TRADING_REAL_USUARIO') or '').strip()
        print(f'  {"OK   " if dueno else "AVISO"} dueño en la web: ' + ('TRADING_REAL_USUARIO definido' if dueno else
              'falta TRADING_REAL_USUARIO (tu user_id de Supabase): los avisos llegan igual, pero la web no muestra la cuenta'))
    else:
        revisar('credenciales de Supabase', False, 'faltan SUPABASE_URL y SUPABASE_SECRET_KEY')

    listo = all(resultados)
    print('\n❌ Corrige lo marcado con FALLA antes de activarla.' if not listo else
          '\n✅ Lista. En GitHub se activa con la variable TRADING_REAL_CL = activo.')
    return 0 if listo else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Verifica la configuración de una cuenta sin enviar órdenes')
    parser.add_argument('--real', action='store_true', help='revisa la cuenta de dinero real en vez de la de paper')
    parser.add_argument('--chile', action='store_true', help='revisa la cuenta real de Chile (Telegram), no la de Alpaca')
    args = parser.parse_args()
    sys.exit(chile_real() if args.chile else main(args.real))
