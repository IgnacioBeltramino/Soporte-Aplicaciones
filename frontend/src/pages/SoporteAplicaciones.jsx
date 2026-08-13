import { useState, useEffect, useCallback } from 'react'
import TicketTable from '../components/TicketTable'

const TECNICOS = ['Gaston Puca', 'Gonzalo Galarza', 'Ignacio Beltramino']

function matchTech(ticketTech, targetName) {
  if (!ticketTech) return false
  const t = ticketTech.toLowerCase()
  return targetName.toLowerCase().split(' ').every(part => t.includes(part))
}

export default function SoporteAplicaciones() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch('/api/tickets/open')
      if (!res.ok) throw new Error('Error al cargar tickets')
      const data = await res.json()
      setTickets([...data.en_curso, ...data.pendientes])
      setLastRefresh(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTickets()
    const interval = setInterval(fetchTickets, 60000)
    return () => clearInterval(interval)
  }, [fetchTickets])

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Soporte Aplicaciones</h1>
        </div>
        <div className="page-header-right">
          {lastRefresh && <span className="refresh-time">{lastRefresh.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
          <button className="btn" onClick={fetchTickets}>↻ Actualizar</button>
        </div>
      </div>

      {error && <div className="error-banner">⚠ {error}</div>}

      <div className="sa-list">
        {/* Sin asignar — primero */}
        {(() => {
          const sinAsignar = tickets.filter(t => !TECNICOS.some(n => matchTech(t.tech, n)))
          return (
            <section key="sin-asignar">
              <div className="sa-col-header">
                <span className="sa-avatar sa-avatar-unassigned">?</span>
                <span className="sa-name">Sin asignar</span>
                <span className="badge" style={sinAsignar.length > 0 ? { background: 'rgba(239,68,68,0.15)', color: '#ef4444' } : {}}>
                  {sinAsignar.length}
                </span>
              </div>
              <TicketTable tickets={sinAsignar} loading={loading} emptyMsg="Sin tickets sin asignar." />
            </section>
          )
        })()}

        {/* Un técnico por sección */}
        {TECNICOS.map((nombre) => {
          const techTickets = tickets.filter(t => matchTech(t.tech, nombre))
          return (
            <section key={nombre}>
              <div className="sa-col-header">
                <span className="sa-avatar">{nombre.charAt(0)}</span>
                <span className="sa-name">{nombre}</span>
                <span className="badge">{techTickets.length}</span>
              </div>
              <TicketTable tickets={techTickets} loading={loading} emptyMsg="Sin tickets asignados." />
            </section>
          )
        })}
      </div>

      <style>{`
        .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        .page-header-left { display: flex; align-items: center; gap: 12px; }
        .page-header-right { display: flex; align-items: center; gap: 12px; }
        .refresh-time { font-size: 12px; color: var(--text-muted); }
        .sa-list { display: flex; flex-direction: column; gap: 32px; }
        .sa-col-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .sa-avatar {
          width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
          background: var(--primary-dim); color: var(--primary);
          font-weight: 700; font-size: 12px;
          display: flex; align-items: center; justify-content: center;
          border: 1px solid rgba(255,224,194,0.2);
        }
        .sa-avatar-unassigned {
          background: rgba(239,68,68,0.1); color: #ef4444;
          border-color: rgba(239,68,68,0.2);
        }
        .sa-name { font-size: 14px; font-weight: 600; color: var(--text); flex: 1; }
      `}</style>
    </div>
  )
}
