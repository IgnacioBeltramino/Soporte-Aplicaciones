import { useState, useEffect, useRef, useCallback } from 'react'

const TECNICOS = ['Gaston Puca', 'Gonzalo Galarza', 'Ignacio Beltramino']

function matchTech(glpiName, target) {
  if (!glpiName) return false
  const n = glpiName.toLowerCase()
  return target.toLowerCase().split(' ').every(part => n.includes(part))
}

function countFor(dayData, tecnico) {
  return Object.entries(dayData || {}).reduce((sum, [name, count]) => {
    return sum + (matchTech(name, tecnico) ? count : 0)
  }, 0)
}

function getMondayOfCurrentWeek() {
  const today = new Date()
  const day = today.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const d = new Date(today)
  d.setDate(today.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function getDaysInRange(from, to) {
  const days = []
  const d = new Date(from + 'T12:00:00')
  const end = new Date(to + 'T12:00:00')
  while (d <= end) {
    days.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function formatDay(iso) {
  const date = new Date(iso + 'T12:00:00')
  const weekday = date.toLocaleDateString('es-AR', { weekday: 'short' })
  const [, m, d] = iso.split('-')
  return {
    weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1, 3),
    date: `${d}/${m}`,
  }
}

function isWeekend(iso) {
  const day = new Date(iso + 'T12:00:00').getDay()
  return day === 0 || day === 6
}

function getThisWeek() {
  const today = new Date().toISOString().slice(0, 10)
  return { from: getMondayOfCurrentWeek(), to: today }
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
        <div className="loading">Cargando…</div>
      ) : data !== null && (
        grandTotal === 0 ? (
          <div className="loading">Sin tickets cerrados en el período.</div>
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
                      <td className="pdd-td pdd-td-day">
                        <span className="pdd-weekday">{weekday}</span>
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
        .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        .page-header-left { display: flex; align-items: center; gap: 12px; }
        .page-header-right { display: flex; align-items: center; gap: 8px; }
        .refresh-time { font-size: 12px; color: var(--text-muted); }

        .pdd-preset-tab {
          background: var(--surface2); color: var(--text-muted);
          border: 1px solid var(--border); border-radius: 8px;
          font-family: inherit; font-size: 12px; font-weight: 500;
          padding: 6px 14px; cursor: pointer; transition: all 0.15s;
          white-space: nowrap;
        }
        .pdd-preset-tab:hover { color: var(--text); background: rgba(255,255,255,0.06); }
        .pdd-preset-tab--active {
          background: rgba(255,255,255,0.08);
          border-color: rgba(255,255,255,0.25);
          color: var(--text);
        }

        .pdd-scroll { overflow-x: auto; border-radius: var(--radius); border: 1px solid var(--border); }

        .pdd-table { border-collapse: collapse; font-size: 13px; }

        .pdd-th {
          padding: 11px 18px;
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          font-size: 11px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.4px;
          color: var(--text-muted);
          white-space: nowrap;
          position: relative;
        }
        .pdd-th-day { text-align: left; position: sticky; left: 0; z-index: 2; }
        .pdd-th-tech { text-align: center; color: var(--text); font-size: 12px; text-transform: none; letter-spacing: 0; line-height: 1.3; }
        .pdd-th-last { font-weight: 400; color: var(--text-muted); }
        .pdd-th-total { text-align: center; border-left: 1px solid var(--border); }

        .pdd-td { border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
        .pdd-td-day {
          padding: 8px 16px;
          background: var(--surface);
          position: sticky; left: 0; z-index: 1;
          display: flex; flex-direction: column; gap: 1px;
          min-width: 64px;
        }
        .pdd-weekday { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; }
        .pdd-date    { font-size: 13px; font-weight: 600; color: var(--text); }

        .pdd-td-count { text-align: center; padding: 8px 18px; }
        .pdd-td-total {
          text-align: center; padding: 8px 18px;
          border-left: 1px solid var(--border);
          font-weight: 600; color: var(--text);
        }

        .pdd-count {
          display: inline-flex; align-items: center; justify-content: center;
          width: 30px; height: 30px; border-radius: 8px;
          background: rgba(79,142,247,0.12); color: #6aa8ff;
          font-weight: 700; font-size: 15px;
        }
        .pdd-zero { color: var(--text-muted); opacity: 0.35; }

        .pdd-weekend .pdd-date,
        .pdd-weekend .pdd-weekday { opacity: 0.4; }
        .pdd-weekend .pdd-count   { background: rgba(79,142,247,0.06); }

        .pdd-foot-row .pdd-td { border-top: 1px solid var(--border); border-bottom: none; background: var(--surface2); }
        .pdd-foot-label { font-weight: 700; color: var(--text); }
        .pdd-foot-count { font-size: 15px; font-weight: 700; color: var(--text); }

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
