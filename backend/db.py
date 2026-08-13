import logging
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv

# El .env se carga aca y no se da por cargado: main.py importa este modulo antes
# que glpi_client, que es el otro que lo lee. Sin esto DB_PATH se resolveria con
# el entorno todavia vacio y caeria siempre en la ruta por defecto, en silencio.
# load_dotenv no pisa lo que ya este definido, asi que llamarlo dos veces no
# molesta.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Donde vive la base. Por defecto en la raiz del proyecto, que es lo comodo en
# la maquina de uno. En el server conviene sacarla afuera del repo con DB_PATH
# en el .env: los datos quedan separados del codigo y ningun despliegue puede
# pisarlos por accidente.
DB_PATH = Path(os.getenv("DB_PATH") or (Path(__file__).resolve().parent.parent / "dashboard.db"))

# Si la carpeta no existe, sqlite3 falla con "unable to open database file", que
# no dice cual es el problema ni donde estaba buscando. Mejor cortar aca y
# decirlo. Solo aplica a la ruta configurada: la de por defecto siempre existe.
if not DB_PATH.parent.is_dir():
    raise RuntimeError(
        f"DB_PATH apunta a una carpeta que no existe: {DB_PATH.parent}\n"
        f"Crearla antes de arrancar, o corregir DB_PATH en el .env."
    )

ROL_JEFE = "jefe"
ROL_TECNICO = "tecnico"
ROL_PASANTE = "pasante"

ROLES = (ROL_JEFE, ROL_TECNICO, ROL_PASANTE)

# Secciones del sistema, en el orden en que aparecen en la barra lateral. El id
# es el mismo que usan PAGINAS en rutas.js y LINKS en Sidebar.jsx: si backend y
# pantalla no llamaran igual a lo mismo, habria que mantener una traduccion.
SECCIONES = (
    ("inicio",          "Inicio"),
    ("home",            "Novedades"),
    ("tickets",         "Tickets abiertos"),
    ("kanban",          "Tareas"),
    ("pases",           "Pases a produccion"),
    ("stats",           "Historico"),
    ("soporte_tecnico", "Tickets por tecnico"),
    ("soporte_dia",     "Cerrados por dia"),
    ("reportes",        "Reportes"),
    ("usuarios",        "Usuarios y permisos"),
    ("ficheros",        "Ficheros"),
    ("eflow",           "EFLOW"),
    ("generar_link",    "Generar link"),
)

IDS_SECCIONES = tuple(s for s, _ in SECCIONES)

# Con que permisos arranca cada rol: son exactamente los que estaban escritos a
# mano en rutas.js y en las dependencias de main.py antes de que esto fuera
# configurable. La semilla corre una sola vez; de ahi en mas manda la base.
PERMISOS_INICIALES = {
    ROL_JEFE: list(IDS_SECCIONES),
    ROL_TECNICO: ["inicio", "home", "tickets", "kanban", "pases",
                  "ficheros", "eflow", "generar_link"],
    ROL_PASANTE: ["inicio", "home", "tickets", "kanban", "generar_link"],
}

# El jefe no puede quedarse sin esta seccion: es desde donde se administran los
# permisos. Si se pudiera desmarcar, el primero que lo haga deja al sistema sin
# nadie que pueda volver a darselos a alguien.
SECCION_ADMIN = "usuarios"

# Roles que reciben avisos por Telegram. El pasante solo ve las
# notificaciones dentro del dashboard.
ROLES_CON_TELEGRAM = (ROL_JEFE, ROL_TECNICO)

# Acciones que se registran en la auditoria. Son constantes y no textos sueltos
# escritos en cada llamada porque el dia que haya que buscar "todos los cambios
# de rol", un "cambio_rol" mal tipeado en un solo lugar es un hecho que no
# aparece en la busqueda y nadie se entera de que falta.
AUD_LOGIN = "login"
AUD_LOGIN_FALLIDO = "login_fallido"
AUD_CAMBIO_ROL = "cambio_rol"
AUD_CAMBIO_PERMISOS = "cambio_permisos"
AUD_HABILITADO = "habilitado"
AUD_DESHABILITADO = "deshabilitado"
AUD_CAMBIO_TELEGRAM = "cambio_telegram"

# Etiquetas para mostrar en pantalla. Van con el catalogo y no en el frontend por
# lo mismo que las secciones: sumar una accion no tiene que obligar a tocar dos
# lugares.
AUD_ETIQUETAS = {
    AUD_LOGIN: "Ingreso",
    AUD_LOGIN_FALLIDO: "Ingreso fallido",
    AUD_CAMBIO_ROL: "Cambio de rol",
    AUD_CAMBIO_PERMISOS: "Cambio de permisos",
    AUD_HABILITADO: "Habilitacion",
    AUD_DESHABILITADO: "Deshabilitacion",
    AUD_CAMBIO_TELEGRAM: "Cambio de Telegram",
}

# Cuanto se guarda la auditoria. Un año: es larga a proposito, porque el valor de
# un registro de auditoria aparece justamente cuando alguien pregunta por algo
# que paso hace meses. Son unos pocos renglones por dia.
AUDITORIA_DIAS = 365

