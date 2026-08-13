import { useState, useEffect, useCallback } from 'react'

const GLPI_BASE = 'https://tickets.msm.gov.ar'
const PAGE_SIZES = [10, 20, 30, 40]

function formatDate(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return dd + '/' + mm + '/' + yyyy
}

function formatTime(dateStr) {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return hh + ':' + min
}

export default function PasesProduccion() {
  const [tickets, setTickets] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [limit, setLimit] = useState(10)
  const [offset, setOffset] = useState(0)
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchData = useCallback(async (lim, off) => {
    setLoading(true)
    try {
      const res = await fetch('/api/pases?limit=' + lim + '&offset=' + off)
      if (!res.ok) throw new Error('Error al cargar pases')
      const data = await res.json()
      setTickets(data.tickets)
      setTotal(data.total)
      setLastRefresh(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(limit, offset) }, [fetchData, limit, offset])

  const totalPages = Math.ceil(total / limit) || 1
  const currentPage = Math.floor(offset / limit) + 1
  const goTo = (page) => setOffset((page - 1) * limit)
  const handleLimitChange = (newLimit) => { setLimit(newLimit); setOffset(0) }
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + limit, total)

  return (
    <div className="pp-page">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Pases a Produccion</h1>
          <span className="badge">{total} total</span>
        </div>
        <div className="page-header-right">
          {lastRefresh && (
            <span className="refresh-time">
              {lastRefresh.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </span>
          )}
          <button className="btn" onClick={() => fetchData(limit, offset)}>↻ Actualizar</button>
        </div>
      </div>

      {error && <div className="error-banner">Error: {error}</div>}

      <div className="pp-wrap">
        <table className="pp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Titulo</th>
              <th>Estado</th>
              <th>Solicitante</th>
              <th>Fecha cierre</th>
              <th>Hora cierre</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="pp-state">Cargando...</td></tr>
            ) : !tickets.length ? (
              <tr><td colSpan={7} className="pp-state">Sin registros.</td></tr>
            ) : tickets.map(t => {
              const url = GLPI_BASE + '/index.php?redirect=/front/ticket.form.php?id=' + t.id
              const isFin = t.status === 'finalizado'
              return (
                <tr key={t.id}>
                  <td className="pp-id">{t.id}</td>
                  <td className="pp-title">{t.title}</td>
                  <td>
                    <span className={'pp-badge ' + (isFin ? 'fin' : 'pend')}>
                      {isFin ? 'Finalizado' : 'Pendiente'}
                    </span>
                  </td>
                  <td className="pp-muted">{t.requester}</td>
                  <td className="pp-muted">{isFin ? formatDate(t.close_date) : '-'}</td>
                  <td className="pp-muted">{isFin ? formatTime(t.close_date) : '-'}</td>
                  <td>
                    <a href={url} target="_blank" rel="noreferrer" className="pp-link">Ver &rarr;</a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="pp-footer">
        <div className="pp-pager">
          <button className="pp-nav-btn" disabled={currentPage <= 1} onClick={() => goTo(currentPage - 1)}>Anterior</button>
          <span className="pp-page-info">{from}-{to} de {total}</span>
          <button className="pp-nav-btn" disabled={currentPage >= totalPages} onClick={() => goTo(currentPage + 1)}>Siguiente</button>
        </div>
        <div className="pp-limit">
          <span className="pp-limit-label">Por pagina:</span>
          {PAGE_SIZES.map(s => (
            <button key={s} className={'pp-limit-btn' + (limit === s ? ' active' : '')} onClick={() => handleLimitChange(s)}>{s}</button>
          ))}
        </div>
      </div>

      <style>{`.pp-page{max-width:100%;margin:0 auto}.page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}.page-header-left{display:flex;align-items:center;gap:12px}.page-header-right{display:flex;align-items:center;gap:12px}.refresh-time{font-size:12px;color:var(--text-muted)}.pp-wrap{overflow:visible;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)}.pp-table{width:100%;table-layout:auto;border-collapse:collapse;font-size:13px}.pp-table th{text-align:left;padding:10px 14px;color:var(--text-muted);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid var(--border);white-space:nowrap}.pp-table td{padding:9px 14px;border-top:1px solid var(--border);vertical-align:middle}.pp-table tbody tr{transition:background .15s}.pp-table tbody tr:hover{background:rgba(255,255,255,.03)}.pp-id{color:var(--text-muted);font-weight:600;white-space:nowrap;font-size:12px}.pp-title{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:420px}.pp-muted{color:var(--text-muted);white-space:nowrap;font-size:12px}.pp-state{padding:48px;text-align:center;color:var(--text-muted);font-size:13px}.pp-badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap}.pp-badge.fin{color:#4ade80;background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.3)}.pp-badge.pend{color:#fbbf24;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.3)}.pp-link{font-size:12px;color:var(--primary);white-space:nowrap;opacity:.6;transition:opacity .15s;text-decoration:none}.pp-link:hover{opacity:1}.pp-footer{display:flex;align-items:center;justify-content:space-between;margin-top:16px;flex-wrap:wrap;gap:12px}.pp-pager{display:flex;align-items:center;gap:10px}.pp-nav-btn{padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px;cursor:pointer;font-family:inherit;transition:background .15s}.pp-nav-btn:hover:not(:disabled){background:rgba(255,255,255,.06)}.pp-nav-btn:disabled{opacity:.35;cursor:default}.pp-page-info{font-size:12px;color:var(--text-muted);white-space:nowrap}.pp-limit{display:flex;align-items:center;gap:6px}.pp-limit-label{font-size:12px;color:var(--text-muted)}.pp-limit-btn{padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text-muted);font-size:12px;cursor:pointer;font-family:inherit;transition:all .15s}.pp-limit-btn:hover{color:var(--text);background:rgba(255,255,255,.06)}.pp-limit-btn.active{color:var(--text);background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2)}`}</style>
    </div>
  )
}
