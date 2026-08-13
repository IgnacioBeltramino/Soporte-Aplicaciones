import { useCallback, useEffect, useState } from 'react'

// Direcciones de la aplicacion.
//
// Se usa el hash (#/tickets) y no una ruta normal (/tickets) a proposito: lo
// que va despues del # no se le manda al servidor, asi que recargar con F5
// funciona sin tener que configurar nada. Con rutas normales, el servidor
// tiene que devolver el index.html para cualquier direccion o F5 da 404, y
// eso hay que acordarse de configurarlo en cada despliegue.
//
// Quien ve cada pagina ya no se declara aca: sale de la tabla de permisos y
// llega con el usuario en /api/auth/me, como usuario.secciones. La clave de
// cada entrada es el id de la seccion, el mismo que usa db.SECCIONES en el
// backend. Esto no reemplaza al control del backend, que es el que de verdad
// protege los datos: sirve para que escribir una direccion a mano no termine
// en una pantalla en blanco.

export const PAGINAS = {
  inicio:          { ruta: '' },
  home:            { ruta: 'novedades' },
  tickets:         { ruta: 'tickets' },
  kanban:          { ruta: 'tareas' },
  generar_link:    { ruta: 'generar-link' },
  pases:           { ruta: 'pases' },
  ficheros:        { ruta: 'ficheros' },
  eflow:           { ruta: 'eflow' },
  stats:           { ruta: 'historico' },
  soporte_tecnico: { ruta: 'tickets-tecnico' },
  soporte_dia:     { ruta: 'cerrados-por-dia' },
  reportes:        { ruta: 'reportes' },
  usuarios:        { ruta: 'usuarios' },
}

const INICIO = 'inicio'

/** Direccion para una pagina, lista para un href o para location.hash. */
export function hashDe(pagina) {
  const p = PAGINAS[pagina]
  return `#/${p ? p.ruta : ''}`
}

/** Pagina que corresponde al hash actual del navegador. */
export function paginaDelHash() {
  const ruta = window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '')
  if (!ruta) return INICIO
  const entrada = Object.entries(PAGINAS).find(([, p]) => p.ruta === ruta)
  return entrada ? entrada[0] : INICIO
}

/** Si el usuario puede ver una pagina, segun las secciones que le dio el backend. */
export function puedeVer(pagina, secciones) {
  return !!PAGINAS[pagina] && (secciones || []).includes(pagina)
}

/**
 * Pagina actual sincronizada con la direccion del navegador.
 *
 * Devuelve [pagina, irA] y se usa igual que un useState, asi el resto de la
 * app no se entera de que hay un hash atras.
 */
export function usePagina() {
  const [pagina, setPagina] = useState(paginaDelHash)

  // El hash cambia por el boton Atras, por un link pegado o por irA.
  useEffect(() => {
    const alCambiar = () => setPagina(paginaDelHash())
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])

  // Al entrar sin hash queda la direccion de Inicio escrita, para que el
  // primer Atras no se lleve al usuario fuera de la aplicacion.
  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', hashDe(INICIO))
  }, [])

  const irA = useCallback((destino) => {
    if (destino === paginaDelHash()) return
    // Cambiar el hash dispara hashchange, que es quien actualiza el estado:
    // asi da igual si se navego desde el menu o desde el boton Atras.
    window.location.hash = hashDe(destino)
  }, [])

  return [pagina, irA]
}