# Tableros de tareas. El del grupo es uno solo y lo comparte el area; el
# personal es de cada uno y se crea la primera vez que entra.
KANBAN_GRUPO = "grupo"
KANBAN_PERSONAL = "personal"
KANBAN_TIPOS = (KANBAN_GRUPO, KANBAN_PERSONAL)

# Con que columnas arranca un tablero nuevo. Despues cada uno las renombra o
# suma las que necesite.
COLUMNAS_INICIALES = ("Sin comenzar", "En proceso", "En espera")


# Cuanto espera una conexion a que se libere la base antes de darse por vencida.
# Con WAL las esperas son cortas, pero el polling escribe cada 30 segundos y sin
# esto una operacion que cae justo encima falla al instante en vez de esperar.
DB_TIMEOUT = 30.0


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    """Conexion a la base, con la transaccion y el cierre resueltos.

    El `with` de sqlite3 maneja la *transaccion* (hace commit o rollback), pero
    no cierra la conexion. Sin este envoltorio, cada llamada dejaba una abierta
    esperando al recolector de basura: en una maquina de escritorio no se nota,
    corriendo como servicio durante semanas se acumula.

    WAL permite leer mientras se escribe. En el modo por defecto un escritor
    bloquea a los lectores, y esta app tiene un escritor permanente -el polling
    de notificaciones- mientras la gente lee; el sintoma era un "database is
    locked" intermitente e imposible de reproducir. El modo queda guardado en el
    archivo, pero se pide en cada conexion porque es idempotente y asi tambien
    vale para una base recien creada.

    Las foreign keys van prendidas para que los ON DELETE CASCADE declarados en
    las tablas del kanban se cumplan de verdad: SQLite las ignora salvo que se
    pidan, y son por conexion, no del archivo. Como todas las conexiones de la
    app salen de aca, prendiendolas en este punto la garantia vale siempre y
    ningun borrado nuevo tiene que acordarse de limpiar a mano.

    Los llamadores no cambian: se sigue usando `with get_conn() as conn:`.
    """
    conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT)
    conn.row_factory = sqlite3.Row
    try:
        # Antes de abrir la transaccion a proposito: SQLite no admite cambiar de
        # modo con una en curso.
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        with conn:
            yield conn
    finally:
        conn.close()


