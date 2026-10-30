"""Carga en los secrets de GitHub Actions los valores de .env que usan los workflows (por ejemplo, después de recrear
el repositorio). Usa `gh` con tu sesión: nunca imprime los valores.

    python scripts/subir_secrets.py                 # los que usan los workflows hoy
    python scripts/subir_secrets.py --solo NOMBRE   # uno en particular
"""
import argparse
import subprocess
import sys
from pathlib import Path

from dotenv import dotenv_values

REPO = 'SRodriguez-Data/OmniCapital'
# Los que leen los workflows. Los de dinero real (ALPACA_REAL_*, CHILE_REAL_TOPE_CLP, TRADING_REAL_USUARIO) se suben
# cuando decidas activarlos, con --solo
NECESARIOS = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SEC_CONTACTO', 'ALPACA_API_KEY', 'ALPACA_SECRET_KEY',
              'TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID']


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--solo', nargs='+', help='nombres a subir en vez de la lista de siempre')
    nombres = parser.parse_args().solo or NECESARIOS
    valores = dotenv_values(Path(__file__).resolve().parents[1] / '.env')
    faltan = [n for n in nombres if not (valores.get(n) or '').strip()]
    if faltan:
        print(f'Faltan en .env: {", ".join(faltan)}. No se subió nada.')
        return 1
    for n in nombres:
        r = subprocess.run(['gh', 'secret', 'set', n, '-R', REPO], input=valores[n].strip(), text=True, capture_output=True)
        print(f'  {"OK   " if r.returncode == 0 else "FALLA"} {n}' + ('' if r.returncode == 0 else f': {r.stderr.strip()[:120]}'))
        if r.returncode:
            return 1
    print(f'Listo: {len(nombres)} secrets en {REPO}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
