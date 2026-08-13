const STATUS_MAP = {
  1: { label: 'Nuevo',       color: '#60a5fa' },
  2: { label: 'En proceso',  color: '#a78bfa' },
  3: { label: 'Planificado', color: '#22d3ee' },
  4: { label: 'En espera',   color: '#fbbf24' },
  5: { label: 'Resuelto',    color: '#4ade80' },
  6: { label: 'Cerrado',     color: '#6b7280' },
}

const GLPI_BASE = 'https://tickets.msm.gov.ar'

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
  if (loading) return <div className="tt-state">Cargando...</div>
  if (!tickets?.length) return <div className="tt-state">{emptyMsg}</div>

  return (
    <>
      <div className="tt-wrap">
        <table className="tt">
          <thead>
            <tr>
              <th>#</th>
              <th>Título</th>
              <th>Estado</th>
              <th>Técnico</th>
              <th>Apertura</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => {
              const s = STATUS_MAP[t.status] ?? { label: `#${t.status}`, color: '#6b7280' }
              const url = `${GLPI_BASE}/index.php?redirect=/front/ticket.form.php?id=${t.id}`
              return (
                <tr key={t.id}>
                  <td className="tt-id">{t.id}</td>
                  <td className="tt-title">{t.title}</td>
                  <td>
                    <span className="tt-status" style={{ '--sc': s.color }}>{s.label}</span>
                  </td>
                  <td className="tt-muted">{t.tech || '—'}</td>
                  <td className="tt-muted">{formatDate(t.opened_at)}</td>
                  <td>
                    <a href={url} target="_blank" rel="noreferrer" className="tt-link">
                      Ver →
                    </a>
                  </td>
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
        .tt { width: 100%; border-collapse: collapse; font-size: 13px; }
        .tt th { text-align: left; padding: 10px 14px; color: var(--text-muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid var(--border); white-space: nowrap; }
        .tt td { padding: 9px 14px; border-top: 1px solid var(--border); vertical-align: middle; }
        .tt tbody tr { transition: background 0.15s; }
        .tt tbody tr:hover { background: rgba(255,255,255,0.03); }
        .tt-id { color: var(--text-muted); font-weight: 600; white-space: nowrap; font-size: 12px; }
        .tt-title { font-weight: 500; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tt-muted { color: var(--text-muted); white-space: nowrap; font-size: 12px; }
        .tt-status {
          display: inline-block; padding: 2px 9px; border-radius: 20px;
          font-size: 11px; font-weight: 600;
          color: var(--sc);
          background: color-mix(in srgb, var(--sc) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--sc) 30%, transparent);
          white-space: nowrap;
        }
        .tt-state {
          padding: 48px; text-align: center; color: var(--text-muted);
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius); font-size: 13px;
        }
        .tt-link { font-size: 12px; color: var(--primary); white-space: nowrap; opacity: 0.6; transition: opacity 0.15s; }
        .tt-link:hover { opacity: 1; }
      `}</style>
    </>
  )
}