def init_db():
    """Crea las tablas si no existen. Idempotente: se puede llamar en cada arranque."""
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS usuarios (
                glpi_user_id  INTEGER PRIMARY KEY,
                username      TEXT,
                nombre        TEXT,
                rol           TEXT    NOT NULL DEFAULT 'tecnico',
                habilitado    INTEGER NOT NULL DEFAULT 1,
                primer_acceso TEXT,
                ultimo_acceso TEXT
            )
        """)
        # Un renglon por (destinatario, evento): el mismo ticket genera una
        # notificacion para el jefe y otra para el tecnico asignado.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notificaciones (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                destinatario INTEGER NOT NULL,
                tipo         TEXT    NOT NULL,
                evento_id    INTEGER NOT NULL,
                payload      TEXT    NOT NULL,
                entregada    INTEGER NOT NULL DEFAULT 0,
                creada       TEXT    NOT NULL,
                UNIQUE (destinatario, tipo, evento_id)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_notif_pendientes
            ON notificaciones (destinatario, entregada)
        """)
        # Reemplaza al JSON de la unidad de red: ademas de evitar que dos
        # personas se pisen al guardar, queda registrado quien toco cada cosa.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ficheros (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre         TEXT NOT NULL,
                ip             TEXT,
                creado         TEXT,
                creado_por     INTEGER,
                modificado     TEXT,
                modificado_por INTEGER
            )
        """)
        # Totems y nodos comparten los mismos campos, asi que van en una sola
        # tabla con una columna que los distingue.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS eflow_equipos (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo           TEXT NOT NULL,
                nombre         TEXT NOT NULL,
                nro_pc         TEXT,
                creado         TEXT,
                creado_por     INTEGER,
                modificado     TEXT,
                modificado_por INTEGER
            )
        """)

        # Tablero de tareas propias del area (no son tickets de GLPI). Hay uno
        # del grupo, que ven todos, y uno personal por persona, que es privado.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS kanban_tableros (
                id     INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo   TEXT NOT NULL,
                dueno  INTEGER,
                creado TEXT,
                UNIQUE (tipo, dueno)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS kanban_columnas (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                tablero_id INTEGER NOT NULL,
                nombre     TEXT    NOT NULL,
                orden      INTEGER NOT NULL,
                FOREIGN KEY (tablero_id) REFERENCES kanban_tableros(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS kanban_tarjetas (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                columna_id   INTEGER NOT NULL,
                titulo       TEXT    NOT NULL,
                detalle      TEXT,
                responsable  INTEGER,
                orden        INTEGER NOT NULL,
                creada       TEXT,
                creada_por   INTEGER,
                modificada   TEXT,
                modificada_por INTEGER,
                FOREIGN KEY (columna_id) REFERENCES kanban_columnas(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_kanban_tarjetas_columna
            ON kanban_tarjetas (columna_id, orden)
        """)

        # Que ve cada rol. Un renglon por permiso concedido: lo que no esta en
        # la tabla, no se ve. Antes esto vivia partido en dos lugares del
        # codigo (PAGINAS en rutas.js y las dependencias de main.py), asi que
        # cambiar un permiso obligaba a tocar el fuente y reiniciar.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS permisos (
                rol     TEXT NOT NULL,
                seccion TEXT NOT NULL,
                PRIMARY KEY (rol, seccion)
            )
        """)

        # Quien hizo que y cuando. Es la unica tabla del sistema que solo se
        # escribe y se lee: no hay nada en la app que modifique ni borre un
        # renglon de aca (la purga por antiguedad es lo unico, y es automatica).
        #
        # Los nombres van copiados y no resueltos con un JOIN contra usuarios a
        # proposito. Un renglon de auditoria es la foto de un momento: si a
        # alguien lo sacan del grupo y su fila desaparece, el registro tiene que
        # seguir diciendo quien fue. Con un JOIN, el dia que mas falta hace,
        # aparece un id sin nombre o directamente nada.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS auditoria (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                cuando        TEXT NOT NULL,
                actor         INTEGER,
                actor_nombre  TEXT,
                accion        TEXT NOT NULL,
                objeto_tipo   TEXT,
                objeto_id     TEXT,
                objeto_nombre TEXT,
                detalle       TEXT
            )
        """)
        # La consulta que se hace siempre es "lo ultimo primero".
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_auditoria_cuando
            ON auditoria (cuando DESC)
        """)

        _migrar_telegram(conn)
        _migrar_kanban(conn)
        _sembrar_permisos(conn)


def _sembrar_permisos(conn):
    """Carga los permisos que estaban escritos en el codigo, una sola vez.

    Se siembra solo si la tabla esta vacia: la idea es que al actualizar, la app
    siga viendose igual que antes, y que a partir de ahi mande lo que el jefe
    configure. Si alguien deja a un rol sin ninguna seccion, eso es una
    configuracion valida y no se vuelve a sembrar.
    """
    if conn.execute("SELECT 1 FROM permisos LIMIT 1").fetchone():
        return
    for rol, secciones in PERMISOS_INICIALES.items():
        conn.executemany(
            "INSERT OR IGNORE INTO permisos (rol, seccion) VALUES (?, ?)",
            [(rol, s) for s in secciones],
        )


def _migrar_kanban(conn):
    """Agrega 'responsable' a las tarjetas si la tabla es de antes que existiera.

    Va aparte del CREATE TABLE porque ese solo corre en instalaciones nuevas:
    donde el tablero ya se venia usando, la tabla existe sin la columna.
    """
    columnas = {f["name"] for f in conn.execute("PRAGMA table_info(kanban_tarjetas)")}
    if "responsable" not in columnas:
        conn.execute("ALTER TABLE kanban_tarjetas ADD COLUMN responsable INTEGER")


def _migrar_telegram(conn):
    """Agrega a 'usuarios' las columnas de Telegram y trae lo que estaba en el .env.

    El chat de Telegram es un dato de cada persona, asi que vive con el usuario y
    no en variables de entorno: cambiarlo ya no obliga a editar el .env ni a
    reiniciar el backend. SQLite no tiene ADD COLUMN IF NOT EXISTS, de ahi que
    haya que preguntarle primero que columnas tiene la tabla.
    """
    columnas = {f["name"] for f in conn.execute("PRAGMA table_info(usuarios)")}
    if "telegram_chat_id" in columnas:
        return

    conn.execute("ALTER TABLE usuarios ADD COLUMN telegram_chat_id TEXT")
    # Sirve para cortarle los avisos a alguien (vacaciones, licencia) sin perder
    # su chat_id, que despues hay que volver a conseguir.
    conn.execute("ALTER TABLE usuarios ADD COLUMN telegram_activo INTEGER NOT NULL DEFAULT 1")

    # Semilla: se corre una sola vez, justo cuando se crean las columnas, para
    # arrancar con los mismos destinatarios que ya venian funcionando. De aca en
    # mas manda la base y estas variables del .env quedan sin uso.
    for pareja in os.getenv("TELEGRAM_TECH_IDS", "").split(","):
        uid, _, chat_id = pareja.strip().partition(":")
        if uid.strip() and chat_id.strip():
            conn.execute(
                "UPDATE usuarios SET telegram_chat_id = ? WHERE glpi_user_id = ?",
                (chat_id.strip(), uid.strip()),
            )

    # El chat del jefe no tenia dueño: era un unico ID suelto. Se le asigna al
    # jefe que no tenga chat propio, que es de quien era en los hechos.
    jefe_chat = os.getenv("TELEGRAM_BOSS_CHAT_ID", "").strip()
    if jefe_chat:
        conn.execute(
            """
            UPDATE usuarios SET telegram_chat_id = ?
            WHERE rol = ? AND (telegram_chat_id IS NULL OR telegram_chat_id = '')
            """,
            (jefe_chat, ROL_JEFE),
        )


def get_usuario(glpi_user_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM usuarios WHERE glpi_user_id = ?", (glpi_user_id,)
        ).fetchone()
    return dict(row) if row else None


def listar_usuarios() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM usuarios ORDER BY rol, nombre"
        ).fetchall()
    return [dict(r) for r in rows]


