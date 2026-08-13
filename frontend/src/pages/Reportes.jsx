import { useState, useEffect, useRef } from 'react'

const REPORTS = [
  {
    id: 'by_technician',
    label: 'Por Técnico',
    description: 'Todos los tickets de un técnico en el período seleccionado.',
    icon: '👤',
  },
  {
    id: 'by_area',
    label: 'Por Área',
    description: 'Todos los tickets asignados a un área/grupo en el período.',
    icon: '🏢',
  },
  {
    id: 'by_form',
    label: 'Por Formulario',
    description: 'Tickets generados desde un formulario del catálogo de servicios.',
    icon: '📋',
  },
]

const STATUS_COLORS = {
  'Nuevo': 'var(--blue)',
  'En curso': 'var(--blue)',
  'En curso (Plan.)': 'var(--blue)',
  'Pendiente': 'var(--yellow)',
  'Resuelto': 'var(--green)',
  'Cerrado': 'var(--green)',
}

function SearchSelect({ options, placeholder, value, onChange, loading }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const inputRef = useRef(null)

  // Limita a 80 resultados para no pintar miles de nodos
  const filtered = options
    .filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 80)

  const selected = options.find(o => String(o.id) === String(value))

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Foco garantizado cuando abre el dropdown
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        className="ss-trigger"
        onClick={() => { setOpen(o => !o); setQuery('') }}
      >
        {selected ? selected.name : (loading ? 'Cargando…' : placeholder)}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div className="ss-dropdown">
          <input
            ref={inputRef}
            className="ss-search"
            placeholder="Buscar…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="ss-list">
            {filtered.length === 0
              ? <div className="ss-empty">Sin resultados</div>
              : filtered.map(o => (
                <div
                  key={o.id}
                  className={`ss-option${String(o.id) === String(value) ? ' selected' : ''}`}
                  onMouseDown={() => { onChange(o); setOpen(false) }}
                >
                  {o.name}
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

function ReportCard({ report, onSelect }) {
  return (
    <div className="rp-card card" onClick={() => onSelect(report)}>
      <div className="rp-card-icon">{report.icon}</div>
      <div>
        <div className="rp-card-title">{report.label}</div>
        <div className="rp-card-desc">{report.description}</div>
      </div>
      <span className="rp-card-arrow">→</span>
    </div>
  )
}

function FilterPanel({ report, onBack }) {
  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)

  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [options, setOptions] = useState([])
  const [loadingOpts, setLoadingOpts] = useState(true)
  const [selected, setSelected] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const endpointMap = {
    by_technician: '/api/reports/technicians',
    by_area: '/api/reports/groups',
    by_form: '/api/reports/forms',
  }

  useEffect(() => {
    fetch(endpointMap[report.id])
      .then(r => r.json())
      .then(data => { setOptions(data); setLoadingOpts(false) })
      .catch(() => setLoadingOpts(false))
  }, [report.id])

  const handleGenerate = async () => {
    if (!selected) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
      if (report.id === 'by_technician') params.set('tech_id', selected.id)
      if (report.id === 'by_area')       params.set('group_id', selected.id)
      if (report.id === 'by_form')       params.set('form_id', selected.id)

      const endpointData = {
        by_technician: '/api/reports/by-technician',
        by_area:       '/api/reports/by-area',
        by_form:       '/api/reports/by-form',
      }

      const res = await fetch(`${endpointData[report.id]}?${params}`)
      if (!res.ok) throw new Error('Error al obtener datos')
      const data = await res.json()
      setResult(data)

      // PDF download
      const pdfParams = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
      if (report.id === 'by_technician') { pdfParams.set('tech_id', selected.id); pdfParams.set('tech_name', selected.name) }
      if (report.id === 'by_area')       { pdfParams.set('group_id', selected.id); pdfParams.set('group_name', selected.name) }
      if (report.id === 'by_form')       { pdfParams.set('form_id', selected.id) }

      const pdfEndpoints = {
        by_technician: '/api/reports/pdf/by-technician',
        by_area:       '/api/reports/pdf/by-area',
        by_form:       '/api/reports/pdf/by-form',
      }

      const pdfRes = await fetch(`${pdfEndpoints[report.id]}?${pdfParams}`)
      if (pdfRes.ok) {
        const blob = await pdfRes.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `reporte_${report.id}_${dateFrom}_${dateTo}.pdf`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const filterLabel = {
    by_technician: 'Técnico',
    by_area: 'Área',
    by_form: 'Formulario',
  }[report.id]

  const formatDate = (d) => {
    if (!d) return '—'
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button className="btn" onClick={onBack} style={{ padding: '6px 0' }}>← Volver</button>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Reporte {report.label}</h1>
      </div>

      <div className="rp-filters card">
        <div className="rp-filter-row">
          <div className="rp-filter-group">
            <label className="rp-label">{filterLabel}</label>
            <SearchSelect
              options={options}
              placeholder={`Seleccioná un ${filterLabel.toLowerCase()}…`}
              value={selected?.id}
              onChange={setSelected}
              loading={loadingOpts}
            />
          </div>
          <div className="rp-filter-group">
            <label className="rp-label">Desde</label>
            <input type="date" className="rp-date-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="rp-filter-group">
            <label className="rp-label">Hasta</label>
            <input type="date" className="rp-date-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <button
            className="rp-generate-btn"
            disabled={!selected || loading}
            onClick={handleGenerate}
          >
            {loading ? 'Generando…' : 'Generar reporte'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">⚠ {error}</div>}

      {result && (
        <div className="rp-result">
          <div className="rp-summary">
            <div className="rp-stat">
              <span className="rp-stat-n" style={{ color: 'var(--blue)' }}>{result.summary.open}</span>
              <span className="rp-stat-l">Abiertos</span>
            </div>
            <div className="rp-stat-sep" />
            <div className="rp-stat">
              <span className="rp-stat-n" style={{ color: 'var(--yellow)' }}>{result.summary.pending}</span>
              <span className="rp-stat-l">Pendientes</span>
            </div>
            <div className="rp-stat-sep" />
            <div className="rp-stat">
              <span className="rp-stat-n" style={{ color: 'var(--green)' }}>{result.summary.closed}</span>
              <span className="rp-stat-l">Cerrados</span>
            </div>
            <div className="rp-stat-sep" />
            <div className="rp-stat">
              <span className="rp-stat-n">{result.summary.total}</span>
              <span className="rp-stat-l">Total</span>
            </div>
          </div>

          {result.tickets.length === 0 ? (
            <div className="loading">Sin tickets en el período seleccionado</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Título</th>
                    <th>Estado</th>
                    <th>Técnico</th>
                    <th>Solicitante</th>
                    <th>Apertura</th>
                    <th>Vencimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tickets.map(t => (
                    <tr key={t.id}>
                      <td>
                        <a
                          href={`https://tickets.msm.gov.ar/index.php?redirect=/front/ticket.form.php?id=${t.id}`}
                          target="_blank" rel="noreferrer"
                          className="rp-link"
                        >
                          #{t.id}
                        </a>
                      </td>
                      <td style={{ maxWidth: 320 }}>{t.title}</td>
                      <td>
                        <span className="rp-status" style={{ color: STATUS_COLORS[t.status_label] || 'var(--text-muted)' }}>
                          {t.status_label}
                        </span>
                      </td>
                      <td>{t.tech}</td>
                      <td>{t.requester}</td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{formatDate(t.opened_at?.slice(0, 10))}</td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{formatDate(t.due_at?.slice(0, 10))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <style>{`
        .rp-filters { padding: 20px; margin-bottom: 20px; }
        .rp-filter-row { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
        .rp-filter-group { display: flex; flex-direction: column; gap: 6px; min-width: 200px; }
        .rp-label { font-size: 11px; color: var(--text-muted); font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; }
        .rp-date-input {
          background: var(--surface2); border: 1px solid var(--border);
          border-radius: 8px; color: var(--text); font-family: inherit;
          font-size: 13px; padding: 7px 10px; outline: none;
          transition: border-color 0.15s;
        }
        .rp-date-input:focus { border-color: #404040; }
        .rp-generate-btn {
          background: var(--text); color: var(--bg); border: none;
          border-radius: 8px; font-family: inherit; font-size: 13px;
          font-weight: 600; padding: 8px 20px; cursor: pointer;
          transition: opacity 0.15s; white-space: nowrap; align-self: flex-end;
        }
        .rp-generate-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .rp-generate-btn:not(:disabled):hover { opacity: 0.85; }

        /* SearchSelect */
        .ss-trigger {
          display: flex; align-items: center; gap: 8px;
          background: var(--surface2); border: 1px solid var(--border);
          border-radius: 8px; color: var(--text); font-family: inherit;
          font-size: 13px; padding: 7px 10px; cursor: pointer;
          transition: border-color 0.15s; min-width: 220px;
        }
        .ss-trigger:hover { border-color: #404040; }
        .ss-dropdown {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 8px; z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          overflow: hidden;
        }
        .ss-search {
          width: 100%; background: var(--surface2); border: none;
          border-bottom: 1px solid var(--border); color: var(--text);
          font-family: inherit; font-size: 13px; padding: 8px 12px; outline: none;
        }
        .ss-list { max-height: 200px; overflow-y: auto; }
        .ss-option {
          padding: 8px 12px; font-size: 13px; cursor: pointer;
          color: var(--text-muted); transition: background 0.1s, color 0.1s;
        }
        .ss-option:hover, .ss-option.selected { background: var(--surface2); color: var(--text); }
        .ss-empty { padding: 10px 12px; font-size: 13px; color: var(--text-muted); }

        /* Result */
        .rp-result { display: flex; flex-direction: column; gap: 16px; }
        .rp-summary {
          display: flex; align-items: center; gap: 0;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 20px 0;
        }
        .rp-stat { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
        .rp-stat-n { font-size: 32px; font-weight: 700; line-height: 1; }
        .rp-stat-l { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .rp-stat-sep { width: 1px; height: 40px; background: var(--border); }

        /* Table */
        .rp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .rp-table th {
          text-align: left; font-size: 11px; color: var(--text-muted);
          font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px;
          padding: 8px 12px; border-bottom: 1px solid var(--border);
          background: var(--surface); white-space: nowrap;
        }
        .rp-table td {
          padding: 9px 12px; border-bottom: 1px solid rgba(255,255,255,0.04);
          color: var(--text); vertical-align: middle;
        }
        .rp-table tr:last-child td { border-bottom: none; }
        .rp-table tbody tr:hover td { background: rgba(255,255,255,0.02); }
        .rp-link { color: var(--text-muted); text-decoration: none; }
        .rp-link:hover { color: var(--text); }
        .rp-status { font-weight: 600; font-size: 12px; }
      `}</style>
    </div>
  )
}

export default function Reportes() {
  const [activeReport, setActiveReport] = useState(null)

  if (activeReport) {
    return <FilterPanel report={activeReport} onBack={() => setActiveReport(null)} />
  }

  return (
    <div>
      <h1 className="page-title">Reportes</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24, marginTop: -16 }}>
        Seleccioná el tipo de reporte para configurar los filtros y generar el PDF.
      </p>
      <div className="rp-list">
        {REPORTS.map(r => <ReportCard key={r.id} report={r} onSelect={setActiveReport} />)}
      </div>
      <style>{`
        .rp-list { display: flex; flex-direction: column; gap: 12px; max-width: 640px; }
        .rp-card {
          display: flex; align-items: center; gap: 16px;
          padding: 18px 20px; cursor: pointer;
        }
        .rp-card-icon { font-size: 22px; flex-shrink: 0; }
        .rp-card-title { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 3px; }
        .rp-card-desc  { font-size: 12px; color: var(--text-muted); }
        .rp-card-arrow { margin-left: auto; color: var(--text-muted); font-size: 16px; transition: transform 0.15s; }
        .rp-card:hover .rp-card-arrow { transform: translateX(4px); color: var(--text); }
      `}</style>
    </div>
  )
}
