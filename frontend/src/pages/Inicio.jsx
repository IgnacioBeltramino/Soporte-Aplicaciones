import { useEffect, useState } from 'react'
import { Icono } from '../components/Iconos'
import SemanaTickets from '../components/SemanaTickets'

// Secciones que se abren desde aca. Para sumar una nueva alcanza con agregarla
// a esta lista y a db.SECCIONES: el icono sale de components/Iconos.jsx y el
// permiso se filtra igual que en la barra lateral, con usuario.secciones. El
// backend valida por su cuenta, esconder el boton es comodidad y no seguridad.
const ACCESOS = [
  {
    id: 'ficheros',
    label: 'Ficheros',
    desc: 'Alta y baja de ficheros, estado por ping e informe descargable.',
  },
  {
    id: 'eflow',
    label: 'EFLOW',
    desc: 'Totems y nodos: alta, edicion y baja del equipamiento.',
  },
  {
    id: 'generar_link',
    label: 'Generar link',
    desc: 'Convierte una URL de GLPI en una que no se pierde en el login.',
  },
]

// "Miercoles 6 de agosto". toLocaleDateString devuelve el dia en minuscula y
// con una coma en el medio; asi arranca la frase como corresponde.
function fechaDeHoy() {
  const t = new Date()
    .toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    .replace(',', '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * Cuantos tickets abiertos hay, para la linea de estado debajo de la fecha.
 *
 * El total lo calcula el backend por su cuenta: el jefe recibe los de todo el
 * equipo y el resto solo los suyos, asi que aca alcanza con leer lo que
 * devuelve. Si falla la llamada se queda en null y queda la fecha sola, que es
 * mejor que un numero equivocado o un cartel de error en la bienvenida.
 */
function useTicketsAbiertos(habilitado) {
  const [total, setTotal] = useState(null)

  useEffect(() => {
    if (!habilitado) return
    let cancelado = false
    fetch('/api/tickets/open', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelado && d) setTotal(d.total) })
      .catch(() => { /* la fecha sola alcanza */ })
    return () => { cancelado = true }
  }, [habilitado])

  return total
}

// Arma la frase con lo que hay. Devuelve '' cuando todavia no llego el dato,
// para no escribir "no hay nada pendiente" un segundo antes de que aparezca
// que si habia.
function frasePendientes(tickets, novedades) {
  const partes = []
  if (tickets > 0) partes.push(`${tickets} ticket${tickets === 1 ? '' : 's'} abierto${tickets === 1 ? '' : 's'}`)
  if (novedades > 0) partes.push(`${novedades} novedad${novedades === 1 ? '' : 'es'} sin ver`)

  if (partes.length) return `En el grupo hay ${partes.join(' y ')}.`
  return tickets === null ? '' : 'No hay nada pendiente.'
}