def registrar_acceso(glpi_user_id: int, username: str, nombre: str, rol_inicial: str) -> dict:
    """Crea el usuario si es su primer ingreso y actualiza ultimo_acceso.

    rol_inicial solo se aplica al crear: si el usuario ya existe, su rol no se toca
    (para no pisar lo que el jefe haya configurado desde el menu de permisos).
    """
    ahora = datetime.now().isoformat(timespec="seconds")
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO usuarios (glpi_user_id, username, nombre, rol, primer_acceso, ultimo_acceso)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(glpi_user_id) DO UPDATE SET
                username      = excluded.username,
                nombre        = excluded.nombre,
                ultimo_acceso = excluded.ultimo_acceso
        """, (glpi_user_id, username, nombre, rol_inicial, ahora, ahora))
    return get_usuario(glpi_user_id)


# ── Ficheros ──────────────────────────────────────────────────────────────────

def listar_ficheros() -> list[dict]:
    with get_conn() as conn:
        filas = conn.execute("""
            SELECT f.*,
                   uc.nombre AS creado_por_nombre,
                   um.nombre AS modificado_por_nombre
            FROM ficheros f
            LEFT JOIN usuarios uc ON uc.glpi_user_id = f.creado_por
            LEFT JOIN usuarios um ON um.glpi_user_id = f.modificado_por
            ORDER BY f.nombre COLLATE NOCASE
        """).fetchall()
    return [dict(f) for f in filas]


def get_fichero(fichero_id: int) -> dict | None:
    with get_conn() as conn:
        fila = conn.execute("SELECT * FROM ficheros WHERE id = ?", (fichero_id,)).fetchone()
    return dict(fila) if fila else None


def crear_fichero(nombre: str, ip: str | None, usuario_id: int) -> dict:
    ahora = datetime.now().isoformat(timespec="seconds")
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO ficheros (nombre, ip, creado, creado_por, modificado, modificado_por)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (nombre, ip, ahora, usuario_id, ahora, usuario_id),
        )
        nuevo_id = cur.lastrowid
    return get_fichero(nuevo_id)


def actualizar_fichero(fichero_id: int, nombre: str, ip: str | None, usuario_id: int) -> dict | None:
    ahora = datetime.now().isoformat(timespec="seconds")
    with get_conn() as conn:
        conn.execute(
            "UPDATE ficheros SET nombre = ?, ip = ?, modificado = ?, modificado_por = ? WHERE id = ?",
            (nombre, ip, ahora, usuario_id, fichero_id),
        )
    return get_fichero(fichero_id)


def borrar_fichero(fichero_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM ficheros WHERE id = ?", (fichero_id,))
        return cur.rowcount > 0


# ── EFLOW: totems y nodos ─────────────────────────────────────────────────────

TIPO_TOTEM = "totem"
TIPO_NODO = "nodo"
TIPOS_EFLOW = (TIPO_TOTEM, TIPO_NODO)


def listar_eflow(tipo: str | None = None) -> list[dict]:
    sql = """
        SELECT e.*,
               uc.nombre AS creado_por_nombre,
               um.nombre AS modificado_por_nombre
        FROM eflow_equipos e
        LEFT JOIN usuarios uc ON uc.glpi_user_id = e.creado_por
        LEFT JOIN usuarios um ON um.glpi_user_id = e.modificado_por
    """
    params: tuple = ()
    if tipo:
        sql += " WHERE e.tipo = ?"
        params = (tipo,)
    sql += " ORDER BY e.tipo, e.nombre COLLATE NOCASE"
    with get_conn() as conn:
        return [dict(f) for f in conn.execute(sql, params).fetchall()]


def get_eflow(equipo_id: int) -> dict | None:
    with get_conn() as conn:
        fila = conn.execute("SELECT * FROM eflow_equipos WHERE id = ?", (equipo_id,)).fetchone()
    return dict(fila) if fila else None


def crear_eflow(tipo: str, nombre: str, nro_pc: str | None, usuario_id: int) -> dict:
    ahora = datetime.now().isoformat(timespec="seconds")
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO eflow_equipos
                (tipo, nombre, nro_pc, creado, creado_por, modificado, modificado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (tipo, nombre, nro_pc, ahora, usuario_id, ahora, usuario_id),
        )
        nuevo_id = cur.lastrowid
    return get_eflow(nuevo_id)


def actualizar_eflow(equipo_id: int, nombre: str, nro_pc: str | None, usuario_id: int) -> dict | None:
    ahora = datetime.now().isoformat(timespec="seconds")
    with get_conn() as conn:
        conn.execute(
            "UPDATE eflow_equipos SET nombre = ?, nro_pc = ?, modificado = ?, modificado_por = ? WHERE id = ?",
            (nombre, nro_pc, ahora, usuario_id, equipo_id),
        )
    return get_eflow(equipo_id)


def borrar_eflow(equipo_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM eflow_equipos WHERE id = ?", (equipo_id,))
        return cur.rowcount > 0


# ── Usuarios y notificaciones ─────────────────────────────────────────────────

def ids_por_rol(*roles: str) -> list[int]:
    """IDs de los usuarios habilitados con alguno de esos roles."""
    marcadores = ",".join("?" * len(roles))
    with get_conn() as conn:
        filas = conn.execute(
            f"SELECT glpi_user_id FROM usuarios WHERE habilitado = 1 AND rol IN ({marcadores})",
            roles,
        ).fetchall()
    return [f[0] for f in filas]


def guardar_notificacion(destinatario: int, tipo: str, evento_id: int, payload: str):
    """Encola una notificacion para un usuario.

    El UNIQUE de la tabla hace que reintentos del polling no generen duplicados.
    """
    with get_conn() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO notificaciones
                (destinatario, tipo, evento_id, payload, creada)
            VALUES (?, ?, ?, ?, ?)
            """,
            (destinatario, tipo, evento_id, payload, datetime.now().isoformat(timespec="seconds")),
        )


