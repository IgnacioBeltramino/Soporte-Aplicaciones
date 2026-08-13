// Armado de links de GLPI en un solo lugar.
//
// El problema que resuelve: si le pasas a alguien la URL de un formulario y esa
// persona no tiene sesion abierta, GLPI la manda al login y despues la deja en
// el home, perdiendo el destino. GLPI trae un parametro propio para eso:
//
//   /index.php?redirect=<destino>
//
// El destino tiene que ir URL-encodeado. Sin encodear funciona igual mientras
// tenga un solo parametro, pero se rompe apenas aparece un segundo: en
//
//   ...?redirect=/front/x.php?id=5&tipo=2
//
// el navegador y PHP leen ese &tipo=2 como un parametro de index.php, no como
// parte del redirect, asi que el destino llega cortado en "id=5". Encodeado
// viaja entero y PHP lo decodifica solo al leer $_GET.

// Se inyecta desde vite.config.js a partir del GLPI_URL del .env.
export const GLPI_WEB_URL = import.meta.env.VITE_GLPI_WEB_URL || ''

/**
 * Arma el link de redireccion a partir de un destino interno de GLPI.
 * El destino es la parte de la URL que va despues del dominio,
 * por ejemplo: /front/ticket.form.php?id=123
 */
export function linkConRedirect(destino) {
  return `${GLPI_WEB_URL}/index.php?redirect=${encodeURIComponent(destino)}`
}

/** Link directo a un ticket. Es el caso que mas se usa en el dashboard. */
export function ticketUrl(id) {
  return linkConRedirect(`/front/ticket.form.php?id=${id}`)
}

/**
 * Toma cualquier URL de GLPI pegada del navegador y devuelve la version con
 * redirect. Devuelve { ok, link, destino, error, aviso }.
 *
 * Acepta la URL completa, o solo la ruta si la pegaron sin el dominio.
 */
export function generarLinkDeRedireccion(texto) {
  const entrada = (texto || '').trim()
  if (!entrada) {
    return { ok: false, error: 'Pegá una URL de GLPI.' }
  }

  let url
  try {
    // La base cubre el caso de que hayan pegado solo la ruta (/front/...).
    url = new URL(entrada, GLPI_WEB_URL || 'https://glpi.local')
  } catch {
    return { ok: false, error: 'Eso no parece una URL válida.' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'La URL tiene que empezar con http:// o https://' }
  }

  // Si ya es un link de redireccion, se usa el destino que trae adentro en vez
  // de anidar un redirect dentro de otro.
  const redirectPrevio = url.searchParams.get('redirect')
  if (redirectPrevio) {
    return {
      ok: true,
      destino: redirectPrevio,
      link: linkConRedirect(redirectPrevio),
      aviso: 'Esa URL ya tenía un redirect: se reusó el destino que traía adentro.',
    }
  }

  const destino = url.pathname + url.search + url.hash
  if (destino === '/' || destino === '') {
    return { ok: false, error: 'Esa URL es la home de GLPI, no hay adónde redirigir.' }
  }

  // Que sea de otro dominio no impide armar el link, pero casi siempre es un
  // pegado por error, asi que conviene avisarlo.
  let aviso = null
  if (GLPI_WEB_URL) {
    const esperado = new URL(GLPI_WEB_URL).host
    if (url.host !== esperado) {
      aviso = `Ojo: esa URL es de ${url.host} y GLPI está en ${esperado}. Se armó igual, pero revisala.`
    }
  }

  return { ok: true, destino, link: linkConRedirect(destino), aviso }
}
