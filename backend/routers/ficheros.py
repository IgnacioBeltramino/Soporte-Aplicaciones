"""ABM de ficheros y chequeo de estado por ping.

Reemplaza al JSON de la unidad de red del Menu de Soporte. A diferencia de
aquel, dos personas pueden editar sin pisarse y queda registrado quien hizo
cada cambio.
"""
import asyncio
import ipaddress
import re
import subprocess

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

import db
from auth import requiere_seccion
from ratelimit import limite

router = APIRouter(prefix="/api/ficheros", tags=["ficheros"])

# Quien entra sale de la tabla de permisos (pantalla de Perfiles). Arranca con
# jefe y tecnico, que es como venia: es informacion de infraestructura del area.
equipo = requiere_seccion("ficheros")

# El unico endpoint caro del router: pinguea la lista entera. El resto son
# lecturas de SQLite y no necesitan tope. Quince por minuto es holgado para un
# boton que se aprieta a mano.
tope_estado = limite("ficheros_estado", maximo=15, ventana=60)

# Nombre de host valido segun RFC 1123 (letras, numeros y guiones por etiqueta).
_HOSTNAME = re.compile(r"^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
                       r"(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$")

PING_TIMEOUT_MS = 700
PING_CONCURRENCIA = 20


def _destino_valido(valor: str) -> bool:
    """Solo IPs o nombres de host. Corta cualquier intento de meter comandos."""
    try:
        ipaddress.ip_address(valor)
        return True
    except ValueError:
        return bool(_HOSTNAME.match(valor))


class FicheroIn(BaseModel):
    # El tope del nombre corta el abuso, no el uso: los ficheros se llaman
    # "Fichero Rentas 3", no doscientos caracteres. El de la IP es el maximo que
    # admite un FQDN segun la RFC 1035, el mismo que ya exige _HOSTNAME.
    nombre: str = Field(max_length=100)
    ip: str | None = Field(default=None, max_length=253)

    @field_validator("nombre")
    @classmethod
    def nombre_no_vacio(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("El nombre no puede estar vacio")
        return v

    @field_validator("ip")
    @classmethod
    def ip_valida(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if not _destino_valido(v):
            raise ValueError("Tiene que ser una IP o un nombre de host valido")
        return v


def _ping(destino: str) -> bool:
    """Un ping suelto. Bloqueante: se llama desde un thread.

    Los argumentos van como lista y sin shell: aunque el destino ya viene
    validado, asi no hay forma de que se interprete como comando.
    """
    try:
        r = subprocess.run(
            ["ping", "-n", "1", "-w", str(PING_TIMEOUT_MS), destino],
            capture_output=True,
            timeout=PING_TIMEOUT_MS / 1000 + 3,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return r.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


@router.get("")
async def listar(usuario: dict = Depends(equipo)):
    return db.listar_ficheros()


@router.get("/estado", dependencies=[Depends(tope_estado)])
async def estado(usuario: dict = Depends(equipo)):
    """Pinguea todos los ficheros que tengan IP, en paralelo."""
    ficheros = db.listar_ficheros()
    limite = asyncio.Semaphore(PING_CONCURRENCIA)

    async def revisar(f: dict) -> dict:
        if not f["ip"]:
            return {**f, "estado": "sin_ip"}
        async with limite:
            vivo = await asyncio.to_thread(_ping, f["ip"])
        return {**f, "estado": "online" if vivo else "offline"}

    return await asyncio.gather(*[revisar(f) for f in ficheros])


@router.post("", status_code=201)
async def crear(datos: FicheroIn, usuario: dict = Depends(equipo)):
    return db.crear_fichero(datos.nombre, datos.ip, usuario["glpi_user_id"])


@router.put("/{fichero_id}")
async def actualizar(fichero_id: int, datos: FicheroIn, usuario: dict = Depends(equipo)):
    if not db.get_fichero(fichero_id):
        raise HTTPException(status_code=404, detail="El fichero no existe")
    return db.actualizar_fichero(fichero_id, datos.nombre, datos.ip, usuario["glpi_user_id"])


@router.delete("/{fichero_id}")
async def borrar(fichero_id: int, usuario: dict = Depends(equipo)):
    if not db.borrar_fichero(fichero_id):
        raise HTTPException(status_code=404, detail="El fichero no existe")
    return {"ok": True}