def tomar_notificaciones(destinatario: int) -> list[dict]:
    """Devuelve las notificaciones sin entregar de un usuario y las marca entregadas.

    A diferencia del buzon compartido anterior, lo que consume un usuario no
    afecta a los demas: cada uno tiene sus propios renglones.
    """
    with get_conn() as conn:
        filas = conn.execute(
            """
            SELECT id, tipo, evento_id, payload, creada
            FROM notificaciones
            WHERE destinatario = ? AND entregada = 0
            ORDER BY id
            """,
            (destinatario,),
        ).fetchall()
        if filas:
            conn.execute(
                "UPDATE notificaciones SET entregada = 1 WHERE destinatario = ? AND entregada = 0",
                (destinatario,),
            )
    return [dict(f) for f in filas]


def limpiar_notificaciones(dias: int = 30) -> int:
    """Borra notificaciones entregadas mas viejas que N dias."""
    limite = (datetime.now() - timedelta(days=dias)).isoformat(timespec="seconds")
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM notificaciones WHERE entregada = 1 AND creada < ?", (limite,)
        )
        return cur.rowcount


def contar_jefes(excluyendo: int | None = None) -> int:
    """Cuantos jefes habilitados hay. Sirve para no quedarse sin administrador."""
    sql = "SELECT COUNT(*) FROM usuarios WHERE rol = ? AND habilitado = 1"
    params: list = [ROL_JEFE]
    if excluyendo is not None:
        sql += " AND glpi_user_id != ?"
        params.append(excluyendo)
    with get_conn() as conn:
        return conn.execute(sql, params).fetchone()[0]


def set_rol(glpi_user_id: int, rol: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE usuarios SET rol = ? WHERE glpi_user_id = ?", (rol, glpi_user_id)
        )


# ── Permisos por rol ──────────────────────────────────────────────────────────

def permisos_por_rol() -> dict[str, list[str]]:
    """Que secciones ve cada rol, con los tres roles siempre presentes.

    Un rol sin ninguna fila en la tabla existe igual y devuelve la lista vacia:
    "no ve nada" es una configuracion posible y no un dato faltante.
    """
    permisos: dict[str, list[str]] = {rol: [] for rol in ROLES}
    with get_conn() as conn:
        for row in conn.execute("SELECT rol, seccion FROM permisos"):
            if row["rol"] in permisos and row["seccion"] in IDS_SECCIONES:
                permisos[row["rol"]].append(row["seccion"])
    # En el orden del catalogo y no en el que los devolvio la base, para que la
    # pantalla de perfiles no cambie el orden de las filas entre visitas.
    return {
        rol: [s for s in IDS_SECCIONES if s in secciones]
        for rol, secciones in permisos.items()
    }


def secciones_de(rol: str) -> set[str]:
    """Secciones que puede ver un rol. Es lo que consulta el control de acceso."""
    with get_conn() as conn:
        filas = conn.execute("SELECT seccion FROM permisos WHERE rol = ?", (rol,))
        return {f["seccion"] for f in filas}


def set_permisos(rol: str, secciones: list[str]) -> list[str]:
    """Reemplaza los permisos de un rol. Devuelve como quedaron.

    Se ignora cualquier seccion que no exista en el catalogo, asi un id viejo o
    escrito a mano no queda guardado. Al jefe se le vuelve a poner Usuarios
    aunque no venga: ver SECCION_ADMIN.
    """
    limpias = [s for s in dict.fromkeys(secciones) if s in IDS_SECCIONES]
    if rol == ROL_JEFE and SECCION_ADMIN not in limpias:
        limpias.append(SECCION_ADMIN)

    with get_conn() as conn:
        conn.execute("DELETE FROM permisos WHERE rol = ?", (rol,))
        conn.executemany(
            "INSERT INTO permisos (rol, seccion) VALUES (?, ?)",
            [(rol, s) for s in limpias],
        )
    return [s for s in IDS_SECCIONES if s in limpias]


def set_habilitado(glpi_user_id: int, habilitado: bool):
    with get_conn() as conn:
        conn.execute(
            "UPDATE usuarios SET habilitado = ? WHERE glpi_user_id = ?",
            (1 if habilitado else 0, glpi_user_id),
        )


