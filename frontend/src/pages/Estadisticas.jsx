import { useState, useEffect, useCallback } from 'react'

export default function Estadisticas() {
  const [stats, setStats] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats/')
      if (!res.ok) throw new Error('Error al cargar estadísticas')
      setStats(await res.json())
      setLastRefresh(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  const techList = stats?.by_technician ?? []
  const maxCount = techList[0]?.count ?? 1

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Estadísticas</h1>
        </div>
        <div className="page-header-right">
          {lastRefresh && (
            <span className="refresh-time">
              {lastRefresh.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </span>
          )}
          <button className="btn" onClick={fetchStats}>↻ Actualizar</button>
        </div>
      </div>
      {error && <div className="error-banner">⚠ {error}</div>}

      <div className="stat-grid">
        <StatCard
          icon="✓"
          label="Finalizados (histórico)"
          value={stats?.total_finalizados}
          sub="Resueltos + Cerrados"
          color="var(--green)"
          loading={loading}
        />
        <StatCard
          icon="◉"
          label="Abiertos actualmente"
          value={stats?.total_abiertos}
          sub="En curso + Pendientes"
          color="var(--primary)"
          loading={loading}
        />
      </div>

      {techList.length > 0 && (
        <div className="tech-section">
          <h2 className="section-title">Finalizados por técnico</h2>
          <div className="card tech-wrap">
            <table className="tech-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Técnico</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {techList.map((t, i) => (
                  <tr key={t.name}>
                    <td className="td-rank">{i + 1}</td>
                    <td className="td-name">{t.name}</td>
                    <td className="td-count">{t.count}</td>
                    <td className="td-bar">
                      <div className="bar-bg">
                        <div className="bar-fill" style={{ width: `${(t.count / maxCount) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && <p className="loading">Cargando estadísticas...</p>}

      <style>{`
        .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        .page-header-left { display: flex; align-items: center; gap: 12px; }
        .page-header-right { display: flex; align-items: center; gap: 12px; }
        .refresh-time { font-size: 12px; color: var(--text-muted); }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 32px; }

        .stat-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 24px;
          position: relative;
          overflow: hidden;
          transition: transform 0.25s, box-shadow 0.25s;
        }
        .stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 24px rgba(255,255,255,0.04); }
        .stat-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image: radial-gradient(circle at center, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 4px 4px;
          opacity: 0;
          transition: opacity 0.3s;
        }
        .stat-card:hover::before { opacity: 1; }

        .stat-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .stat-icon {
          width: 36px; height: 36px; border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; background: rgba(255,255,255,0.06);
          transition: background 0.3s;
        }
        .stat-card:hover .stat-icon { background: rgba(255,255,255,0.1); }
        .stat-status {
          font-size: 11px; font-weight: 500;
          padding: 3px 10px; border-radius: 20px;
          background: rgba(255,255,255,0.06);
          color: var(--text-muted);
          border: 1px solid var(--border);
        }
        .stat-value-row { margin-bottom: 4px; }
        .stat-value { font-size: 44px; font-weight: 800; line-height: 1; letter-spacing: -1px; }
        .stat-label { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 2px; }
        .stat-sub { font-size: 12px; color: var(--text-muted); }

        .tech-section { margin-top: 8px; }
        .section-title { font-size: 14px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
        .tech-wrap { overflow: hidden; }
        .tech-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .tech-table th { text-align: left; padding: 10px 16px; color: var(--text-muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid var(--border); }
        .tech-table td { padding: 11px 16px; border-top: 1px solid var(--border); }
        .tech-table tbody tr { transition: background 0.15s; }
        .tech-table tbody tr:hover { background: rgba(255,255,255,0.03); }
        .td-rank { color: var(--text-muted); font-size: 12px; width: 36px; }
        .td-name { font-weight: 500; }
        .td-count { font-weight: 700; color: var(--green); width: 60px; text-align: right; }
        .td-bar { width: 40%; padding-right: 20px; }
        .bar-bg { background: rgba(255,255,255,0.06); border-radius: 4px; height: 6px; }
        .bar-fill { background: var(--green); height: 6px; border-radius: 4px; transition: width 0.5s ease; min-width: 3px; }
      `}</style>
    </div>
  )
}

function StatCard({ icon, label, value, sub, color, loading }) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <div className="stat-icon" style={{ color }}>{icon}</div>
        <span className="stat-status">Histórico</span>
      </div>
      <div className="stat-value-row">
        <span className="stat-value" style={{ color }}>{loading ? '—' : (value ?? '—')}</span>
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  )
}
