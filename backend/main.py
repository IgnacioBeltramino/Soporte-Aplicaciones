import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.middleware.sessions import SessionMiddleware

import db
import logging_config
from auth import requiere_seccion, usuario_actual
from glpi_client import glpi, verificacion_tls
from ratelimit import limite


def avisar_tls_de_glpi():
    """Deja constancia en el log de si se valida el certificado de GLPI.

    Se llama al arrancar y no en la primera consulta a proposito: si
    GLPI_CA_BUNDLE tiene un error de tipeo, se entera ahora el que despliega y
    no dentro de dos semanas el que mire por que fallo un reporte.
    """
    if verificacion_tls():
        logging.getLogger("glpi").info("Certificado de GLPI: validado")
    else:
        logging.getLogger("glpi").warning(
            "Certificado de GLPI SIN validar. Por esa conexion viajan los tokens "
            "de GLPI. Cargar GLPI_CA_BUNDLE en el .env cuando se tenga el .pem "
            "de la CA interna."
        )
from routers import admin
from routers import auth as auth_router
from routers import (
    debug, eflow, ficheros, kanban, notifications, pases, reports,
    soporte, stats, tickets,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from routers.notifications import _initialize_state, _polling_loop
    db.init_db()
    avisar_tls_de_glpi()
    await _initialize_state()
    task = asyncio.create_task(_polling_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await glpi.aclose()


FRONTEND_PORT = os.getenv("FRONTEND_PORT") or "5173"

# Modo desarrollo. Prende el recargado automatico de uvicorn y el CORS hacia el
# servidor de Vite. En el server la variable no existe y las dos cosas quedan
# apagadas solas, que es el punto: nada de esto tiene que depender de acordarse
# de editar el codigo antes de desplegar.
DEV = os.getenv("DEV") == "1"

# Cookie de sesion solo por HTTPS. Va apagado mientras el server termine en HTTP
# puro, porque prendido la cookie no viaja y nadie puede entrar; en cuanto haya
# certificado, COOKIE_HTTPS_ONLY=1 en el .env.
COOKIE_HTTPS_ONLY = os.getenv("COOKIE_HTTPS_ONLY") == "1"

# Endpoints de diagnostico. Prendidos siempre en desarrollo; en el server hay
# que pedirlos a mano y apagarlos despues.
DEBUG_ENDPOINTS = DEV or os.getenv("DEBUG_ENDPOINTS") == "1"

# El frontend compilado (`npm run build`). Si la carpeta existe, este mismo
# proceso la sirve y no hace falta ni nginx ni el servidor de Vite.
DIST = (Path(__file__).resolve().parent.parent / "frontend" / "dist").resolve()

logging_config.configurar()

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "Falta SECRET_KEY en el .env. Generar una con:\n"
        "  python -c \"import secrets; print(secrets.token_hex(32))\""
    )

app = FastAPI(title="Soporte Aplicaciones API", lifespan=lifespan)


# ── Cabeceras de seguridad ────────────────────────────────────────────────────
#
# Instrucciones para el navegador, no para el backend: le dicen que cosas NO
# tiene que dejar hacer con esta pagina. Van en cada respuesta.
#
# El CSP es el que puede romper algo si el frontend cambia. Hoy alcanza porque
# Vite compila el JS a archivos propios y no deja scripts sueltos en el HTML;
# el 'unsafe-inline' de los estilos si hace falta, porque React escribe estilos
# en el atributo style de los elementos. Si algun dia la consola del navegador
# empieza a quejarse de "Refused to load...", es aca.
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self' data:",
    # Nadie puede meter esta app dentro de un iframe. Sin esto, una pagina
    # cualquiera la carga invisible encima de la suya y te hace hacer clic en
    # botones que no ves: es la pantalla de Perfiles la que da permisos.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])


@app.middleware("http")
async def cabeceras_de_seguridad(request, call_next):
    respuesta = await call_next(request)
    respuesta.headers["Content-Security-Policy"] = CSP
    # El navegador respeta el Content-Type que mandamos en vez de adivinarlo
    # mirando el contenido, que es como un .txt subido termina ejecutandose.
    respuesta.headers["X-Content-Type-Options"] = "nosniff"
    # Lo mismo que frame-ancestors, para navegadores viejos que no leen CSP.
    respuesta.headers["X-Frame-Options"] = "DENY"
    # Al salir de la app hacia otro sitio no se filtra la ruta que estabas
    # viendo, que puede llevar el id de un ticket.
    respuesta.headers["Referrer-Policy"] = "same-origin"
    respuesta.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if COOKIE_HTTPS_ONLY:
        # HSTS solo con certificado. Prendido sobre HTTP puro el navegador se
        # guarda que este host es HTTPS y despues no lo podes visitar mas: la
        # cabecera queda cacheada aunque saques la linea.
        respuesta.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return respuesta


app.add_middleware(
    SessionMiddleware,
    secret_key=SECRET_KEY,
    session_cookie="dashboard_session",
    # 8 horas: una jornada. No es un tope absoluto sino inactividad, porque el
    # middleware reescribe la cookie en cada respuesta. El default son 14 dias,
    # demasiado para un panel que da de alta usuarios y roles.
    max_age=8 * 60 * 60,
    https_only=COOKIE_HTTPS_ONLY,
    same_site="lax",
)

# CORS solo en desarrollo, donde el frontend vive en otro puerto (Vite en 5173)
# y el navegador lo trata como otro origen. Sirviendo el dist desde este mismo
# proceso el origen es el mismo y el CORS no interviene en nada.
if DEV:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[f"http://localhost:{FRONTEND_PORT}"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Login y logout: unico router accesible sin sesion.
app.include_router(auth_router.router)

# Accesible a todos los roles. tickets y notifications filtran por usuario
# adentro del endpoint: quien no es jefe ve solo lo suyo.
todos = [Depends(usuario_actual)]
app.include_router(tickets.router, dependencies=todos)
app.include_router(notifications.router, dependencies=todos)

# De aca en mas, quien entra a cada seccion sale de la tabla de permisos y no
# de una lista de roles escrita aca: es lo que configura la pantalla de Perfiles
# (Usuarios y permisos). Los ids son los de db.SECCIONES.
app.include_router(pases.router, dependencies=[Depends(requiere_seccion("pases"))])

# Ficheros y eflow declaran sus propios permisos por endpoint (necesitan saber
# quien hace cada cambio para la auditoria).
app.include_router(ficheros.router)
app.include_router(eflow.router)

# Tableros de tareas: cada endpoint resuelve sus permisos contra el tablero al
# que pertenece la columna o la tarjeta, no contra lo que mande el frontend.
app.include_router(kanban.router)

# Metricas del equipo, cierres por dia y reportes.
#
# "Tickets por tecnico" no aparece: esa pantalla se sirve de /api/tickets/open,
# que ya filtra por su cuenta (quien no es jefe ve solo los suyos). El permiso
# de esa seccion decide si la pantalla esta o no en el menu; el dato que
# devuelve el backend es el mismo control de siempre.
app.include_router(stats.router, dependencies=[Depends(requiere_seccion("stats"))])
app.include_router(soporte.router, dependencies=[Depends(requiere_seccion("soporte_dia"))])

# Reportes lleva ademas un tope de llamadas. Cada uno dispara decenas de
# consultas contra GLPI, que es de toda la muni y no solo de esta app. Treinta
# por minuto es holgadisimo para una persona -pedir el reporte, bajarlo en PDF y
# en Excel son tres- y corta un bucle antes de que se note del otro lado.
app.include_router(
    reports.router,
    dependencies=[
        Depends(requiere_seccion("reportes")),
        Depends(limite("reportes", maximo=30, ventana=60)),
    ],
)

# Administracion: exige rol jefe (dependencia en el propio router).
app.include_router(admin.router)

# Diagnostico: ademas de exigir rol jefe, en produccion no se monta.
#
# El router esta bien cerrado, asi que esto no tapa ningun agujero: es sacar
# superficie que no hace falta. Devuelve configuracion interna -el chat del
# jefe, el mapa de tecnicos- y datos crudos de GLPI, y no hay ninguna razon
# para tener eso publicado todo el tiempo cuando se usa una vez cada tanto.
#
# Para diagnosticar en el server: DEBUG_ENDPOINTS=1 en el .env, reiniciar el
# servicio, mirar lo que haga falta, sacarlo y volver a reiniciar.
if DEBUG_ENDPOINTS:
    app.include_router(debug.router)


@app.get("/api/health")
async def health():
    """Healthcheck: sin autenticacion a proposito, para poder monitorear el servicio."""
    return {"status": "ok"}


# ── Frontend compilado ────────────────────────────────────────────────────────
#
# Va al final del archivo a proposito: el catch-all se queda con todo lo que no
# haya reconocido un router, asi que tiene que declararse despues de todos.
#
# En desarrollo la carpeta no existe (se usa `npm run dev`) y este bloque no se
# arma: el proxy de /api lo hace Vite, como siempre.
if DIST.is_dir():

    @app.get("/{ruta:path}", include_in_schema=False)
    async def frontend(ruta: str):
        """Devuelve el archivo pedido si existe, y si no el index.

        Cualquier ruta desconocida contesta index.html porque el ruteo lo hace
        React en el navegador: entrar directo a /kanban tiene que abrir la app y
        no un 404.

        Las que arrancan con api/ son la excepcion. Llegar hasta aca significa
        que ningun router las reconocio, y devolverles el index seria contestar
        una pagina HTML a alguien que pidio JSON: el error aparece despues,
        lejos, como un parseo fallido en el navegador.
        """
        if ruta.startswith("api/"):
            raise HTTPException(status_code=404, detail="No existe ese endpoint.")

        archivo = (DIST / ruta).resolve()
        # Un `..` en la ruta pedida no puede sacar el archivo de dist: sin este
        # control, /../../.env seria un archivo servible.
        dentro_de_dist = archivo == DIST or DIST in archivo.parents
        if ruta and dentro_de_dist and archivo.is_file():
            return FileResponse(archivo)
        return FileResponse(DIST / "index.html")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("BACKEND_PORT") or "8000")
    # Un solo worker, no negociable: _polling_loop arranca en el lifespan y con
    # N workers manda cada aviso de Telegram N veces.
    uvicorn.run("main:app", host="0.0.0.0", reload=DEV, port=port, workers=1)
