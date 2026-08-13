const STATUS_LABELS = {
  1: 'Nuevo',
  2: 'En proceso',
  3: 'Planificado',
  4: 'En espera',
  5: 'Resuelto',
  6: 'Cerrado',
}

function Card({ label, value, color, loading }) {
  return (
    <div className="stat-card" style={{ '--accent-color': color }}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{loading ? '—' : value ?? '—'}</span>
    </div>
  )
}

export default function StatsCards({ stats, loading }) {
  const techList = stats?.by_technician ?? []

  return (
    <div className="stats-section">
      <div className="stat-cards-row">
        <Card label="Total Cerrados (histórico)" value={stats?.total_closed} color="var(--green)" loading={loading} />
        <Card label="Resueltos" value={stats?.total_solved} color="var(--primary)" loading={loading} />
        <Card label="Cerrados" value={stats?.total_closed_only} color="var(--yellow)" loading={loading} />
      </div>

      {techList.length > 0 && (
        <div className="tech-table-wrap">
          <h3 className="tech-table-title">Tickets Resueltos + Cerrados por Técnico</h3>
          <table className="tech-table">
            <thead>
              <tr>
                <th>Técnico</th>
                <th>Cantidad</th>
                <th>Barra</th>
              </tr>
            </thead>
            <tbody>
              {techList.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td className="tech-count">{t.count}</td>
                  <td className="bar-cell">
                    <div
                      className="bar"
                      style={{ width: `${(t.count / techList[0].count) * 100}%` }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .stats-section { margin-bottom: 8px; }
        .stat-cards-row { display: flex; gap: 16px; flex-wrap: wrap; }
        .stat-card {
          flex: 1 1 180px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-top: 3px solid var(--accent-color);
          border-radius: var(--radius);
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .stat-label { font-size: 12px; color: var(--text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
        .stat-value { font-size: 36px; font-weight: 700; color: var(--accent-color); line-height: 1; }
        .tech-table-wrap {
          margin-top: 20px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          overflow: hidden;
        }
        .tech-table-title { font-size: 13px; font-weight: 600; color: var(--text-muted); padding: 14px 18px 10px; border-bottom: 1px solid var(--border); }
        .tech-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .tech-table th { text-align: left; padding: 10px 18px; color: var(--text-muted); font-weight: 500; font-size: 11px; text-transform: uppercase; background: var(--surface2); }
        .tech-table td { padding: 10px 18px; border-top: 1px solid var(--border); }
        .tech-count { font-weight: 700; color: var(--primary); text-align: center; }
        .bar-cell { width: 40%; }
        .bar { height: 8px; background: var(--primary); border-radius: 4px; min-width: 4px; transition: width 0.4s ease; }
      `}</style>
    </div>
  )
}
