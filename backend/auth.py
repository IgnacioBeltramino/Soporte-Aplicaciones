import logging
import os
from typing import Optional

from fastapi import Depends, HTTPException, Request

import db
from glpi_client import GLPI_GROUP_NAME, buscar_usuario_por_login, glpi
from ldap_auth import validar_ldap

log = logging.getLogger("auth")

JEFE_INICIAL = int(os.getenv("JEFE_INICIAL") or 0)

SESSION_KEY = "glpi_user_id"


async def autenticar(username: str, password: str) -> Optional[dict]:
    """Autentica contra AD y resuelve los permisos contra GLPI.

    AD dice quien sos; GLPI y la base local dicen que podes ver.

    Devuelve None si las credenciales son invalidas.
    Lanza HTTPException 403 si el usuario es valido pero no tiene acceso.
    """
    ok, detalle = await validar_ldap(username, password)
    if not ok:
        # Queda el usuario, nunca la contrasena: sirve de auditoria y es lo
        # primero que se mira cuando alguien dice que no puede entrar.
        log.warning("Bind LDAP rechazado para %r: %s", username, detalle)
        return None

    datos = await buscar_usuario_por_login(username)
    if not datos:
        raise HTTPException(
            status_code=403,
            detail="Tus credenciales son validas pero no tenes usuario en GLPI.",
        )

    uid = datos["glpi_user_id"]

    # Solo entran los miembros del grupo de soporte.
    #
    # La lista vacia se trata como fallo y no como "el grupo no tiene a nadie".
    # get_group_member_ids devuelve un set vacio en tres situaciones -el grupo
    # no se encontro (lo renombraron en GLPI), GLPI no contesto, el token
    # vencio- y antes eso se leia como "no hay con que comparar, que pase".
    # El resultado era el peor posible para un control de acceso: con GLPI
    # caido, cualquiera con usuario de AD y ficha en GLPI entraba como tecnico.
    #
    # Ante la duda no se deja entrar a nadie. Es preferible que el area no pueda
    # trabajar diez minutos y llame, a que el sistema quede abierto sin que
    # nadie se entere: lo primero se nota enseguida, lo segundo no se nota nunca.
    miembros = await glpi.get_group_member_ids()
    if not miembros:
        log.error(
            "No se pudo obtener la nomina del grupo %r en GLPI: se rechaza el "
            "login de %r por las dudas. Revisar que el grupo exista con ese "
            "nombre (GLPI_GROUP_NAME) y que GLPI responda.",
            GLPI_GROUP_NAME, username,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "No se pudo verificar tu pertenencia al grupo de soporte. "
                "Probablemente sea un problema con GLPI: avisale al area."
            ),
        )

    if str(uid) not in miembros:
        raise HTTPException(
            status_code=403,
            detail=f"Tu usuario no pertenece al grupo {GLPI_GROUP_NAME}.",
        )

    rol_inicial = db.ROL_JEFE if uid == JEFE_INICIAL else db.ROL_TECNICO
    usuario = db.registrar_acceso(uid, datos["username"], datos["nombre"], rol_inicial)

    if not usuario["habilitado"]:
        raise HTTPException(status_code=403, detail="Tu usuario esta deshabilitado.")

    return usuario


def usuario_actual(request: Request) -> dict:
    """Dependencia: devuelve el usuario logueado o corta con 401."""
    uid = request.session.get(SESSION_KEY)
    if not uid:
        raise HTTPException(status_code=401, detail="No autenticado")
    usuario = db.get_usuario(uid)
    if not usuario or not usuario["habilitado"]:
        request.session.clear()
        raise HTTPException(status_code=401, detail="Sesion invalida")
    return usuario


def solo_jefe(usuario: dict = Depends(usuario_actual)) -> dict:
    """Dependencia: igual que usuario_actual pero exige rol jefe."""
    if usuario["rol"] != db.ROL_JEFE:
        raise HTTPException(status_code=403, detail="Requiere permisos de jefe")
    return usuario


def requiere_roles(*roles: str):
    """Fabrica una dependencia que solo deja pasar a los roles indicados.

    Se usa cuando el permiso no es "jefe si / jefe no": por ejemplo, las
    estadisticas las ven jefe y tecnico, pero no el pasante.
    """
    def dependencia(usuario: dict = Depends(usuario_actual)) -> dict:
        if usuario["rol"] not in roles:
            raise HTTPException(
                status_code=403,
                detail="Tu rol no tiene acceso a esta seccion.",
            )
        return usuario
    return dependencia


def requiere_seccion(seccion: str):
    """Fabrica una dependencia que exige tener permiso sobre una seccion.

    Es lo mismo que requiere_roles pero preguntandole a la base en vez de tener
    los roles escritos en el codigo: si el jefe le da Reportes al pasante desde
    la pantalla de Perfiles, el pasante entra sin que haya que tocar nada aca.

    El permiso se consulta en cada request a proposito. Es una tabla de trece
    filas en un SQLite local, y cachearla traeria el problema de siempre: a
    quien le sacaron un permiso lo seguiria teniendo hasta que venciera el
    cache, que es justo lo que uno no quiere de un control de acceso.
    """
    def dependencia(usuario: dict = Depends(usuario_actual)) -> dict:
        if seccion not in db.secciones_de(usuario["rol"]):
            raise HTTPException(
                status_code=403,
                detail="Tu rol no tiene acceso a esta seccion.",
            )
        return usuario
    return dependencia
