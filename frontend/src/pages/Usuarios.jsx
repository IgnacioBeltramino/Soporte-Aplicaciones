import { useEffect, useState } from 'react'
import { TablaCargando } from '../components/Cargando'
import ConfigTelegram from '../components/ConfigTelegram'
import ConfigPerfiles from '../components/ConfigPerfiles'

function fechaCorta(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export default function Usuarios({ usuarioActual, onPermisosCambiados }) {
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(null)
  const [verTelegram, setVerTelegram] = useState(false)
  const [verPerfiles, setVerPerfiles] = useState(false)

  const cargar = async () => {
    try {
      const res = await fetch('/api/admin/usuarios', { credentials: 'include' })
      if (!res.ok) {
        setError('No se pudo cargar la lista de usuarios')
        return
      }
      setUsuarios(await res.json())
      setError('')
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const actualizar = async (id, campo, valor) => {
    setGuardando(id)
    setError('')
    try {
      const res = await fetch(`/api/admin/usuarios/${id}/${campo}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [campo]: valor }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || 'No se pudo guardar el cambio')
        return
      }
      await cargar()
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setGuardando(null)
    }
  }

  if (loading) return <TablaCargando filas={5} />

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h2 className="page-title" style={{ marginBottom: 0 }}>Usuarios y permisos</h2>
        </div>
        <div className="page-header-right">
          <button className="us-telegram" onClick={() => setVerTelegram(true)}>
            Configurar Telegram
          </button>
          <button className="us-telegram" onClick={() => setVerPerfiles(true)}>
            Perfiles
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {verTelegram && (
        <ConfigTelegram
          usuarios={usuarios}
          onCerrar={() => setVerTelegram(false)}
          onGuardado={cargar}
        />
      )}

      {verPerfiles && (
        <ConfigPerfiles
          onCerrar={() => setVerPerfiles(false)}
          onGuardado={onPermisosCambiados}
        />
      )}

      {/* Lo que hacia cada rol estaba explicado en tres renglones fijos debajo
          del titulo. Ademas de ocupar lugar, era una copia a mano de los
          permisos: al cambiarlos habia que acordarse de actualizar el texto, y
          ahora que se configuran desde Perfiles quedaria desactualizado el
          primer dia. Lo que ve cada rol se mira ahi, que es donde se cambia. */}
      <p className="us-ayuda">
        Los usuarios se crean solos la primera vez que ingresan. Los que figuran como
        <span className="us-pend"> sin ingresar </span>
        pertenecen al grupo Soporte Aplicaciones pero todavia no entraron al sistema.
      </p>

      <div className="card us-card">
        <table className="us-tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Usuario</th>
              <th>Rol</th>
              <th>Ultimo acceso</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map(u => {
              const esYo = u.glpi_user_id === usuarioActual.glpi_user_id
              const ocupado = guardando === u.glpi_user_id
              return (
                <tr key={u.glpi_user_id} className={u.habilitado ? '' : 'us-off'}>
                  <td>
                    {u.nombre}
                    {esYo && <span className="us-yo">vos</span>}
                    {u.fuera_del_grupo && <span className="us-fuera">fuera del grupo</span>}
                  </td>
                  <td className="us-mono">{u.username || '—'}</td>
                  <td>
                    <select
                      className="us-select"
                      value={u.rol}
                      disabled={!u.ingreso || ocupado}
                      onChange={(e) => actualizar(u.glpi_user_id, 'rol', e.target.value)}
                    >
                      <option value="pasante">pasante</option>
                      <option value="tecnico">tecnico</option>
                      <option value="jefe">jefe</option>
                    </select>
                  </td>
                  <td className="us-mono us-dim">
                    {u.ingreso ? fechaCorta(u.ultimo_acceso) : <span className="us-pend">sin ingresar</span>}
                  </td>
                  <td>
                    {u.ingreso ? (
                      <button
                        className={`us-btn${u.habilitado ? '' : ' off'}`}
                        disabled={ocupado || (esYo && u.habilitado)}
                        title={esYo && u.habilitado ? 'No podes deshabilitarte a vos mismo' : ''}
                        onClick={() => actualizar(u.glpi_user_id, 'habilitado', !u.habilitado)}
                      >
                        {u.habilitado ? 'Habilitado' : 'Deshabilitado'}
                      </button>
                    ) : (
                      <span className="us-dim">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <style>{`
        .us-telegram {
          flex-shrink: 0;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: var(--surface2);
          color: var(--text);
          font-family: inherit;
          font-size: var(--fs-base);
          font-weight: 500;
          padding: 8px 14px;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.16s ease-out;
        }
        .us-telegram:hover { opacity: 0.75; }

        .us-ayuda {
          font-size: var(--fs-base);
          color: var(--text-muted);
          margin-bottom: 18px;
          line-height: 1.5;
        }
        .us-card { padding: 4px 0; overflow-x: auto; }
        .us-card:hover { transform: none; }
        .us-tabla { width: 100%; border-collapse: collapse; font-size: var(--fs-base); }
        .us-tabla th {
          text-align: left;
          font-size: var(--fs-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          padding: 14px 18px;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        .us-tabla td {
          padding: 12px 18px;
          border-bottom: 1px solid var(--border);
          vertical-align: middle;
        }
        .us-tabla tbody tr:last-child td { border-bottom: none; }
        .us-off { opacity: 0.45; }
        .us-mono { font-variant-numeric: tabular-nums; }
        .us-dim { color: var(--text-muted); }
        .us-pend { color: var(--yellow); font-size: var(--fs-sm); }
        .us-yo, .us-fuera {
          margin-left: 8px;
          font-size: var(--fs-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 2px 7px;
          border-radius: var(--radius);
          background: var(--surface2);
          border: 1px solid var(--border);
          color: var(--text-muted);
        }
        .us-fuera { color: var(--yellow); }
        .us-select {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-family: inherit;
          font-size: var(--fs-sm);
          padding: 5px 9px;
          cursor: pointer;
        }
        .us-select:disabled { opacity: 0.4; cursor: default; }
        .us-select:focus { outline: none; border-color: var(--primary); }
        .us-btn {
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: var(--surface2);
          color: var(--green);
          font-family: inherit;
          font-size: var(--fs-sm);
          font-weight: 500;
          padding: 5px 11px;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.16s ease-out;
          white-space: nowrap;
        }
        .us-btn.off { color: var(--red-soft); }
        .us-btn:hover:not(:disabled) { opacity: 0.75; }
        .us-btn:disabled { opacity: 0.4; cursor: default; }
      `}</style>
    </>
  )
}
