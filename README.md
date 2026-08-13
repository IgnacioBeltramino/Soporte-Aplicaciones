# Soporte Aplicaciones

Aplicacion interna del equipo de Soporte Aplicaciones del Municipio de San Miguel.

Empezo siendo un tablero de monitoreo de GLPI y hoy es la herramienta de trabajo del area:

- **GLPI**: novedades en vivo (tickets nuevos, seguimientos, soluciones rechazadas), tickets abiertos por tecnico, historico y estadisticas, y reportes en PDF.
- **Ficheros**: alta y baja, estado por ping e informe descargable.
- **EFLOW**: ABM de totems y nodos.
- **Usuarios**: roles y permisos por Active Directory, y a quien le llegan los avisos por Telegram.
- **Generar link**: convierte una URL de GLPI en una que no se pierde en el login.

---
### Contenido que tiene que tener el .env en el servidor

| Variable | En el server |
|---|---|
| `DEV` | **no se define** (sin esto queda el `reload` de desarrollo prendido) |
| `SECRET_KEY` | **nueva, distinta a la de tu maquina** |
| `LOG_FILE` | una ruta afuera de la carpeta del proyecto |
| `DB_PATH` | una carpeta afuera del repo, para que el `git pull` no la roce. La carpeta tiene que existir |
| `JEFE_INICIAL` | el `users_id` de GLPI que arranca como jefe. **Verificarlo antes del primer login**: ver la seccion 3 |
| `COOKIE_HTTPS_ONLY` | `1` en cuanto haya certificado; vacio mientras sea HTTP |
| `POLL_INTERVAL` | se puede subir a 60 para no castigar a GLPI |
| `DEBUG_ENDPOINTS` | vacio. Se pone en `1` solo mientras se diagnostica algo |

La `SECRET_KEY` se genera en el server con:

```
python -c "import secrets; print(secrets.token_hex(32))"
```

Que el `.env` lo lea **solo la cuenta con la que corre el servicio**: adentro estan
el token de GLPI, el del bot de Telegram y la clave que firma las sesiones.


> **Antes del primer login, revisar `JEFE_INICIAL` dos veces.**
>
> Es el `users_id` de GLPI que se crea con rol jefe, y es el unico que puede
> repartir permisos. **El rol solo se asigna al crear el usuario**
> (`db.registrar_acceso`): si entras por primera vez con la variable vacia o con
> otro numero, te creas como tecnico, y **corregir el `.env` despues no te
> promueve** — tu fila ya existe y el rol no se vuelve a tocar.
>
> El sintoma es que no ves "Usuarios y permisos" y no hay forma de darsela a
> nadie desde la app. Se sale editando la base a mano:
>
> ```sql
> UPDATE usuarios SET rol = 'jefe' WHERE glpi_user_id = <tu_id>;
> ```
>
> Es facil de arreglar si sabes que existe, y desconcertante si no.



