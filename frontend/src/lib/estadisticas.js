// Lo que comparten las pantallas que cuentan tickets cerrados por dia:
// la pantalla "Cerrados por Día" y el cuadro de la semana en Inicio.
//
// Estaba todo adentro de pages/TicketsPorDia.jsx. La lista de tecnicos sobre
// todo no puede estar duplicada: si entra alguien al equipo y se agrega en un
// solo lado, una pantalla lo cuenta y la otra no, y los totales no cierran
// entre dos vistas de lo mismo.

/** Quienes se cuentan. Los nombres son los que devuelve GLPI. */
export const TECNICOS = ['Gaston Puca', 'Gonzalo Galarza', 'Ignacio Beltramino']

/**
 * Si un nombre de GLPI corresponde a un tecnico de la lista.
 *
 * Se compara parte por parte y no con un igual: GLPI devuelve el nombre
 * completo con formatos que no siempre coinciden ("Beltramino Ignacio",
 * segundos nombres, mayusculas).
 */
export function matchTech(glpiName, target) {
  if (!glpiName) return false
  const n = glpiName.toLowerCase()
  return target.toLowerCase().split(' ').every(part => n.includes(part))
}

/** Cuantos cerro un tecnico en el dia que se le pase. */
export function countFor(dayData, tecnico) {
  return Object.entries(dayData || {}).reduce((sum, [name, count]) => {
    return sum + (matchTech(name, tecnico) ? count : 0)
  }, 0)
}

/** Lunes de la semana en curso, en YYYY-MM-DD. El domingo cuenta como fin. */
export function lunesDeEstaSemana() {
  const hoy = new Date()
  const dia = hoy.getDay()
  const diff = dia === 0 ? -6 : 1 - dia
  const d = new Date(hoy)
  d.setDate(hoy.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

/** Todos los dias entre dos fechas, inclusive, en YYYY-MM-DD. */
export function diasEntre(desde, hasta) {
  const dias = []
  // El mediodia evita que el cambio de huso corra la fecha un dia.
  const d = new Date(desde + 'T12:00:00')
  const fin = new Date(hasta + 'T12:00:00')
  while (d <= fin) {
    dias.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return dias
}

/** Si una fecha YYYY-MM-DD cae sabado o domingo. */
export function esFinDeSemana(iso) {
  const dia = new Date(iso + 'T12:00:00').getDay()
  return dia === 0 || dia === 6
}
