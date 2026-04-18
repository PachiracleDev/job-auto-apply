"""
Mueve el cursor a una posición aleatoria cada pocos segundos (útil para evitar estado ausente).

Uso:
  pip install pyautogui
  python anti_afk_mouse.py

Detener: Ctrl+C en la terminal.
"""

from __future__ import annotations

import random
import sys
import time

try:
    import pyautogui
except ImportError:
    print("Instala la dependencia: pip install pyautogui", file=sys.stderr)
    sys.exit(1)

# Evita que mover el ratón a la esquina superior izquierda cierre el script por accidente
pyautogui.FAILSAFE = False

INTERVAL_SEC = 3
# Margen en píxeles respecto a los bordes para no clics accidentales en barras del sistema
MARGIN = 20


def main() -> None:
    w, h = pyautogui.size()
    print(f"Pantalla: {w}x{h}. Intervalo: {INTERVAL_SEC}s. Ctrl+C para salir.")
    try:
        while True:
            x = random.randint(MARGIN, max(MARGIN, w - MARGIN - 1))
            y = random.randint(MARGIN, max(MARGIN, h - MARGIN - 1))
            pyautogui.moveTo(x, y, duration=0.15)
            time.sleep(INTERVAL_SEC)
    except KeyboardInterrupt:
        print("\nDetenido.")


if __name__ == "__main__":
    main()