def set_telegram(glpi_user_id: int, chat_id: str | None, activo: bool):
    """Guarda el chat de Telegram de un usuario. chat_id vacio = sin configurar."""
    chat_id = (chat_id or "").strip() or None
    with get_conn() as conn:
        conn.execute(
            "UPDATE usuarios SET telegram_chat_id = ?, telegram_activo = ? WHERE glpi_user_id = ?",
            (chat_id, 1 if activo else 0, glpi_user_id),
        )


def chats_telegram(*roles: str) -> list[str]:
    """Chats a los que hay que avisar, de los usuarios habilitados con esos roles.

    Filtra por habilitado y por telegram_activo: alguien deshabilitado o de
    licencia no recibe, aunque tenga el chat cargado.
    """
    marcadores = ",".join("?" * len(roles))
    with get_conn() as conn:
        filas = conn.execute(
            f"""
            SELECT telegram_chat_id FROM usuarios
            WHERE habilitado = 1
              AND telegram_activo = 1
              AND telegram_chat_id IS NOT NULL
              AND telegram_chat_id != ''
              AND rol IN ({marcadores})
            """,
            roles,
        ).fetchall()
    return [f[0] for f in filas]


def chat_telegram_de(glpi_user_id: int) -> str | None:
    """Chat de un usuario puntual, si esta en condiciones de recibir avisos.

    Devuelve None si no ingreso nunca, esta deshabilitado, tiene los avisos en
    pausa, o su rol no recibe Telegram (el pasante solo ve el dashboard).
    """
    usuario = get_usuario(glpi_user_id)
    if not usuario or not usuario["habilitado"]:
        return None
    if usuario["rol"] not in ROLES_CON_TELEGRAM:
        return None
    if not usuario["telegram_activo"]:
        return None
    return (usuario["telegram_chat_id"] or "").strip() or None


# ── Tableros de tareas (kanban) ───────────────────────────────────────────────
#
# Son tareas propias del area, no tickets de GLPI: viven solo aca y no se le
# escribe nada a GLPI. El orden de columnas y tarjetas se guarda como un entero
# por fila y se renumera de cero en cada movimiento, que para tableros de esta
# escala es mas simple y predecible que dejar huecos entre valores.


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def obtener_o_crear_tablero(tipo: str, dueno: int | None = None) -> int:
    """ID del tablero, creandolo con sus columnas iniciales la primera vez.

    Asi nadie tiene que preparar nada: el tablero del grupo aparece cuando
    alguien entra por primera vez, y el personal cuando entra su dueño.
    """
    with get_conn() as conn:
        if dueno is None:
            fila = conn.execute(
                "SELECT id FROM kanban_tableros WHERE tipo = ? AND dueno IS NULL", (tipo,)
            ).fetchone()
        else:
            fila = conn.execute(
                "SELECT id FROM kanban_tableros WHERE tipo = ? AND dueno = ?", (tipo, dueno)
            ).fetchone()
        if fila:
            return fila["id"]

        cur = conn.execute(
            "INSERT INTO kanban_tableros (tipo, dueno, creado) VALUES (?, ?, ?)",
            (tipo, dueno, _ahora()),
        )
        tablero_id = cur.lastrowid
        for i, nombre in enumerate(COLUMNAS_INICIALES):
            conn.execute(
                "INSERT INTO kanban_columnas (tablero_id, nombre, orden) VALUES (?, ?, ?)",
                (tablero_id, nombre, i),
            )
        return tablero_id


def kanban_tablero(tablero_id: int) -> list[dict]:
    """Columnas del tablero, cada una con sus tarjetas, listo para la pantalla."""
    with get_conn() as conn:
        columnas = conn.execute(
            "SELECT id, nombre, orden FROM kanban_columnas WHERE tablero_id = ? ORDER BY orden, id",
            (tablero_id,),
        ).fetchall()

        tarjetas = conn.execute(
            """
            SELECT t.id, t.columna_id, t.titulo, t.detalle, t.orden,
                   t.creada, t.creada_por, t.modificada, t.modificada_por,
                   t.responsable,
                   u.nombre AS creada_por_nombre,
                   r.nombre AS responsable_nombre
            FROM kanban_tarjetas t
            LEFT JOIN kanban_columnas c ON c.id = t.columna_id
            LEFT JOIN usuarios u ON u.glpi_user_id = t.creada_por
            LEFT JOIN usuarios r ON r.glpi_user_id = t.responsable
            WHERE c.tablero_id = ?
            ORDER BY t.orden, t.id
            """,
            (tablero_id,),
        ).fetchall()

    por_columna: dict[int, list] = {}
    for t in tarjetas:
        por_columna.setdefault(t["columna_id"], []).append(dict(t))

    return [{**dict(c), "tarjetas": por_columna.get(c["id"], [])} for c in columnas]


