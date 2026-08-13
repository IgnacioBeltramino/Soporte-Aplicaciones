import { useRef, useState } from 'react'
import { TablaCargando } from './Cargando'
import Vacio from './Vacio'
import { ticketUrl } from '../lib/glpi'

// Ancho normal de la columna Tecnico y tope al que puede llegar cuando se la
// expande: mas que esto le empieza a comer demasiado al titulo y la tabla
// termina con scroll horizontal, que es justo lo que queremos evitar.
const ANCHO_TEC = 140
const ANCHO_TEC_MAX = 320

const STATUS_MAP = {
  1: { label: 'Nuevo',       color: 'var(--estado-nuevo)' },
  2: { label: 'En proceso',  color: 'var(--estado-proceso)' },
  3: { label: 'Planificado', color: 'var(--estado-planificado)' },
  4: { label: 'En espera',   color: 'var(--estado-espera)' },
  5: { label: 'Resuelto',    color: 'var(--estado-resuelto)' },
  6: { label: 'Cerrado',     color: 'var(--estado-cerrado)' },
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${min}`
}

export default function TicketTable({ tickets, loading, emptyMsg = 'No hay tickets.' }) {
  // null = ancho normal. Cuando se expande guarda el ancho calculado en px.
  const [anchoTec, setAnchoTec] = useState(null)
  const tbodyRef = useRef(null)

  // Doble clic sobre la columna Tecnico: se estira hasta que entre el nombre mas
  // largo y con otro doble clic vuelve. Como el td tiene overflow oculto, su
  // scrollWidth es el ancho que ocuparia el texto entero; le sumamos el padding
  // derecho (14px, ver .tt td) que scrollWidth no cuenta.
  const alternarAnchoTec = () => {
    if (anchoTec) {
      setAnchoTec(null)
      return
    }
    const celdas = tbodyRef.current?.querySelectorAll('.tt-tec') ?? []
    let necesario = 0
    celdas.forEach(c => { necesario = Math.max(necesario, c.scrollWidth + 14) })
    setAnchoTec(Math.min(Math.max(necesario, ANCHO_TEC), ANCHO_TEC_MAX))
  }

  if (loading) return <TablaCargando />
  if (!tickets?.length) {
    return <Vacio icono="tickets" titulo={emptyMsg} texto="Cuando entre uno nuevo va a aparecer acá." />
  }

  return (
    <>
      <div className="tt-wrap">
        <table className="tt">
          {/* Los anchos van aca y no en cada td: con table-layout fixed la tabla
              se arma con la primera fila, asi el titulo se queda con lo que sobra
              y la columna del "Ver" no se cae de la pantalla. */}
          <thead>
            <tr>
              <th className="tt-c-id">#</th>
              <th>Título</th>
              <th className="tt-c-estado">Estado</th>
              <th
                className="tt-c-tec"
                style={anchoTec ? { width: anchoTec } : undefined}
                onDoubleClick={alternarAnchoTec}
                title="Doble clic para expandir o contraer la columna"
              >
                Técnico
              </th>
              <th className="tt-c-fecha">Apertura</th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {tickets.map((t) => {
              const s = STATUS_MAP[t.status] ?? { label: `#${t.status}`, color: 'var(--estado-cerrado)' }
              const url = ticketUrl(t.id)
              return (
                <tr key={t.id}>
                  <td className="tt-id">{t.id}</td>
                  {/* El titulo es el link al ticket. Antes habia una columna
                      "Ver ->" al final que repetia lo mismo en cada fila y se
                      comia 68px de ancho que le hacian falta al titulo.
                      El titulo se corta con puntos suspensivos, asi que el
                      completo queda a mano pasando el mouse por encima. */}
                  <td className="tt-title" title={t.title}>
                    <a href={url} target="_blank" rel="noreferrer" className="tt-title-link">
                      {t.title}
                    </a>
                  </td>
                  <td>
                    <span className="tt-status" style={{ '--sc': s.color }}>{s.label}</span>
                  </td>
                  <td
                    className="tt-muted tt-tec"
                    title={t.tech || ''}
                    onDoubleClick={alternarAnchoTec}
                  >
                    {t.tech || '—'}
                  </td>
                  <td className="tt-muted">{formatDate(t.opened_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <style>{`
        .tt-wrap {
          overflow-x: auto;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
        }
        /* min-width: abajo de eso las columnas quedan impresentables y conviene
           que .tt-wrap scrollee (celulares), pero en el ancho normal entra todo. */
        .tt { width: 100%; min-width: 560px; table-layout: fixed; border-collapse: collapse; font-size: var(--fs-base); }
        .tt-c-id     { width: 58px; }
        .tt-c-estado { width: 112px; }
        /* col-resize es el cursor que usan las planillas en el borde de columna:
           avisa que ahi se puede tocar. El ancho sale de la constante ANCHO_TEC
           para no tenerlo escrito en dos lados. */
        .tt-c-tec    { width: ${ANCHO_TEC}px; cursor: col-resize; user-select: none; }
        /* 108 y no 94: la fecha "04/08 14:32" son 11 caracteres, y en una
           monoespaciada de 11px eso es 72px de texto mas los 28 de padding.
           Con 94 no entraba y el ellipsis se comia el final de la hora. */
        .tt-c-fecha  { width: 108px; }

        /* Los encabezados son etiquetas, no contenido: van en el escalon mas
           bajo de la escala y en el gris mas apagado. Con el mismo tracking de
           0.8px que los titulos de columna de Novedades. */
        .tt th {
          text-align: left; padding: 10px 14px;
          color: var(--text-dim); font-weight: 600;
          font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.8px;
          border-bottom: 1px solid var(--border); white-space: nowrap;
        }
        .tt td { padding: 8px 14px; border-top: 1px solid var(--border); vertical-align: middle; }
        .tt tbody tr { transition: background 0.15s; }
        .tt tbody tr:hover { background: rgba(255,255,255,0.03); }

        .tt-id { color: var(--text-dim); font-weight: 600; white-space: nowrap; font-size: var(--fs-xs); }

        /* Con table-layout fixed el ancho lo pone la columna, no el contenido:
           sin overflow oculto el texto largo se derrama sobre la celda de al lado. */
        .tt-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tt-title-link {
          color: var(--text); font-weight: 600; text-decoration: none;
          transition: color 0.15s ease;
        }
        .tt tbody tr:hover .tt-title-link { color: var(--primary); text-decoration: underline; text-underline-offset: 3px; }

        /* Tecnico y fecha son metadatos: bajan un escalon respecto del titulo,
           que es lo que uno viene a leer. */
        .tt-muted {
          color: var(--text-dim); overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; font-size: var(--fs-xs);
        }
        .tt-status {
          display: inline-block; padding: 2px 9px; border-radius: var(--radius-sm);
          font-size: var(--fs-xs); font-weight: 600;
          color: var(--sc);
          background: color-mix(in srgb, var(--sc) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--sc) 30%, transparent);
          white-space: nowrap;
        }
      `}</style>
    </>
  )
}
