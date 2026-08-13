"""Adonde van los mensajes de la app.

Antes todo salia por `print`. Mientras uno desarrolla eso alcanza, porque hay una
consola mirando; corriendo como servicio no hay ninguna, y esos mensajes no van a
ninguna parte. El dia que falle el login en el server, sin esto no queda con que
diagnosticar.

Se configura desde el .env, no desde el codigo:

    LOG_LEVEL   nivel minimo: DEBUG, INFO, WARNING, ERROR. Por defecto INFO.
    LOG_FILE    archivo donde escribir. Si no esta, sale por consola, que es lo
                comodo en la maquina de uno.

En el server conviene LOG_FILE apuntando afuera de la carpeta del proyecto, para
que un despliegue no se lleve puestos los logs.
"""
import logging
import os
import sys
from logging.handlers import RotatingFileHandler

FORMATO = "%(asctime)s %(levelname)-7s [%(name)s] %(message)s"
FECHA = "%Y-%m-%d %H:%M:%S"

# Cuanto se deja crecer el archivo antes de rotarlo. Es para un server que nadie
# mira durante meses: sin esto el log crece hasta llenar el disco.
MAX_BYTES = 5 * 1024 * 1024
ARCHIVOS_VIEJOS = 5


def configurar():
    """Arma el logger raiz. Se llama una sola vez, al arrancar main.py."""
    nivel = os.getenv("LOG_LEVEL", "INFO").upper()
    archivo = os.getenv("LOG_FILE")

    if archivo:
        handler = RotatingFileHandler(
            archivo,
            maxBytes=MAX_BYTES,
            backupCount=ARCHIVOS_VIEJOS,
            encoding="utf-8",
        )
    else:
        handler = logging.StreamHandler(sys.stdout)

    handler.setFormatter(logging.Formatter(FORMATO, datefmt=FECHA))

    raiz = logging.getLogger()
    raiz.setLevel(nivel)
    # Se reemplazan y no se suman: si esto llegara a correr dos veces, cada
    # mensaje saldria repetido una vez por cada handler acumulado.
    raiz.handlers = [handler]

    # httpx anota en INFO cada pedido que hace. Con el polling cada 30 segundos
    # contra GLPI, eso son miles de renglones por dia que no dicen nada y tapan
    # lo que uno fue a buscar. Se los sube a WARNING para que hablen solo cuando
    # algo salga mal.
    for ruidoso in ("httpx", "httpcore"):
        logging.getLogger(ruidoso).setLevel(logging.WARNING)
