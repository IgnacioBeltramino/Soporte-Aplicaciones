"""Tableros de tareas del area.

Son tareas propias, no tickets de GLPI: viven en la base local y no se le
escribe nada a GLPI. Hay dos tableros:

  - grupo:    uno solo para todo el equipo. Jefe y tecnico editan; el pasante
              lo ve pero no lo toca, para que se entere de en que anda el area.
  - personal: uno por persona y privado. No lo ve nadie mas, ni el jefe. Esa es
              la condicion para que alguien lo use de verdad para organizarse.

Los dos se crean solos la primera vez que se entra, con columnas por defecto.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

import db
from auth import usuario_actual

router = APIRouter(prefix="/api/kanban", tags=["kanban"])

PUEDEN_EDITAR_GRUPO = (db.ROL_JEFE, db.ROL_TECNICO)

# Topes de longitud. No son reglas de negocio: son el techo de lo que se acepta
# guardar. Sin ellos, cualquiera con sesion puede mandar una tarjeta de cientos
# de megas y la base se la come entera. Estan holgados a proposito -nadie escribe
# un titulo de 200 caracteres- para que corten al abuso y no al uso normal.
MAX_NOMBRE_COLUMNA = 60
MAX_TITULO = 200
MAX_DETALLE = 5000


def _texto_obligatorio(v: str, campo: str) -> str:
    v = (v or "").strip()
    if not v:
        raise ValueError(f"{campo} no puede estar vacio")
    return v


class ColumnaIn(BaseModel):
    nombre: str = Field(max_length=MAX_NOMBRE_COLUMNA)

    @field_validator("nombre")
    @classmethod
    def valida(cls, v: str) -> str:
        return _texto_obligatorio(v, "El nombre")


class TarjetaIn(BaseModel):
    titulo: str = Field(max_length=MAX_TITULO)
    detalle: str | None = Field(default=None, max_length=MAX_DETALLE)
    responsable: int | None = None

    @field_validator("titulo")
    @classmethod
    def valida_titulo(cls, v: str) -> str:
        return _texto_obligatorio(v, "El titulo")

    @field_validator("detalle")
    @classmethod
    def vacio_es_nulo(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() or None


class AsignacionIn(BaseModel):
    responsable: int | None = None


class MovimientoIn(BaseModel):
    columna_id: int
    posicion: int = 0


def _responsable_valido(responsable: int | None, tablero: dict) -> int | None:
    """Normaliza el responsable segun el tablero.

    En el personal siempre es nulo: el tablero ya es de una sola persona y un
    responsable ahi no significa nada. En el del grupo tiene que ser alguien
    que exista y pueda editarlo, para que no queden tarjetas apuntando a un
    usuario borrado o a un id inventado.
    """
    if responsable is None or tablero["tipo"] == db.KANBAN_PERSONAL:
        return None

    if responsable not in {u["glpi_user_id"] for u in db.usuarios_asignables()}:
        raise HTTPException(
            status_code=400,
            detail="Esa persona no esta habilitada para tener tareas asignadas.",
        )
    return responsable


def _tablero_pedido(tipo: str, usuario: dict) -> dict:
    """Resuelve que tablero se esta pidiendo y si el usuario puede verlo.

    Devuelve el tablero como esta en la base y no solo su id: los permisos se
    resuelven mirando `tipo` y `dueno`, y esos dos tienen que salir de la base
    y no de lo que se arme aca.
    """
    if tipo not in db.KANBAN_TIPOS:
        raise HTTPException(status_code=404, detail="Ese tablero no existe.")

    if tipo == db.KANBAN_GRUPO:
        tablero_id = db.obtener_o_crear_tablero(db.KANBAN_GRUPO)
    else:
        # El personal siempre es el de quien pregunta: no se acepta un id de
        # dueño por parametro, asi no hay forma de pedir el de otro.
        tablero_id = db.obtener_o_crear_tablero(db.KANBAN_PERSONAL, usuario["glpi_user_id"])

    return db.get_tablero(tablero_id)


def _exigir_edicion(tablero: dict | None, usuario: dict):
    """Corta si el usuario no puede modificar ese tablero.

    Se valida contra el tablero al que pertenece la columna o la tarjeta, y no
    contra lo que diga el frontend: si dependiera de un parametro, alcanzaria
    con llamar al endpoint a mano para escribir en el tablero de otro.
    """
    if not tablero:
        raise HTTPException(status_code=404, detail="No se encontro eso que queres modificar.")

    if tablero["tipo"] == db.KANBAN_PERSONAL:
        if tablero["dueno"] != usuario["glpi_user_id"]:
            raise HTTPException(status_code=403, detail="Ese tablero es de otra persona.")
        return

    if usuario["rol"] not in PUEDEN_EDITAR_GRUPO:
        raise HTTPException(
            status_code=403,
            detail="Tu rol puede ver el tablero del grupo, pero no modificarlo.",
        )


@router.get("/{tipo}")
async def ver_tablero(tipo: str, usuario: dict = Depends(usuario_actual)):
    tablero = _tablero_pedido(tipo, usuario)
    return {
        "tipo": tipo,
        "puede_editar": (
            True if tipo == db.KANBAN_PERSONAL else usuario["rol"] in PUEDEN_EDITAR_GRUPO
        ),
        # Va en la misma respuesta y no en un endpoint aparte: la pantalla la
        # necesita siempre, y son los nombres del equipo, que ya se ven en tickets.
        "gente": db.usuarios_asignables() if tipo == db.KANBAN_GRUPO else [],
        "columnas": db.kanban_tablero(tablero["id"]),
    }


@router.post("/{tipo}/columnas")
async def nueva_columna(tipo: str, datos: ColumnaIn, usuario: dict = Depends(usuario_actual)):
    tablero = _tablero_pedido(tipo, usuario)
    # El tablero que se valida es el de la base. Antes se armaba aca un dict con
    # "dueno": el usuario actual, que para el tablero del grupo era mentira: hoy
    # no se nota porque _exigir_edicion, para el del grupo, mira el rol y no el
    # dueño, pero el dia que lo mire iba a dejar pasar a cualquiera sin que nada
    # fallara.
    _exigir_edicion(tablero, usuario)
    db.crear_columna(tablero["id"], datos.nombre)
    return db.kanban_tablero(tablero["id"])


@router.put("/columnas/{columna_id}")
async def editar_columna(
    columna_id: int, datos: ColumnaIn, usuario: dict = Depends(usuario_actual)
):
    tablero = db.tablero_de_columna(columna_id)
    _exigir_edicion(tablero, usuario)
    db.renombrar_columna(columna_id, datos.nombre)
    return db.kanban_tablero(tablero["id"])


@router.delete("/columnas/{columna_id}")
async def eliminar_columna(columna_id: int, usuario: dict = Depends(usuario_actual)):
    tablero = db.tablero_de_columna(columna_id)
    _exigir_edicion(tablero, usuario)

    # Un tablero sin columnas no se puede volver a usar desde la pantalla.
    if db.contar_columnas(tablero["id"]) <= 1:
        raise HTTPException(
            status_code=400,
            detail="No podes borrar la ultima columna: el tablero quedaria sin donde poner tarjetas.",
        )

    db.borrar_columna(columna_id)
    return db.kanban_tablero(tablero["id"])


@router.post("/columnas/{columna_id}/tarjetas")
async def nueva_tarjeta(
    columna_id: int, datos: TarjetaIn, usuario: dict = Depends(usuario_actual)
):
    tablero = db.tablero_de_columna(columna_id)
    _exigir_edicion(tablero, usuario)
    db.crear_tarjeta(
        columna_id,
        datos.titulo,
        datos.detalle,
        usuario["glpi_user_id"],
        _responsable_valido(datos.responsable, tablero),
    )
    return db.kanban_tablero(tablero["id"])


@router.put("/tarjetas/{tarjeta_id}")
async def actualizar_tarjeta(
    tarjeta_id: int, datos: TarjetaIn, usuario: dict = Depends(usuario_actual)
):
    tablero = db.tablero_de_tarjeta(tarjeta_id)
    _exigir_edicion(tablero, usuario)
    db.editar_tarjeta(
        tarjeta_id,
        datos.titulo,
        datos.detalle,
        usuario["glpi_user_id"],
        _responsable_valido(datos.responsable, tablero),
    )
    return db.kanban_tablero(tablero["id"])


@router.put("/tarjetas/{tarjeta_id}/asignar")
async def asignar(
    tarjeta_id: int, datos: AsignacionIn, usuario: dict = Depends(usuario_actual)
):
    """Cambiar solo el responsable, sin mandar titulo ni detalle."""
    tablero = db.tablero_de_tarjeta(tarjeta_id)
    _exigir_edicion(tablero, usuario)
    db.asignar_tarjeta(
        tarjeta_id,
        _responsable_valido(datos.responsable, tablero),
        usuario["glpi_user_id"],
    )
    return db.kanban_tablero(tablero["id"])


@router.delete("/tarjetas/{tarjeta_id}")
async def eliminar_tarjeta(tarjeta_id: int, usuario: dict = Depends(usuario_actual)):
    tablero = db.tablero_de_tarjeta(tarjeta_id)
    _exigir_edicion(tablero, usuario)
    db.borrar_tarjeta(tarjeta_id)
    return db.kanban_tablero(tablero["id"])


@router.put("/tarjetas/{tarjeta_id}/mover")
async def mover(tarjeta_id: int, datos: MovimientoIn, usuario: dict = Depends(usuario_actual)):
    tablero = db.tablero_de_tarjeta(tarjeta_id)
    _exigir_edicion(tablero, usuario)

    # La columna destino tiene que ser del mismo tablero: sin esto se podria
    # mandar una tarjeta del tablero del grupo al personal de cualquiera.
    destino = db.tablero_de_columna(datos.columna_id)
    if not destino or destino["id"] != tablero["id"]:
        raise HTTPException(status_code=400, detail="Esa columna no es de este tablero.")

    db.mover_tarjeta(tarjeta_id, datos.columna_id, datos.posicion)
    return db.kanban_tablero(tablero["id"])