def get_tablero(tablero_id: int) -> dict | None:
    """El tablero por su id, con tipo y dueño: es lo que mira el control de permisos."""
    with get_conn() as conn:
        fila = conn.execute(
            "SELECT id, tipo, dueno FROM kanban_tableros WHERE id = ?", (tablero_id,)
        ).fetchone()
    return dict(fila) if fila else None


def tablero_de_columna(columna_id: int) -> dict | None:
    """Tablero al que pertenece una columna. Lo usa el control de permisos."""
    with get_conn() as conn:
        fila = conn.execute(
            """
            SELECT b.id, b.tipo, b.dueno
            FROM kanban_columnas c
            JOIN kanban_tableros b ON b.id = c.tablero_id
            WHERE c.id = ?
            """,
            (columna_id,),
        ).fetchone()
    return dict(fila) if fila else None


def tablero_de_tarjeta(tarjeta_id: int) -> dict | None:
    with get_conn() as conn:
        fila = conn.execute(
            """
            SELECT b.id, b.tipo, b.dueno
            FROM kanban_tarjetas t
            JOIN kanban_columnas c ON c.id = t.columna_id
            JOIN kanban_tableros b ON b.id = c.tablero_id
            WHERE t.id = ?
            """,
            (tarjeta_id,),
        ).fetchone()
    return dict(fila) if fila else None


def crear_columna(tablero_id: int, nombre: str) -> int:
    with get_conn() as conn:
        siguiente = conn.execute(
            "SELECT COALESCE(MAX(orden) + 1, 0) FROM kanban_columnas WHERE tablero_id = ?",
            (tablero_id,),
        ).fetchone()[0]
        cur = conn.execute(
            "INSERT INTO kanban_columnas (tablero_id, nombre, orden) VALUES (?, ?, ?)",
            (tablero_id, nombre, siguiente),
        )
        return cur.lastrowid


def renombrar_columna(columna_id: int, nombre: str):
    with get_conn() as conn:
        conn.execute("UPDATE kanban_columnas SET nombre = ? WHERE id = ?", (nombre, columna_id))


def borrar_columna(columna_id: int):
    """Borra la columna y sus tarjetas.

    Desde que get_conn() prende `PRAGMA foreign_keys=ON`, el CASCADE se llevaria
    las tarjetas solo y el primer DELETE de aca sobra. Se deja igual: no cuesta
    nada, deja a la vista lo que pasa, y si alguna vez alguien abriera una
    conexion sin el PRAGMA esto sigue haciendo lo correcto.

    El comentario de abajo es el motivo original de escribirlo a mano:
    respeta las claves foraneas si se activa PRAGMA foreign_keys en cada
    conexion, y aca conviene no depender de eso.
    """
    with get_conn() as conn:
        conn.execute("DELETE FROM kanban_tarjetas WHERE columna_id = ?", (columna_id,))
        conn.execute("DELETE FROM kanban_columnas WHERE id = ?", (columna_id,))


def contar_columnas(tablero_id: int) -> int:
    with get_conn() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM kanban_columnas WHERE tablero_id = ?", (tablero_id,)
        ).fetchone()[0]


def crear_tarjeta(
    columna_id: int,
    titulo: str,
    detalle: str | None,
    autor: int,
    responsable: int | None = None,
) -> int:
    ahora = _ahora()
    with get_conn() as conn:
        siguiente = conn.execute(
            "SELECT COALESCE(MAX(orden) + 1, 0) FROM kanban_tarjetas WHERE columna_id = ?",
            (columna_id,),
        ).fetchone()[0]
        cur = conn.execute(
            """
            INSERT INTO kanban_tarjetas
                (columna_id, titulo, detalle, responsable, orden,
                 creada, creada_por, modificada, modificada_por)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (columna_id, titulo, detalle, responsable, siguiente, ahora, autor, ahora, autor),
        )
        return cur.lastrowid


def editar_tarjeta(
    tarjeta_id: int,
    titulo: str,
    detalle: str | None,
    autor: int,
    responsable: int | None = None,
):
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE kanban_tarjetas
            SET titulo = ?, detalle = ?, responsable = ?, modificada = ?, modificada_por = ?
            WHERE id = ?
            """,
            (titulo, detalle, responsable, _ahora(), autor, tarjeta_id),
        )


