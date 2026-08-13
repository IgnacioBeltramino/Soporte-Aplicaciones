// Lo que comparten las tres formas de mostrar una novedad: el cartel del
// navegador, el toast de la pagina y la lista de Novedades. Vive aca y no en
// App.jsx para que los componentes lo puedan importar sin ciclo de imports.

export const VALID_TYPES = ['new_ticket', 'new_followup', 'solution_rejected']

export const claveDe = (e) => e.type + '-' + e.id

// El numero de ticket viene en distinto campo segun el tipo de evento.
export const ticketIdDe = (e) => (e.type === 'new_ticket' ? e.id : e.ticket_id)

// Color con el que se marca cada tipo. Son los mismos que usan las tarjetas de
// Novedades (pages/Home.jsx), asi un seguimiento se reconoce por el amarillo
// venga de donde venga.
export const ACENTOS = {
  new_ticket: '#60a5fa',
  new_followup: '#fbbf24',
  solution_rejected: '#f87171',
}

export const acentoDe = (e) => ACENTOS[e.type] || '#60a5fa'

/** Titulo y cuerpo de un evento, en texto plano. */
export function notifContent(data) {
  if (data.type === 'new_ticket') {
    return { title: 'Ticket nuevo #' + data.id, body: data.title || '' }
  }
  if (data.type === 'new_followup') {
    const text = (data.content || '').replace(/<[^>]*>/g, '').slice(0, 120)
    return {
      title: 'Seguimiento en ticket #' + data.ticket_id,
      body: data.author + (text ? ': ' + text : ''),
    }
  }
  if (data.type === 'solution_rejected') {
    return { title: 'Solución rechazada #' + data.ticket_id, body: data.ticket_title || '' }
  }
  return { title: 'Nueva notificacion GLPI', body: '' }
}
