"""Gestion de usuarios y permisos del dashboard.

Todo el router exige rol jefe. La lista combina dos fuentes:
  - GLPI: quienes integran el grupo Soporte Aplicaciones (la nomina real)
  - SQLite: quienes ya entraron alguna vez y con que rol quedaron

Asi el jefe ve tambien a los que todavia no ingresaron, que de otro modo no
aparecerian en ningun lado.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import db
from auth import requiere_seccion
from glpi_client import glpi
from routers.notifications import enviar_mensaje_de_prueba

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Quien administra usuarios y permisos es quien tenga la seccion, que arranca
# siendo solo el jefe. Ojo con darsela a otro rol desde la pantalla de Perfiles:
# desde aca se cambian roles y permisos, asi que quien entre puede darse a si
# mismo cualquier cosa. La pantalla lo avisa.
admin_permisos = requiere_seccion(db.SECCION_ADMIN)


class CambioRol(BaseModel):
    rol: str


class CambioPermisos(BaseModel):
    secciones: list[str]


class CambioHabilitado(BaseModel):
    habilitado: bool


class ConfigTelegram(BaseModel):
    chat_id: str | None = None
    activo: bool = True


@router.get("/usuarios", dependencies=[Depends(admin_permisos)])
async def listar_usuarios():
    """Nomina del grupo cruzada con el estado local de cada usuario."""
    registrados = {u["glpi_user_id"]: u for u in db.listar_usuarios()}

    miembros = await glpi.get_group_member_ids()
    nombres = await glpi.resolve_user_names(miembros) if miembros else {}

    salida = []
    for uid_str in miembros:
        uid = int(uid_str)
        u = registrados.pop(uid, None)
        if u:
            salida.append({**u, "ingreso": True})
        else:
            salida.append({
                "glpi_user_id": uid,
                "username": None,
                "nombre": nombres.get(uid_str, f"Usuario {uid}"),
                "rol": db.ROL_TECNICO,
                "habilitado": 1,
                "primer_acceso": None,
                "ultimo_acceso": None,
                "ingreso": False,
            })

    # Usuarios que estan en la base pero ya no figuran en el grupo (por ejemplo,
    # alguien movido de area): se muestran igual para poder deshabilitarlos.
    for u in registrados.values():
        salida.append({**u, "ingreso": True, "fuera_del_grupo": True})

    salida.sort(key=lambda u: (u["rol"] != db.ROL_JEFE, (u["nombre"] or "").lower()))
    return salida


@router.put("/usuarios/{glpi_user_id}/rol")
async def cambiar_rol(
    glpi_user_id: int,
    datos: CambioRol,
    jefe: dict = Depends(admin_permisos),
):
    if datos.rol not in db.ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Rol invalido. Validos: {', '.join(db.ROLES)}",
        )

    usuario = db.get_usuario(glpi_user_id)
    if not usuario:
        raise HTTPException(
            status_code=404,
            detail="El usuario todavia no ingreso al sistema, no se le puede asignar un rol.",
        )

    # No dejar el sistema sin ningun jefe.
    if usuario["rol"] == db.ROL_JEFE and datos.rol != db.ROL_JEFE:
        if db.contar_jefes(excluyendo=glpi_user_id) == 0:
            raise HTTPException(
                status_code=400,
                detail="No podes quitar el ultimo jefe: alguien tiene que poder administrar permisos.",
            )

    db.set_rol(glpi_user_id, datos.rol)
    # Se anota despues del cambio y no antes: si el UPDATE fallara, quedaria
    # registrado un hecho que nunca ocurrio.
    db.registrar_auditoria(
        db.AUD_CAMBIO_ROL,
        actor=jefe["glpi_user_id"],
        actor_nombre=jefe["nombre"],
        objeto_tipo="usuario",
        objeto_id=glpi_user_id,
        objeto_nombre=usuario["nombre"],
        # El rol anterior es la mitad del dato: sin el, el renglon dice a donde
        # llego pero no de donde venia, que es lo que uno va a mirar.
        detalle=f"{usuario['rol']} -> {datos.rol}",
    )
    return db.get_usuario(glpi_user_id)


@router.get("/perfiles", dependencies=[Depends(admin_permisos)])
async def ver_perfiles():
    """Catalogo de secciones y que ve cada rol.

    El catalogo va en la respuesta y no escrito en la pantalla: si algun dia se
    suma una seccion, aparece sola en Perfiles sin tocar el frontend.
    """
    return {
        "secciones": [{"id": s, "label": label} for s, label in db.SECCIONES],
        "permisos": db.permisos_por_rol(),
        "seccion_admin": db.SECCION_ADMIN,
    }


@router.put("/perfiles/{rol}")
async def cambiar_perfil(
    rol: str,
    datos: CambioPermisos,
    jefe: dict = Depends(admin_permisos),
):
    if rol not in db.ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Rol invalido. Validos: {', '.join(db.ROLES)}",
        )

    antes = sorted(db.secciones_de(rol))
    secciones = db.set_permisos(rol, datos.secciones)

    # Se anota la diferencia y no la lista entera. Una lista de trece secciones
    # repetida en cada renglon no se puede leer de un vistazo, y lo que uno va a
    # buscar es exactamente esto: que permiso se dio y cual se saco.
    sumadas = [s for s in secciones if s not in antes]
    quitadas = [s for s in antes if s not in secciones]
    if sumadas or quitadas:
        partes = []
        if sumadas:
            partes.append("suma " + ", ".join(sumadas))
        if quitadas:
            partes.append("quita " + ", ".join(quitadas))
        db.registrar_auditoria(
            db.AUD_CAMBIO_PERMISOS,
            actor=jefe["glpi_user_id"],
            actor_nombre=jefe["nombre"],
            objeto_tipo="rol",
            objeto_id=rol,
            objeto_nombre=rol,
            detalle="; ".join(partes),
        )

    return {"rol": rol, "secciones": secciones}


@router.get("/auditoria", dependencies=[Depends(admin_permisos)])
async def ver_auditoria(
    limite: int = Query(default=200, ge=1, le=1000),
    accion: str | None = Query(default=None),
):
    """Quien hizo que y cuando, de lo mas nuevo a lo mas viejo.

    El catalogo de acciones viaja en la respuesta por lo mismo que el de
    secciones en /perfiles: si manaña se audita algo nuevo, el filtro de la
    pantalla lo muestra solo, sin tocar el frontend.
    """
    if accion and accion not in db.AUD_ETIQUETAS:
        raise HTTPException(status_code=400, detail="Esa accion no existe.")
    return {
        "acciones": [
            {"id": a, "label": etiqueta} for a, etiqueta in db.AUD_ETIQUETAS.items()
        ],
        "registros": db.listar_auditoria(limite, accion),
    }


@router.put("/usuarios/{glpi_user_id}/habilitado")
async def cambiar_habilitado(
    glpi_user_id: int,
    datos: CambioHabilitado,
    jefe: dict = Depends(admin_permisos),
):
    usuario = db.get_usuario(glpi_user_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="El usuario todavia no ingreso al sistema.")

    if glpi_user_id == jefe["glpi_user_id"] and not datos.habilitado:
        raise HTTPException(status_code=400, detail="No podes deshabilitarte a vos mismo.")

    if not datos.habilitado and usuario["rol"] == db.ROL_JEFE:
        if db.contar_jefes(excluyendo=glpi_user_id) == 0:
            raise HTTPException(status_code=400, detail="No podes deshabilitar al ultimo jefe.")

    db.set_habilitado(glpi_user_id, datos.habilitado)
    db.registrar_auditoria(
        db.AUD_HABILITADO if datos.habilitado else db.AUD_DESHABILITADO,
        actor=jefe["glpi_user_id"],
        actor_nombre=jefe["nombre"],
        objeto_tipo="usuario",
        objeto_id=glpi_user_id,
        objeto_nombre=usuario["nombre"],
    )
    return db.get_usuario(glpi_user_id)


@router.put("/usuarios/{glpi_user_id}/telegram")
async def configurar_telegram(
    glpi_user_id: int,
    datos: ConfigTelegram,
    jefe: dict = Depends(admin_permisos),
):
    usuario = db.get_usuario(glpi_user_id)
    if not usuario:
        raise HTTPException(
            status_code=404,
            detail="El usuario todavia no ingreso al sistema, no se le puede cargar el chat.",
        )

    chat_id = (datos.chat_id or "").strip()
    # Telegram usa enteros (negativos para los grupos). Si entra cualquier cosa,
    # el aviso se pierde en silencio dentro del loop de fondo, asi que se corta aca.
    if chat_id:
        try:
            int(chat_id)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="El chat ID es un numero (puede ser negativo si es un grupo).",
            )

    db.set_telegram(glpi_user_id, chat_id, datos.activo)
    # El chat_id no se guarda en el detalle: es a donde le llegan los avisos a
    # una persona. Alcanza con saber que se le cambio y quien lo hizo.
    db.registrar_auditoria(
        db.AUD_CAMBIO_TELEGRAM,
        actor=jefe["glpi_user_id"],
        actor_nombre=jefe["nombre"],
        objeto_tipo="usuario",
        objeto_id=glpi_user_id,
        objeto_nombre=usuario["nombre"],
        detalle=(
            ("chat cargado" if chat_id else "chat borrado")
            + (", avisos activos" if datos.activo else ", avisos en pausa")
        ),
    )
    return db.get_usuario(glpi_user_id)


@router.post("/usuarios/{glpi_user_id}/telegram/probar", dependencies=[Depends(admin_permisos)])
async def probar_telegram(glpi_user_id: int):
    """Manda un mensaje real al chat guardado, para no quedarse en la duda.

    Se prueba lo que esta en la base y no lo que el jefe tiene escrito en la
    pantalla: si no, se puede terminar probando algo que despues no se guardo.
    """
    usuario = db.get_usuario(glpi_user_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="El usuario todavia no ingreso al sistema.")

    chat_id = (usuario["telegram_chat_id"] or "").strip()
    if not chat_id:
        raise HTTPException(status_code=400, detail="Ese usuario no tiene chat de Telegram cargado.")

    ok, detalle = await enviar_mensaje_de_prueba(chat_id)
    if not ok:
        raise HTTPException(status_code=400, detail=detalle)

    avisos = []
    # El envio anduvo, pero eso no quiere decir que le vayan a llegar los avisos.
    if not usuario["telegram_activo"]:
        avisos.append("tiene los avisos en pausa")
    if not usuario["habilitado"]:
        avisos.append("esta deshabilitado")
    if usuario["rol"] not in db.ROLES_CON_TELEGRAM:
        avisos.append(f"su rol ({usuario['rol']}) no recibe Telegram")

    return {
        "ok": True,
        "detalle": detalle,
        "aviso": (
            "Ojo: el mensaje llego, pero no va a recibir notificaciones porque "
            + " y ".join(avisos) + "."
        ) if avisos else None,
    }