def asignar_tarjeta(tarjeta_id: int, responsable: int | None, autor: int):
    """Cambia solo el responsable, sin tocar titulo ni detalle.

    Existe aparte de editar_tarjeta para poder asignar desde el menu de la
    tarjeta: si reusara el update completo, habria que mandarle el titulo y el
    detalle desde el frontend y cualquier edicion en curso de otro se pisaria.
    """
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE kanban_tarjetas
            SET responsable = ?, modificada = ?, modificada_por = ?
            WHERE id = ?
            """,
            (responsable, _ahora(), autor, tarjeta_id),
        )


def usuarios_asignables() -> list[dict]:
    """A quienes se les puede asignar una tarea del tablero del grupo.

    Los mismos que pueden editarlo: el pasante no aparece porque no lo toca.
    """
    with get_conn() as conn:
        filas = conn.execute(
            """
            SELECT glpi_user_id, nombre FROM usuarios
            WHERE habilitado = 1 AND rol IN (?, ?)
            ORDER BY nombre
            """,
            (ROL_JEFE, ROL_TECNICO),
        ).fetchall()
    return [dict(f) for f in filas]


def borrar_tarjeta(tarjeta_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM kanban_tarjetas WHERE id = ?", (tarjeta_id,))


def mover_tarjeta(tarjeta_id: int, columna_destino: int, posicion: int):
    """Mueve una tarjeta a una columna y posicion, y renumera las dos columnas.

    Renumerar de cero deja el orden sin huecos ni empates, que es lo que hace
    que dos personas moviendo tarjetas a la vez no terminen viendo listas
    distintas.
    """
    with get_conn() as conn:
        fila = conn.execute(
            "SELECT columna_id FROM kanban_tarjetas WHERE id = ?", (tarjeta_id,)
        ).fetchone()
        if not fila:
            return
        columna_origen = fila["columna_id"]

        conn.execute(
            "UPDATE kanban_tarjetas SET columna_id = ? WHERE id = ?",
            (columna_destino, tarjeta_id),
        )

        # La que se movio se saca de la lista y se vuelve a insertar en la
        # posicion pedida, para que el resto corra sin pisarse.
        ids = [
            f["id"]
            for f in conn.execute(
                "SELECT id FROM kanban_tarjetas WHERE columna_id = ? ORDER BY orden, id",
                (columna_destino,),
            ).fetchall()
            if f["id"] != tarjeta_id
        ]
        posicion = max(0, min(posicion, len(ids)))
        ids.insert(posicion, tarjeta_id)
        for orden, tid in enumerate(ids):
            conn.execute("UPDATE kanban_tarjetas SET orden = ? WHERE id = ?", (orden, tid))

        if columna_origen != columna_destino:
            restantes = conn.execute(
                "SELECT id FROM kanban_tarjetas WHERE columna_id = ? ORDER BY orden, id",
                (columna_origen,),
            ).fetchall()
            for orden, f in enumerate(restantes):
                conn.execute("UPDATE kanban_tarjetas SET orden = ? WHERE id = ?", (orden, f["id"]))


# ── Auditoria ─────────────────────────────────────────────────────────────────
#
# Que paso, cuando y por mano de quien. Sirve para dos cosas distintas: para
# responder "quien le dio permisos de jefe a este" seis meses despues, y para
# mirar los ingresos fallidos cuando algo huele raro.
#
# Solo se escribe y se lee. No hay funcion para modificar ni para borrar un
# renglon, y eso es deliberado: una auditoria que la propia app puede editar no
# prueba nada. Lo unico que la toca es `limpiar_auditoria`, por antiguedad.


def registrar_auditoria(
    accion: str,
    actor: int | None = None,
    actor_nombre: str | None = None,
    objeto_tipo: str | None = None,
    objeto_id: str | None = None,
    objeto_nombre: str | None = None,
    detalle: str | None = None,
):
    """Anota un hecho. Nunca lanza: la auditoria no puede voltear la operacion.

    Si esto fallara y se propagara, un problema al anotar (base bloqueada, disco
    lleno) haria fracasar el cambio de rol que ya se hizo, y el usuario veria un
    error de algo que en realidad se guardo. Se prefiere perder el renglon de
    auditoria antes que dejar la operacion a medias, y que quede en el log.
    """
    try:
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO auditoria
                    (cuando, actor, actor_nombre, accion,
                     objeto_tipo, objeto_id, objeto_nombre, detalle)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.now().isoformat(timespec="seconds"),
                    actor,
                    actor_nombre,
                    accion,
                    objeto_tipo,
                    str(objeto_id) if objeto_id is not None else None,
                    objeto_nombre,
                    detalle,
                ),
            )
    except sqlite3.Error:
        logging.getLogger("auditoria").exception(
            "No se pudo registrar en auditoria: accion=%r objeto=%r", accion, objeto_id
        )


def listar_auditoria(limite: int = 200, accion: str | None = None) -> list[dict]:
    """Lo ultimo que paso, de lo mas nuevo a lo mas viejo.

    El limite existe para que la pantalla no pida un año entero de golpe. Se
    acota aca ademas de en el endpoint: es una consulta sin paginar y el tope
    tiene que valer aunque manaña la llame otro.
    """
    limite = max(1, min(int(limite), 1000))

    sql = "SELECT * FROM auditoria"
    params: list = []
    if accion:
        sql += " WHERE accion = ?"
        params.append(accion)
    # Por id y no solo por fecha: dos hechos del mismo segundo tienen el mismo
    # `cuando`, y sin desempate el orden entre ellos queda librado a la suerte.
    sql += " ORDER BY cuando DESC, id DESC LIMIT ?"
    params.append(limite)

    with get_conn() as conn:
        filas = conn.execute(sql, params).fetchall()
    return [dict(f) for f in filas]


def limpiar_auditoria(dias: int = AUDITORIA_DIAS) -> int:
    """Borra lo mas viejo que `dias`. Devuelve cuantos renglones se fueron."""
    corte = (datetime.now() - timedelta(days=dias)).isoformat(timespec="seconds")
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM auditoria WHERE cuando < ?", (corte,))
        return cur.rowcount
