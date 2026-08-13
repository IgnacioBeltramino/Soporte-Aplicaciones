import asyncio
import time
from collections import deque

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import db
from auth import SESSION_KEY, autenticar, usuario_actual

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── Limite de intentos de login ───────────────────────────────────────────────
#
# Cada POST a /login dispara un bind real contra el controlador de dominio. Sin
# limite, el problema no es que le adivinen la clave a alguien: es que
# cualquiera con acceso a la red puede usar esta app para bloquear cuentas de AD
# en masa. Si el dominio tiene politica de lockout -tipico: 5 intentos fallidos-
# un script contra este endpoint deja sin cuenta a media muni, y el log del DC
# va a mostrar que los intentos salieron de este servidor.
#
# Se cuenta por IP y por usuario, que frenan cosas distintas: por IP, al que
# prueba muchas cuentas desde una maquina; por usuario, al que prueba la misma
# cuenta desde varias. Solo suman los intentos fallidos, y un login correcto
# borra el contador de las dos claves.
#
# Vive en memoria y se pierde al reiniciar. Alcanza porque la app corre con un
# solo worker (ver el comentario de _polling_loop en notifications.py); si algun
# dia se levantan varios procesos, esto hay que mudarlo a la base.
MAX_INTENTOS = 5
VENTANA_INTENTOS = 300     # segundos que se miran hacia atras
DEMORA_POR_FALLO = 1.0     # segundos de espera antes de contestar un fallo

_intentos: dict[str, deque[float]] = {}


def _fallos_recientes(clave: str) -> int:
    """Intentos fallidos dentro de la ventana, descartando los que ya vencieron."""
    cola = _intentos.get(clave)
    if not cola:
        return 0
    corte = time.monotonic() - VENTANA_INTENTOS
    while cola and cola[0] < corte:
        cola.popleft()
    if not cola:
        # Sin esto, un script probando usuarios inventados deja una clave
        # colgada por cada nombre que se le ocurrio.
        del _intentos[clave]
        return 0
    return len(cola)


def _ip_de(request: Request) -> str:
    return request.client.host if request.client else "desconocida"


def _claves_de(request: Request, username: str) -> tuple[str, str]:
    ip = _ip_de(request)
    return f"ip:{ip}", f"user:{username.strip().lower()}"


def _con_secciones(usuario: dict) -> dict:
    """Agrega al usuario las secciones que puede ver.

    Van con el usuario y no en un endpoint aparte para que la pantalla no tenga
    que hacer dos pedidos antes de poder dibujar el menu. Es lo que la barra
    lateral y el ruteo usan en lugar de la lista de roles que tenian escrita.
    """
    return {**usuario, "secciones": sorted(db.secciones_de(usuario["rol"]))}


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(datos: LoginRequest, request: Request):
    claves = _claves_de(request, datos.username)

    # El corte va antes del bind: la idea es no llegar nunca al controlador de
    # dominio una vez pasado el limite.
    if any(_fallos_recientes(c) >= MAX_INTENTOS for c in claves):
        raise HTTPException(
            status_code=429,
            detail="Demasiados intentos fallidos. Espera unos minutos y volve a probar.",
        )

    usuario = await autenticar(datos.username, datos.password)
    if not usuario:
        ahora = time.monotonic()
        for clave in claves:
            _intentos.setdefault(clave, deque()).append(ahora)
        # Queda el usuario tipeado y la IP, nunca la contrasena. Una contrasena
        # en la auditoria es una contrasena filtrada, y ademas la de al lado
        # suele ser la buena con un caracter de mas.
        db.registrar_auditoria(
            db.AUD_LOGIN_FALLIDO,
            actor_nombre=datos.username.strip(),
            detalle=f"desde {_ip_de(request)}",
        )
        # Un segundo de demora en cada fallo: no se nota cuando uno se equivoco
        # tipeando, y le saca toda la velocidad a un script.
        await asyncio.sleep(DEMORA_POR_FALLO)
        raise HTTPException(status_code=401, detail="Usuario o contrasena incorrectos")

    for clave in claves:
        _intentos.pop(clave, None)
    request.session[SESSION_KEY] = usuario["glpi_user_id"]
    db.registrar_auditoria(
        db.AUD_LOGIN,
        actor=usuario["glpi_user_id"],
        actor_nombre=usuario["nombre"],
        detalle=f"desde {_ip_de(request)}",
    )
    return _con_secciones(usuario)


@router.post("/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/me")
async def me(usuario: dict = Depends(usuario_actual)):
    return _con_secciones(usuario)
