"""Autenticacion contra Active Directory por LDAP con NTLM.

Por que NTLM y no LDAPS:
  Los controladores de dominio del municipio exponen el 636, pero negocian
  una version de TLS que OpenSSL 3.x ya no trae compilada (UNSUPPORTED_PROTOCOL),
  asi que LDAPS no se puede usar desde Python. La alternativa obvia seria un
  simple bind sobre el 389, pero ahi la contrasena viaja en texto plano.

  NTLM resuelve las dos cosas: usa desafio-respuesta sobre el 389, de manera
  que la contrasena nunca se envia por la red.

Solo valida credenciales (bind directo con el usuario que se loguea): no
necesita usuario de servicio ni permisos de lectura sobre el arbol. Los
permisos del dashboard salen de GLPI y de la base local, no del AD.
"""
import asyncio
import hashlib
import os
from pathlib import Path

from Crypto.Hash import MD4 as _MD4
from dotenv import load_dotenv

# OpenSSL 3 removio MD4, que NTLM necesita para derivar el hash de la
# contrasena. Se lo aportamos a hashlib desde pycryptodome ANTES de importar
# ldap3, que es quien lo va a pedir.
_hashlib_new_original = hashlib.new


def _hashlib_new_con_md4(name, data=b"", **kwargs):
    if name.lower() in ("md4", "md-4"):
        h = _MD4.new()
        if data:
            h.update(data)
        return h
    return _hashlib_new_original(name, data, **kwargs)


hashlib.new = _hashlib_new_con_md4

from ldap3 import NTLM, Connection, Server  # noqa: E402
from ldap3.core.exceptions import LDAPException  # noqa: E402

# Se carga aca tambien para no depender del orden de los imports.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

LDAP_SERVER = os.getenv("LDAP_SERVER", "")
LDAP_NETBIOS = os.getenv("LDAP_NETBIOS", "")
LDAP_PORT = int(os.getenv("LDAP_PORT") or 389)


def _bind(username: str, password: str) -> tuple[bool, str]:
    """Intenta el bind NTLM. Devuelve (exito, detalle). Bloqueante: usar en thread."""
    if not LDAP_SERVER:
        return False, "LDAP_SERVER no configurado en el .env"
    if not LDAP_NETBIOS:
        return False, "LDAP_NETBIOS no configurado en el .env (NTLM lo necesita)"
    if not password:
        # Un bind con contrasena vacia puede ser aceptado como anonimo por
        # algunos servidores: se corta antes de llegar al DC.
        return False, "contrasena vacia"

    user_ntlm = f"{LDAP_NETBIOS}\\{username}"
    try:
        conn = Connection(
            Server(LDAP_SERVER, port=LDAP_PORT),
            user=user_ntlm,
            password=password,
            authentication=NTLM,
            receive_timeout=15,
        )
        if conn.bind():
            conn.unbind()
            return True, f"bind NTLM OK como {user_ntlm}"
        return False, conn.result.get("description", "bind rechazado")
    except LDAPException as e:
        return False, f"{type(e).__name__}: {e}"


async def validar_ldap(username: str, password: str) -> tuple[bool, str]:
    """Valida usuario/contrasena contra AD sin bloquear el event loop."""
    return await asyncio.to_thread(_bind, username, password)
