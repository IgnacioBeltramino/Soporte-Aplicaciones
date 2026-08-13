import { useState, useEffect, useCallback } from 'react'
import TicketTable from '../components/TicketTable'

export default function TicketsAbiertos() {
  const [enCurso, setEnCurso] = useState([])
  const [pendientes, setPendientes] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch('/api/tickets/open')
      if (!res.ok) throw new Error('Error al cargar tickets')
      const data = await res.json()
      setEnCurso(data.en_curso)
      setPendientes(data.pendientes)
      setTotal(data.total)
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
    <div className="ta-page">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Tickets Abiertos</h1>
          <span className="badge">{total} total</span>
        </div>
        <div className="page-header-right">
          {lastRefresh && <span className="refresh-time">{lastRefresh.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
          <button className="btn" onClick={fetchTickets}>↻ Actualizar</button>
        </div>
      </div>

      {error && <div className="error-banner">⚠ {error}</div>}

      <div className="ta-sections">
        <section>
          <div className="col-header">
            <span className="col-dot" style={{ background: 'var(--blue)' }} />
            <span className="col-label">En curso</span>
            <span className="badge">{enCurso.length}</span>
          </div>
          <TicketTable tickets={enCurso} loading={loading} emptyMsg="Sin tickets en curso." />
        </section>
        <section>
          <div className="col-header">
            <span className="col-dot" style={{ background: 'var(--yellow)' }} />
            <span className="col-label">Pendientes</span>
            <span className="badge">{pendientes.length}</span>
          </div>
          <TicketTable tickets={pendientes} loading={loading} emptyMsg="Sin tickets pendientes." />
        </section>
      </div>

      <style>{`
        .ta-page { max-width: 960px; margin: 0 auto; }
        .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        .page-header-left { display: flex; align-items: center; gap: 12px; }
        .page-header-right { display: flex; align-items: center; gap: 12px; }
        .refresh-time { font-size: 12px; color: var(--text-muted); }
        .ta-sections { display: flex; flex-direction: column; gap: 28px; }
        .col-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .col-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .col-label { font-size: 14px; font-weight: 600; color: var(--text); flex: 1; }
      `}</style>
    </div>
  )
}
