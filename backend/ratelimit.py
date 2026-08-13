"""Tope de llamadas por usuario para los endpoints caros.

El login ya tiene el suyo en routers/auth.py, y resuelve un problema distinto:
alla se frena a quien todavia no entro. Aca se frena a quien ya entro.

Que hay para frenar si el usuario es del equipo: los endpoints que valen esto no
son los que devuelven una fila de SQLite, sino los que hacen trabajo pesado
afuera. Un reporte dispara decenas de consultas contra GLPI; el estado de
ficheros pinguea la lista entera. Un `for` de veinte lineas en la consola del
navegador alcanza para castigar a GLPI -que lo usa toda la municipalidad, no
solo esta app- o para dejar sin aire al backend, que corre con un solo worker.

No es una defensa contra un atacante: quien tiene sesion es alguien del area, y
si quiere hacer dano tiene formas mas directas. Es una red para que un script
mal escrito, un boton que quedo en un bucle o una pestana olvidada no terminen
en una llamada de GLPI preguntando quien los esta inundando.

Vive en memoria y se pierde al reiniciar, igual que el del login y por la misma
razon: la app corre con un solo worker. Si algun dia se levantan varios
procesos, cada uno tendria su propio contador y habria que mudarlo a la base.
"""
import time
from collections import deque

from fastapi import Depends, HTTPException

from auth import usuario_actual

# Una cola de marcas de tiempo por (endpoint, usuario).
_llamadas: dict[str, deque[float]] = {}


def _recientes(clave: str, ventana: int) -> deque[float]:
    """La cola de la clave, ya sin las llamadas que quedaron fuera de la ventana."""
    cola = _llamadas.setdefault(clave, deque())
    corte = time.monotonic() - ventana
    while cola and cola[0] < corte:
        cola.popleft()
    if not cola:
        # Sin esto queda una clave colgada por cada usuario que alguna vez entro
        # a la pantalla, para siempre.
        del _llamadas[clave]
        return deque()
    return cola


def limite(nombre: str, maximo: int, ventana: int = 60):
    """Fabrica una dependencia que deja pasar `maximo` llamadas cada `ventana` segundos.

    Se cuenta por usuario y no por IP: adentro de la muni varias personas pueden
    salir por la misma IP, y frenar por IP dejaria a un area entera sin reportes
    porque uno solo se paso.

    `nombre` separa los contadores: gastar el cupo de reportes no tiene por que
    dejar sin ficheros a nadie.
    """
    def dependencia(usuario: dict = Depends(usuario_actual)) -> dict:
        clave = f"{nombre}:{usuario['glpi_user_id']}"
        cola = _recientes(clave, ventana)

        if len(cola) >= maximo:
            # El Retry-After va en la respuesta porque un 429 sin decir cuanto
            # esperar invita justo a lo contrario: reintentar en el acto.
            espera = int(ventana - (time.monotonic() - cola[0])) + 1
            raise HTTPException(
                status_code=429,
                detail=(
                    "Estas pidiendo esto demasiado seguido. "
                    f"Volve a probar en {espera} segundos."
                ),
                headers={"Retry-After": str(espera)},
            )

        # Se anota despues del control y no antes: si se anotara primero, los
        # intentos rechazados alargarian su propio castigo.
        cola.append(time.monotonic())
        _llamadas[clave] = cola
        return usuario

    return dependencia
