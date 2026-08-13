import { useState, useEffect, useRef, useCallback } from 'react'
import { TablaCargando } from '../components/Cargando'
import Vacio from '../components/Vacio'
// La lista de tecnicos y el conteo por dia se comparten con el cuadro de la
// semana que esta en Inicio: viven en lib/estadisticas.js para que no haya dos
// copias que se puedan desincronizar.
import {
  TECNICOS, countFor, lunesDeEstaSemana,
  diasEntre as getDaysInRange, esFinDeSemana as isWeekend,
} from '../lib/estadisticas'

function formatDay(iso) {
  const date = new Date(iso + 'T12:00:00')
  const weekday = date.toLocaleDateString('es-AR', { weekday: 'short' })
  const [, m, d] = iso.split('-')
  return {
    weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1, 3),
    date: `${d}/${m}`,
  }
}

function getThisWeek() {
  const today = new Date().toISOString().slice(0, 10)
  return { from: lunesDeEstaSemana(), to: today }
}

function getLastWeek() {
  const today = new Date()
  const day = today.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const mon = new Date(today)
  mon.setDate(today.getDate() + diff - 7)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return {
    from: mon.toISOString().slice(0, 10),
    to: sun.toISOString().slice(0, 10),
  }
}

function getThisMonth() {
  const today = new Date()
  const from = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString().slice(0, 10)
  return { from, to: today.toISOString().slice(0, 10) }
}

function rangeFor(preset) {
  if (preset === 'semana-pasada') return getLastWeek()
  if (preset === 'este-mes')      return getThisMonth()
  return getThisWeek()
}

