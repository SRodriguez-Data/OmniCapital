"""Comprueba que la simulación está lista para operar sin arriesgar dinero real. No envía órdenes.

    python -m trading.verify_setup
"""
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


def main() -> int:
    # La consola de Windows no siempre es UTF-8: sin esto, un emoji o un acento corta el programa
    for flujo in (sys.stdout, sys.stderr):
        flujo.reconfigure(encoding='utf-8', errors='replace')
    print('Verificación de la simulación (Alpaca paper trading)\n')

    print('Secretos')
    if (RAIZ / '.env').exists():
        revisar('.env ignorado por git', git('check-ignore', '-q', '.env') == 0, 'nunca se sube a GitHub')
        revisar('.env fuera del historial versionado', git('ls-files', '--error-unmatch', '.env') != 0)
    else:
        print('  (sin .env: se usan las variables del entorno, como en GitHub Actions)')
    load_dotenv(RAIZ / '.env')

    print('\nAlpaca')
    from alpaca.common.exceptions import APIError
    from trading.core.broker import Broker, ErrorConfiguracion
    try:
        broker = Broker()
        revisar('claves con el formato esperado', True)
        revisar('servidor de paper', 'paper-api' in str(broker.cliente._base_url), str(broker.cliente._base_url))
        cuenta = broker.cuenta()
        revisar('cuenta de paper (dinero ficticio)', True, f'{cuenta.numero[:4]}…, estado {cuenta.estado}')
        revisar('cuenta habilitada para operar', not cuenta.bloqueada)
        print(f'        Patrimonio simulado: US$ {cuenta.patrimonio:,.2f}')
        print(f'        Efectivo simulado:   US$ {cuenta.efectivo:,.2f} (es lo único que gasta el sistema: no usa margen)')
        posiciones = broker.posiciones()
        print(f'        Posiciones abiertas: {len(posiciones)}' + (f' ({", ".join(sorted(posiciones)[:12])}{"…" if len(posiciones) > 12 else ""})' if posiciones else ''))
        reloj = broker.reloj()
        print(f'        Bolsa de Nueva York: {"abierta" if reloj.abierto else "cerrada"}; '
              f'{"cierra" if reloj.abierto else "abre"} {(reloj.proximo_cierre if reloj.abierto else reloj.proxima_apertura):%Y-%m-%d %H:%M} (hora de Nueva York)')
    except ErrorConfiguracion as e:
        revisar('configuración de Alpaca', False, str(e))
    except APIError as e:
        revisar('conexión con Alpaca', False, f'HTTP {e.status_code}: {str(e)[:120]}'
                + ('. Las claves no son válidas en paper: genera unas nuevas en la vista Paper del panel.' if e.status_code in (401, 403) else ''))

    print('\nSupabase')
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
            sb.table('paper_trading').select('fecha').limit(1).execute()
            revisar('tabla paper_trading (para la web)', True)
        except Exception:
            revisar('tabla paper_trading (para la web)', False, 'ejecuta supabase/paper_trading.sql en el SQL Editor de Supabase')
    else:
        revisar('credenciales de Supabase', False, 'faltan SUPABASE_URL y SUPABASE_SECRET_KEY')

    listo = all(resultados)
    print('\n' + ('✅ Listo para operar en paper. Este código no tiene modo real: no puede mover dinero de verdad.'
                  if listo else '❌ Corrige lo marcado con FALLA antes de operar.'))
    return 0 if listo else 1


if __name__ == '__main__':
    sys.exit(main())
