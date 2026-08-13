import { useState, useEffect, useCallback } from 'react'
import { TablaCargando } from '../components/Cargando'

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
          <h1 className="page-title" style={{ marginBottom: 0 }}>Histórico</h1>
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
          label="Finalizados"
          value={stats?.total_finalizados}
          sub="Resueltos + cerrados · histórico"
          color="var(--green)"
          loading={loading}
        />
        <StatCard
          icon="◉"
          label="Abiertos"
          value={stats?.total_abiertos}
          sub="En curso + pendientes · ahora"
          color="var(--text)"
          loading={loading}
        />
      </div>

      {techList.length > 0 && (
        <div className="tech-section">
          <h2 className="section-title">Finalizados por técnico</h2>
          <div className="tech-wrap">
            <table className="tech-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Técnico</th>
                  <th className="th-count">Total</th>
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

      {/* El esqueleto va con la forma de lo que viene: una tabla, y con su
          titulo ya puesto. Antes eran cuatro tarjetas apiladas debajo de los
          dos paneles, que no se parecian a nada de lo que despues aparecia. */}
      {loading && (
        <div className="tech-section">
          <h2 className="section-title">Finalizados por técnico</h2>
          <TablaCargando filas={6} />
        </div>
      )}

      <style>{`
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-bottom: 24px; }

        /* El fondo, el borde y el hover ya los trae .card. Estaban copiados aca
           con un punteado apenas distinto (0.025 contra 0.02): dos tarjetas de
           la misma app que no reaccionaban igual al mouse. */
        .stat-card { padding: 18px 20px; }

        /* Primero que cosa es, despues cuanto. Antes el numero venia arriba y la
           etiqueta abajo, asi que habia que leer el 1.284 sin saber todavia de
           que era. La etiqueta baja al escalon mas chico y el numero se queda
           solo con el peso: la jerarquia la marca el tamaño, no el orden. */
        .stat-top { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; }
        .stat-icon {
          width: 24px; height: 24px; border-radius: var(--radius-sm);
          display: grid; place-items: center;
          font-size: 12px;
          background: var(--surface2); border: 1px solid var(--border);
        }
        .stat-label {
          font-size: var(--fs-xs); font-weight: 700; color: var(--text-dim);
          text-transform: uppercase; letter-spacing: 0.8px;
        }
        .stat-value { font-size: var(--fs-display); font-weight: 800; line-height: 1; display: block; }
        .stat-sub { font-size: var(--fs-sm); color: var(--text-muted); margin-top: 6px; }

        .tech-section { margin-top: 8px; }
        /* Mismo tratamiento que los titulos de columna de Novedades y que los
           encabezados de tabla: es una etiqueta de zona, no un titulo. En 14px
           y mayusculas pesaba mas que los nombres de la tabla que encabeza. */
        .section-title {
          font-size: var(--fs-xs); font-weight: 700; color: var(--text-dim);
          text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px;
        }
        /* Plano a proposito: usaba .card, y una tabla que se levanta dos pixeles
           cuando le pasas el mouse por encima no se parece a ninguna otra tabla
           de la app. */
        .tech-wrap {
          overflow: hidden;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
        }
        .tech-table { width: 100%; border-collapse: collapse; font-size: var(--fs-base); }
        .tech-table th {
          text-align: left; padding: 10px 14px;
          color: var(--text-dim); font-weight: 600;
          font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.8px;
          border-bottom: 1px solid var(--border);
        }
        .tech-table td { padding: 8px 14px; border-top: 1px solid var(--border); }
        .tech-table tbody tr { transition: background 0.15s; }
        .tech-table tbody tr:hover { background: rgba(255,255,255,0.03); }
        /* El encabezado sigue a su columna: los numeros van a la derecha y el
           "Total" se habia quedado a la izquierda. */
        .th-count { text-align: right; }
        .td-rank { color: var(--text-dim); font-size: var(--fs-xs); width: 34px; }
        .td-name { font-weight: 600; }
        /* El numero en blanco y no en verde: la barra de al lado ya es verde y
           dice lo mismo. Con las dos cosas pintadas, treinta filas gritan igual
           y no se distingue quien cerro mas. */
        .td-count { font-weight: 700; width: 56px; text-align: right; }
        .td-bar { width: 40%; padding-right: 20px; }
        .bar-bg { background: rgba(255,255,255,0.06); border-radius: var(--radius-sm); height: 6px; }
        .bar-fill { background: var(--green); height: 6px; border-radius: var(--radius-sm); transition: width 0.5s ease; min-width: 3px; }
      `}</style>
    </div>
  )
}

function StatCard({ icon, label, value, sub, color, loading }) {
  return (
    <div className="card stat-card">
      <div className="stat-top">
        <span className="stat-icon" style={{ color }}>{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <span className="stat-value" style={{ color }}>{loading ? '—' : (value ?? '—')}</span>
      <div className="stat-sub">{sub}</div>
    </div>
  )
}