export default function TicketsPorDia() {
  const [preset, setPreset]         = useState('esta-semana')
  const [activeFrom, setActiveFrom] = useState(() => getThisWeek().from)
  const [activeTo, setActiveTo]     = useState(() => getThisWeek().to)
  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const resizeRef = useRef(null)
  const [colWidths, setColWidths] = useState(() => {
    const w = { day: 80, total: 70 }
    TECNICOS.forEach(t => { w[t] = 110 })
    return w
  })

  const handleResizeMove = useCallback((e) => {
    if (!resizeRef.current) return
    const { colKey, startX, startWidth } = resizeRef.current
    const newWidth = Math.max(50, startWidth + (e.clientX - startX))
    setColWidths(prev => ({ ...prev, [colKey]: newWidth }))
  }, [])

  const handleResizeEnd = useCallback(() => {
    resizeRef.current = null
    document.removeEventListener('mousemove', handleResizeMove)
    document.removeEventListener('mouseup', handleResizeEnd)
  }, [handleResizeMove])

  const handleResizeStart = useCallback((e, colKey) => {
    e.preventDefault()
    resizeRef.current = {
      colKey,
      startX: e.clientX,
      startWidth: colWidths[colKey],
    }
    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeEnd)
  }, [colWidths, handleResizeMove, handleResizeEnd])

  const fetchData = async (from, to) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/soporte/closed-by-day?date_from=${from}&date_to=${to}`)
      if (!res.ok) throw new Error('Error al cargar datos')
      setData(await res.json())
      setActiveFrom(from)
      setActiveTo(to)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const { from, to } = rangeFor(preset)
    fetchData(from, to)
  }, [preset])

  const days = getDaysInRange(activeFrom, activeTo)
  const techs = TECNICOS

  const techTotals = {}
  techs.forEach(t => {
    techTotals[t] = days.reduce((s, d) => s + countFor(data?.[d], t), 0)
  })
  const grandTotal = Object.values(techTotals).reduce((a, b) => a + b, 0)

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Cerrados por Día</h1>
        </div>
        <div className="page-header-right">
          {lastRefresh && (
            <span className="refresh-time">
              {lastRefresh.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </span>
          )}
          {[
            { key: 'esta-semana',   label: 'Esta semana' },
            { key: 'semana-pasada', label: 'Semana pasada' },
            { key: 'este-mes',      label: 'Este mes' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`pdd-preset-tab${preset === key ? ' pdd-preset-tab--active' : ''}`}
              onClick={() => setPreset(key)}
            >
              {label}
            </button>
          ))}
          <button className="btn" onClick={() => { const { from, to } = rangeFor(preset); fetchData(from, to) }}>
            ↻ Actualizar
          </button>
        </div>
      </div>

      {error && <div className="error-banner">⚠ {error}</div>}

      {loading ? (
        <TablaCargando filas={7} />
      ) : data !== null && (
        grandTotal === 0 ? (
          <Vacio
            icono="soporte"
            titulo="Sin tickets cerrados en el período"
            texto="Probá con otro rango de fechas."
          />
        ) : (
          <div className="pdd-scroll">
            <table className="pdd-table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: colWidths.day }} />
                {TECNICOS.map(t => <col key={t} style={{ width: colWidths[t] }} />)}
                <col style={{ width: colWidths.total }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="pdd-th pdd-th-day">
                    Día
                    <div className="col-resize-handle" onMouseDown={e => handleResizeStart(e, 'day')} />
                  </th>
                  {techs.map(t => {
                    const parts = t.split(' ')
                    return (
                      <th key={t} className="pdd-th pdd-th-tech">
                        {parts[0]}
                        {parts.length > 1 && <><br /><span className="pdd-th-last">{parts.slice(1).join(' ')}</span></>}
                        <div className="col-resize-handle" onMouseDown={e => handleResizeStart(e, t)} />
                      </th>
                    )
                  })}
                  <th className="pdd-th pdd-th-total">
                    Total
                    <div className="col-resize-handle" onMouseDown={e => handleResizeStart(e, 'total')} />
                  </th>
                </tr>
              </thead>

              <tbody>
                {days.map(day => {
                  const dayData = data[day] || {}
                  const dayTotal = techs.reduce((s, t) => s + countFor(dayData, t), 0)
                  const weekend  = isWeekend(day)
                  const { weekday, date } = formatDay(day)
                  return (
                    <tr key={day} className={weekend ? 'pdd-weekend' : ''}>
                      {/* Dia y fecha en una linea: en dos, cada fila medía 44px
                          y un mes entero no entraba en la pantalla. */}
                      <td className="pdd-td pdd-td-day">
                        <span className="pdd-weekday">{weekday}</span>{' '}
                        <span className="pdd-date">{date}</span>
                      </td>
                      {techs.map(t => {
                        const count = countFor(dayData, t)
                        return (
                          <td key={t} className="pdd-td pdd-td-count">
                            {count > 0
                              ? <span className="pdd-count">{count}</span>
                              : <span className="pdd-zero">—</span>}
                          </td>
                        )
                      })}
                      <td className="pdd-td pdd-td-total">
                        {dayTotal > 0 ? dayTotal : <span className="pdd-zero">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              <tfoot>
                <tr className="pdd-foot-row">
                  <td className="pdd-td pdd-td-day pdd-foot-label">Total</td>
                  {techs.map(t => (
                    <td key={t} className="pdd-td pdd-td-count pdd-foot-count">
                      {techTotals[t] || 0}
                    </td>
                  ))}
                  <td className="pdd-td pdd-td-total pdd-foot-count">{grandTotal}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      <style>{`

        .pdd-preset-tab {
          background: var(--surface2); color: var(--text-muted);
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          font-family: inherit; font-size: var(--fs-sm); font-weight: 500;
          padding: 6px 14px; cursor: pointer;
          /* Las tres que de verdad cambian, y no "all": asi el navegador no se
             pone a vigilar propiedades que disparan layout. */
          transition: color 0.15s, background 0.15s, border-color 0.15s,
                      transform 0.16s ease-out;
          white-space: nowrap;
        }
        .pdd-preset-tab:hover { color: var(--text); background: rgba(255,255,255,0.06); }
        .pdd-preset-tab--active {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.25);
          color: var(--text);
        }

        /* Con tres tecnicos la tabla estirada a 1100px dejaba las cifras tan
           separadas que comparar dos columnas obligaba a barrer la pantalla de
           punta a punta. El tope no molesta si algun dia son mas: los anchos de
           columna siguen mandando y, cuando no entran, el scroll aparece. */
        .pdd-scroll {
          overflow-x: auto; max-width: 900px;
          border-radius: var(--radius); border: 1px solid var(--border);
        }

        .pdd-table { border-collapse: collapse; font-size: var(--fs-base); }

        /* Mismo encabezado que las tablas de tickets y de pases: el escalon mas
           chico de la escala, el gris mas apagado y 0.8 de tracking. */
        .pdd-th {
          padding: 10px 14px;
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          font-size: var(--fs-xs); font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.8px;
          color: var(--text-dim);
          white-space: nowrap;
          position: relative;
        }
        .pdd-th-day { text-align: left; position: sticky; left: 0; z-index: 2; }
        /* Los nombres estaban en 12px y en blanco pleno, mas fuertes que los
           numeros de abajo: la pantalla se leia como una lista de tecnicos y no
           como una tabla de cuantos cerro cada uno. Bajan a etiqueta, con el
           apellido un escalon mas apagado que el nombre. */
        .pdd-th-tech { text-align: center; color: var(--text-muted); line-height: 1.35; }
        .pdd-th-last { font-weight: 400; color: var(--text-dim); }
        .pdd-th-total { text-align: center; border-left: 1px solid var(--border); }

        .pdd-td { border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
        .pdd-td-day {
          padding: 7px 14px;
          background: var(--surface);
          position: sticky; left: 0; z-index: 1;
          white-space: nowrap;
          min-width: 64px;
        }
        .pdd-weekday { font-size: var(--fs-xs); color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.8px; }
        .pdd-date    { font-size: var(--fs-base); font-weight: 600; color: var(--text); }

        .pdd-td-count { text-align: center; padding: 7px 14px; }
        .pdd-td-total {
          text-align: center; padding: 7px 14px;
          border-left: 1px solid var(--border);
          font-size: var(--fs-lg); font-weight: 700; color: var(--text);
        }

        /* Sin la pastilla azul de 30px que tenia cada celda. El fondo era el
           mismo para un 1 que para un 12, asi que no decia nada de la cifra:
           solo pintaba un damero y estiraba cada fila 14px de mas. Lo que queda
           marcando el peso es el tamaño: la celda en 13, el total de la fila y
           el de la columna en 14. */
        .pdd-count { font-size: var(--fs-base); font-weight: 600; color: var(--text); }
        .pdd-zero { color: var(--text-dim); opacity: 0.4; }

        .pdd-weekend .pdd-td { opacity: 0.45; }

        .pdd-foot-row .pdd-td { border-top: 1px solid var(--border); border-bottom: none; background: var(--surface2); }
        .pdd-foot-label {
          font-size: var(--fs-xs); font-weight: 700; color: var(--text-dim);
          text-transform: uppercase; letter-spacing: 0.8px;
        }
        .pdd-foot-count { font-size: var(--fs-lg); font-weight: 700; color: var(--text); }

        .col-resize-handle {
          position: absolute; right: 0; top: 0; bottom: 0;
          width: 5px; cursor: col-resize; background: transparent;
          user-select: none;
        }
        .col-resize-handle:hover { background: rgba(255,255,255,0.15); }
      `}</style>
    </div>
  )
}