export default function Inicio({ usuario, onNavigate, notifCount = 0 }) {
  const secciones = usuario?.secciones || []
  const accesos = ACCESOS.filter(a => secciones.includes(a.id))

  // Solo se cuentan los tickets si el usuario tiene esa pantalla: sin ella el
  // numero no lleva a ningun lado. El endpoint igual responde a todos, es el
  // mismo control de siempre y filtra por usuario.
  const tickets = useTicketsAbiertos(secciones.includes('tickets'))
  const pendientes = frasePendientes(tickets, notifCount)

  return (
    <div className="in-centro">
      <div className="page-header compacto">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Inicio</h1>
        </div>
      </div>

      <div className="in-bienvenida">
        <p className="in-fecha">{fechaDeHoy()}</p>
        {pendientes && <p className="in-pendientes">{pendientes}</p>}
      </div>

      {accesos.length === 0 ? (
        <div className="card in-vacio">
          Tu usuario no tiene secciones disponibles aca. Usá el menú de la izquierda
          para ver tus tickets y las novedades.
        </div>
      ) : (
        <div className="in-grid">
          {accesos.map(a => (
            <button key={a.id} className="card in-acceso" onClick={() => onNavigate(a.id)}>
              <span className="in-acceso-icono">
                <Icono id={a.id} className="in-icon" />
              </span>
              <span className="in-acceso-txt">
                <span className="in-acceso-label">{a.label}</span>
                <span className="in-acceso-desc">{a.desc}</span>
              </span>
              <span className="in-acceso-flecha">›</span>
            </button>
          ))}
        </div>
      )}

      {/* Ultimo de todo: como viene la semana propia, algo para mirar de reojo
          y no una tarea. Sin condicion de permiso a proposito: son los tickets
          que cerro quien esta mirando, y cada uno puede ver lo suyo. */}
      <div className="in-paneles">
        <SemanaTickets />
      </div>

      <style>{`
        /* Una sola columna centrada para toda la pantalla: el titulo, la fecha,
           los accesos y la semana arrancan y terminan en la misma linea. El
           ancho es el que entra tres accesos justos (3 x 300 + 2 gaps), asi la
           fila de arriba queda completa y el panel de la semana no se estira a
           lo ancho de un monitor con el dibujo perdido en el medio. */
        .in-centro {
          max-width: 942px;
          margin: 0 auto;
        }

        /* Los dos en el mismo renglon. Va por baseline y no por center: son
           textos de distinto peso y el center los apoya por la caja, con lo
           cual quedan corridos entre si. Ya no hace falta reservar altura, la
           fecha ocupa la linea desde el arranque y el conteo entra al lado
           cuando llega, sin mover las tarjetas de abajo.

           El wrap es la salida en pantallas angostas: si la frase no entra baja
           entera en vez de partir la fecha al medio. */
        .in-bienvenida {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 0 9px;
          margin: 0 0 24px;
        }

        .in-fecha {
          font-size: var(--fs-base);
          color: var(--text-dim);
          margin: 0;
        }

        /* Lo unico que el usuario no sabia al entrar, asi que es lo que se lee
           primero: va en el color pleno y la fecha queda de acompañamiento. */
        .in-pendientes {
          font-size: var(--fs-base);
          font-weight: 500;
          color: var(--text);
          margin: 0;
        }
        /* El separador cuelga de la frase y no del markup: si no hay nada que
           contar el <p> no se renderiza y el punto se va con el. */
        .in-pendientes::before {
          content: '·';
          margin-right: 9px;
          color: var(--text-dim);
          font-weight: 400;
        }

        /* Separado de los accesos: es otra cosa, se lee despues. */
        .in-paneles {
          margin-top: 34px;
        }

        .in-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 14px;
        }

        .in-acceso {
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          padding: 18px 18px;
          text-align: left;
          cursor: pointer;
          font-family: inherit;
          color: var(--text);
        }
        /* .card ya trae fondo, borde y el hover que levanta la tarjeta */
        .in-acceso:hover .in-acceso-flecha { color: var(--text); transform: translateX(2px); }

        .in-acceso-icono {
          flex-shrink: 0;
          display: grid;
          place-items: center;
          width: 42px;
          height: 42px;
          border-radius: var(--radius);
          background: var(--surface2);
          border: 1px solid var(--border);
          color: var(--text);
        }
        .in-icon { width: 21px; height: 21px; }

        .in-acceso-txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
        .in-acceso-label { font-size: var(--fs-lg); font-weight: 700; }
        .in-acceso-desc { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.45; }

        .in-acceso-flecha {
          flex-shrink: 0;
          font-size: var(--fs-xl);
          line-height: 1;
          color: var(--text-muted);
          transition: color 0.15s, transform 0.15s;
        }

        .in-vacio {
          padding: 22px;
          font-size: var(--fs-base);
          color: var(--text-muted);
          line-height: 1.6;
        }
        .in-vacio:hover { transform: none; box-shadow: none; }

        @media (max-width: 720px) {
          .in-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}
