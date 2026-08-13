import { useState, useEffect, useCallback } from 'react'
import { TablaCargando } from '../components/Cargando'
import Vacio from '../components/Vacio'
import { ticketUrl } from '../lib/glpi'

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

      {/* Con la tabla vacia adentro no se entiende si esta cargando o no hay
          nada, asi que esos dos casos se muestran en lugar de la tabla. */}
      {loading ? (
        <TablaCargando filas={6} />
      ) : !tickets.length ? (
        <Vacio
          icono="pases"
          titulo="Sin registros"
          texto="Todavía no hay pases a producción para mostrar."
        />
      ) : (
      <div className="pp-wrap">
        <table className="pp-table">
          <thead>
            <tr>
              <th className="pp-c-id">#</th>
              <th>Titulo</th>
              <th className="pp-c-estado">Estado</th>
              <th className="pp-c-solic">Solicitante</th>
              <th className="pp-c-cierre">Cierre</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map(t => {
              const url = ticketUrl(t.id)
              const isFin = t.status === 'finalizado'
              return (
                <tr key={t.id}>
                  <td className="pp-id">{t.id}</td>
                  {/* El titulo es el link, igual que en TicketTable: la columna
                      "Ver ->" repetia lo mismo en cada fila. */}
                  <td className="pp-title" title={t.title}>
                    <a href={url} target="_blank" rel="noreferrer" className="pp-title-link">
                      {t.title}
                    </a>
                  </td>
                  <td>
                    <span className={'pp-badge ' + (isFin ? 'fin' : 'pend')}>
                      {isFin ? 'Finalizado' : 'Pendiente'}
                    </span>
                  </td>
                  <td className="pp-muted" title={t.requester}>{t.requester}</td>
                  {/* Fecha y hora eran dos columnas para el mismo dato. Juntas
                      ocupan menos que las dos por separado y se leen de una. */}
                  <td className="pp-muted">
                    {isFin ? formatDate(t.close_date) + ' ' + formatTime(t.close_date) : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}

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

      <style>{`
        .pp-page { max-width: 100%; margin: 0 auto; }
        .pp-wrap {
          overflow-x: auto;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
        }
        .pp-table { width: 100%; min-width: 720px; table-layout: fixed; border-collapse: collapse; font-size: var(--fs-base); }

        /* Anchos declarados: el titulo es la unica columna sin ancho, asi se
           queda con lo que sobra en vez de repartirlo entre todas. */
        .pp-c-id     { width: 64px; }
        .pp-c-estado { width: 118px; }
        .pp-c-solic  { width: 180px; }
        /* "03/08/2026 14:32" son 16 caracteres: 106px de texto mas 28 de
           padding. */
        .pp-c-cierre { width: 136px; }

        .pp-table th {
          text-align: left; padding: 10px 14px;
          color: var(--text-dim); font-weight: 600;
          font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.8px;
          border-bottom: 1px solid var(--border); white-space: nowrap;
        }
        .pp-table td { padding: 8px 14px; border-top: 1px solid var(--border); vertical-align: middle; }
        .pp-table tbody tr { transition: background 0.15s; }
        .pp-table tbody tr:hover { background: rgba(255,255,255,0.03); }

        .pp-id { color: var(--text-dim); font-weight: 600; white-space: nowrap; font-size: var(--fs-xs); }

        .pp-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pp-title-link {
          color: var(--text); font-weight: 600; text-decoration: none;
          transition: color 0.15s ease;
        }
        .pp-table tbody tr:hover .pp-title-link {
          color: var(--primary); text-decoration: underline; text-underline-offset: 3px;
        }

        .pp-muted {
          color: var(--text-dim); white-space: nowrap; font-size: var(--fs-xs);
          overflow: hidden; text-overflow: ellipsis;
        }

        /* Los dos estados salen de las variables de estado con color-mix, como
           el resto de la app. Estaban escritos a mano en rgba(), que es el mismo
           color pero sin decir cual: cambiar --estado-resuelto no llegaba aca. */
        .pp-badge {
          display: inline-block; padding: 2px 9px; border-radius: var(--radius-sm);
          font-size: var(--fs-xs); font-weight: 600; white-space: nowrap;
          color: var(--pb);
          background: color-mix(in srgb, var(--pb) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--pb) 30%, transparent);
        }
        .pp-badge.fin  { --pb: var(--estado-resuelto); }
        .pp-badge.pend { --pb: var(--estado-espera); }

        .pp-footer {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 16px; flex-wrap: wrap; gap: 12px;
        }
        .pp-pager { display: flex; align-items: center; gap: 10px; }
        .pp-nav-btn {
          padding: 5px 12px; border-radius: var(--radius-sm);
          border: 1px solid var(--border); background: var(--surface);
          color: var(--text); font-size: var(--fs-sm); cursor: pointer; font-family: inherit;
          transition: background .15s, transform .16s ease-out;
        }
        .pp-nav-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); }
        .pp-nav-btn:disabled { opacity: 0.35; cursor: default; }
        .pp-page-info { font-size: var(--fs-xs); color: var(--text-dim); white-space: nowrap; }
        .pp-limit { display: flex; align-items: center; gap: 6px; }
        .pp-limit-label { font-size: var(--fs-xs); color: var(--text-dim); }
        .pp-limit-btn {
          padding: 4px 10px; border-radius: var(--radius-sm);
          border: 1px solid var(--border); background: var(--surface);
          color: var(--text-dim); font-size: var(--fs-sm); cursor: pointer; font-family: inherit;
          transition: color .15s, background .15s, border-color .15s, transform .16s ease-out;
        }
        .pp-limit-btn:hover { color: var(--text); background: rgba(255,255,255,0.06); }
        .pp-limit-btn.active { color: var(--text); background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); }
      `}</style>
    </div>
  )
}
