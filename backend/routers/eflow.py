"""ABM de equipos EFLOW: totems y nodos.

Reemplaza a los dos JSON de la unidad de red del Menu de Soporte. Alla eran
dos archivos separados; aca es una sola tabla con una columna `tipo`, asi que
un unico router atiende los dos casos.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

import db
from auth import requiere_seccion

router = APIRouter(prefix="/api/eflow", tags=["eflow"])

# Igual que ficheros: el permiso sale de la tabla y se configura en Perfiles.
equipo = requiere_seccion("eflow")


class EquipoIn(BaseModel):
    # Igual que en ficheros: topes holgados, para que corten al abuso y no al
    # nombre mas largo que alguien pueda necesitar de verdad.
    nombre: str = Field(max_length=100)
    nro_pc: str | None = Field(default=None, max_length=50)

    @field_validator("nombre")
    @classmethod
    def nombre_no_vacio(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("El nombre no puede estar vacio")
        return v

    @field_validator("nro_pc")
    @classmethod
    def vacio_es_nulo(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class EquipoNuevo(EquipoIn):
    tipo: str

    @field_validator("tipo")
    @classmethod
    def tipo_valido(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in db.TIPOS_EFLOW:
            raise ValueError(f"El tipo tiene que ser uno de: {', '.join(db.TIPOS_EFLOW)}")
        return v


@router.get("")
async def listar(
    tipo: str | None = Query(default=None),
    usuario: dict = Depends(equipo),
):
    """Todos los equipos, o solo los de un tipo si viene ?tipo=totem|nodo."""
    if tipo is not None:
        tipo = tipo.strip().lower()
        if tipo not in db.TIPOS_EFLOW:
            raise HTTPException(status_code=400, detail="Tipo de equipo desconocido")
    return db.listar_eflow(tipo)


@router.post("", status_code=201)
async def crear(datos: EquipoNuevo, usuario: dict = Depends(equipo)):
    return db.crear_eflow(datos.tipo, datos.nombre, datos.nro_pc, usuario["glpi_user_id"])


@router.put("/{equipo_id}")
async def actualizar(equipo_id: int, datos: EquipoIn, usuario: dict = Depends(equipo)):
    # El tipo no se edita: un totem no se convierte en nodo. Si hace falta,
    # se borra y se crea de nuevo.
    if not db.get_eflow(equipo_id):
        raise HTTPException(status_code=404, detail="El equipo no existe")
    return db.actualizar_eflow(equipo_id, datos.nombre, datos.nro_pc, usuario["glpi_user_id"])


@router.delete("/{equipo_id}")
async def borrar(equipo_id: int, usuario: dict = Depends(equipo)):
    if not db.borrar_eflow(equipo_id):
        raise HTTPException(status_code=404, detail="El equipo no existe")
    return {"ok": True}
