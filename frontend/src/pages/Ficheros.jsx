import { useEffect, useState } from 'react'
import { TablaCargando } from '../components/Cargando'
import VolverInicio from '../components/VolverInicio'

function fechaCorta(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const VACIO = { nombre: '', ip: '' }

const ANCHO = 62

// Mismo formato que el reporte del Menu de Soporte, para que al equipo le
// resulte familiar y sea legible en cualquier editor de texto.
function armarInforme(ficheros) {
  const ahora = new Date()
  const fecha = ahora.toLocaleDateString('es-AR') + ' ' +
    ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

  const online  = ficheros.filter(f => f.estado === 'online').length
  const offline = ficheros.filter(f => f.estado === 'offline').length
  const sinIp   = ficheros.filter(f => f.estado === 'sin_ip').length

  const sep = '='.repeat(ANCHO)
  const linea = '-'.repeat(ANCHO)
  const L = []

  L.push(sep)
  L.push('  ESTADO DE FICHEROS - Soporte Aplicaciones')
  L.push(`  Fecha: ${fecha}`)
  L.push(sep)
  L.push('')
  L.push(`  ${'Fichero'.padEnd(34)}${'IP'.padEnd(17)}Estado`)
  L.push(linea)

  for (const f of ficheros) {
    const estado = f.estado === 'online'  ? 'ONLINE'
                 : f.estado === 'offline' ? 'OFFLINE'
                 : 'sin IP'
    L.push(`  ${(f.nombre || '').slice(0, 33).padEnd(34)}${(f.ip || '-').padEnd(17)}${estado}`)
  }

  L.push(linea)
  L.push('')
  L.push(`  Total: ${ficheros.length}   Online: ${online}   Offline: ${offline}   Sin IP: ${sinIp}`)
  L.push(sep)

  return L.join('\r\n')
}

function descargarTxt(ficheros) {
  const ahora = new Date()
  const dd = String(ahora.getDate()).padStart(2, '0')
  const mm = String(ahora.getMonth() + 1).padStart(2, '0')
  const nombre = `Estado ficheros ${dd}-${mm}-${ahora.getFullYear()}.txt`

  const blob = new Blob([armarInforme(ficheros)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

export default function Ficheros({ onVolver }) {
  const [ficheros, setFicheros] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [escaneando, setEscaneando] = useState(false)
  const [editando, setEditando] = useState(null)   // id, o 'nuevo'
  const [form, setForm] = useState(VACIO)
  const [borrando, setBorrando] = useState(null)
  const [ultimoChequeo, setUltimoChequeo] = useState('')

  const cargar = async () => {
    try {
      const res = await fetch('/api/ficheros', { credentials: 'include' })
      if (!res.ok) {
        setError('No se pudo cargar la lista de ficheros')
        return
      }
      setFicheros(await res.json())
      setError('')
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const escanear = async () => {
    setEscaneando(true)
    setError('')
    try {
      const res = await fetch('/api/ficheros/estado', { credentials: 'include' })
      if (!res.ok) {
        setError('No se pudo consultar el estado')
        return
      }
      setFicheros(await res.json())
      setUltimoChequeo(
        new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
      )
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setEscaneando(false)
    }
  }

  const guardar = async (e) => {
    e.preventDefault()
    const nuevo = editando === 'nuevo'
    try {
      const res = await fetch(
        nuevo ? '/api/ficheros' : `/api/ficheros/${editando}`,
        {
          method: nuevo ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ nombre: form.nombre, ip: form.ip || null }),
        }
      )
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail?.[0]?.msg || data.detail || 'No se pudo guardar')
        return
      }
      setEditando(null)
      setForm(VACIO)
      await cargar()
    } catch {
      setError('No se pudo conectar con el servidor')
    }
  }

  const borrar = async (id) => {
    try {
      const res = await fetch(`/api/ficheros/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        setError('No se pudo eliminar')
        return
      }
      setBorrando(null)
      await cargar()
    } catch {
      setError('No se pudo conectar con el servidor')
    }
  }

  const abrirNuevo = () => { setEditando('nuevo'); setForm(VACIO); setError('') }
  const abrirEditar = (f) => {
    setEditando(f.id)
    setForm({ nombre: f.nombre, ip: f.ip || '' })
    setError('')
  }

  const conEstado = ficheros.some(f => f.estado)
  const online  = ficheros.filter(f => f.estado === 'online').length
  const offline = ficheros.filter(f => f.estado === 'offline').length
  const sinIp   = ficheros.filter(f => f.estado === 'sin_ip').length

  if (loading) return <TablaCargando filas={6} />

  return (
    <>
      <VolverInicio onVolver={onVolver} />

      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Ficheros</h1>
          <span className="badge">{ficheros.length} total</span>
        </div>
        <div className="page-header-right">
          <button className="fi-alta" onClick={abrirNuevo}>+ Agregar</button>
        </div>
      </div>

      {/* Panel de estado: es la funcion mas usada, asi que va destacada */}
      <div className="card fi-panel">
        <div className="fi-panel-info">
          <div className="fi-panel-t">Estado de los ficheros</div>
          {conEstado ? (
            <div className="fi-panel-cifras">
              <span className="fi-cifra ok">{online}<small>online</small></span>
              <span className="fi-cifra off">{offline}<small>offline</small></span>
              {sinIp > 0 && <span className="fi-cifra dim">{sinIp}<small>sin IP</small></span>}
              <span className="fi-panel-hora">último chequeo {ultimoChequeo}</span>
            </div>
          ) : (
            <div className="fi-panel-sub">
              Hace un ping a cada fichero con IP para ver cuáles responden.
            </div>
          )}
        </div>
        <div className="fi-panel-acciones">
          {conEstado && (
            <button className="fi-descarga" onClick={() => descargarTxt(ficheros)}>
              ↓ Descargar informe
            </button>
          )}
          <button className="fi-chequear" onClick={escanear} disabled={escaneando}>
            {escaneando ? 'Escaneando…' : conEstado ? '↻ Volver a chequear' : '↻ Chequear estado'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {editando !== null && (
        <form className="card fi-form" onSubmit={guardar}>
          <div className="fi-form-campos">
            <div>
              <label className="fi-label">Nombre</label>
              <input
                className="fi-input"
                value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Nombre del fichero"
                autoFocus
              />
            </div>
            <div>
              <label className="fi-label">IP o host <span className="fi-dim">(opcional)</span></label>
              <input
                className="fi-input"
                value={form.ip}
                onChange={e => setForm({ ...form, ip: e.target.value })}
                placeholder="192.168.1.10"
              />
            </div>
          </div>
          <div className="fi-form-acciones">
            <button type="submit" className="fi-alta">
              {editando === 'nuevo' ? 'Agregar' : 'Guardar'}
            </button>
            <button type="button" className="btn" onClick={() => setEditando(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="card fi-card">
        <table className="fi-tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>IP</th>
              {conEstado && <th>Estado</th>}
              <th>Modificado por</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ficheros.length === 0 && (
              <tr>
                <td colSpan={conEstado ? 6 : 5} className="fi-vacio">
                  No hay ficheros cargados todavía.
                </td>
              </tr>
            )}
            {ficheros.map(f => (
              <tr key={f.id}>
                <td className="fi-nombre">{f.nombre}</td>
                <td className="fi-mono fi-dim">{f.ip || <span className="fi-dim">sin IP</span>}</td>
                {conEstado && (
                  <td>
                    {f.estado === 'online'  && <span className="fi-estado ok">online</span>}
                    {f.estado === 'offline' && <span className="fi-estado off">offline</span>}
                    {f.estado === 'sin_ip'  && <span className="fi-dim">—</span>}
                  </td>
                )}
                <td className="fi-dim">{f.modificado_por_nombre || '—'}</td>
                <td className="fi-dim fi-mono">{fechaCorta(f.modificado)}</td>
                <td className="fi-acciones">
                  {borrando === f.id ? (
                    <>
                      <span className="fi-confirm">¿Eliminar?</span>
                      <button className="fi-btn peligro" onClick={() => borrar(f.id)}>Sí</button>
                      <button className="fi-btn" onClick={() => setBorrando(null)}>No</button>
                    </>
                  ) : (
                    <>
                      <button className="fi-btn" onClick={() => abrirEditar(f)}>Editar</button>
                      <button className="fi-btn" onClick={() => setBorrando(f.id)}>Eliminar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
        /* Panel de estado */
        .fi-panel {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
          padding: 18px 22px;
          margin-bottom: 20px;
        }
        .fi-panel:hover { transform: none; }
        .fi-panel-info { min-width: 0; }
        .fi-panel-t {
          font-size: var(--fs-lg);
          font-weight: 600;
          color: var(--text);
          margin-bottom: 7px;
        }
        .fi-panel-sub { font-size: var(--fs-sm); color: var(--text-muted); }
        .fi-panel-cifras { display: flex; align-items: baseline; gap: 20px; flex-wrap: wrap; }
        /* Sin tracking negativo, por lo mismo que los titulos: en monoespaciada
           el ancho ya es fijo y apretarlo pelea con el tipo. */
        .fi-cifra {
          display: flex;
          align-items: baseline;
          gap: 6px;
          font-size: var(--fs-2xl);
          font-weight: 700;
        }
        .fi-cifra small {
          font-size: var(--fs-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-dim);
        }
        .fi-cifra.ok  { color: var(--green); }
        .fi-cifra.off { color: var(--red-soft); }
        .fi-cifra.dim { color: var(--text-dim); }
        .fi-panel-hora { font-size: var(--fs-xs); color: var(--text-dim); }
        .fi-panel-acciones { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

        .fi-chequear {
          background: var(--surface2);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-family: inherit;
          font-size: var(--fs-base);
          font-weight: 600;
          padding: 10px 18px;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s, border-color 0.15s, transform 0.16s ease-out;
        }
        .fi-chequear:hover:not(:disabled) {
          background: rgba(255,255,255,0.09);
          border-color: var(--text-muted);
        }
        .fi-chequear:disabled { opacity: 0.55; cursor: default; }

        .fi-descarga {
          background: none;
          color: var(--text-muted);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-family: inherit;
          font-size: var(--fs-base);
          font-weight: 500;
          padding: 10px 14px;
          cursor: pointer;
          white-space: nowrap;
          transition: color 0.15s, border-color 0.15s, transform 0.16s ease-out;
        }
        .fi-descarga:hover { color: var(--text); border-color: var(--text-muted); }

        .fi-alta {
          background: var(--primary);
          color: var(--primary-fg);
          border: none;
          border-radius: var(--radius-sm);
          font-family: inherit;
          font-size: var(--fs-sm);
          font-weight: 600;
          padding: 7px 14px;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.16s ease-out;
        }
        .fi-alta:hover { opacity: 0.85; }

        .fi-form { padding: 18px; margin-bottom: 18px; }
        .fi-form:hover { transform: none; }
        .fi-form-campos { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
        .fi-form-campos > div { flex: 1 1 220px; display: flex; flex-direction: column; }
        .fi-form-acciones { display: flex; align-items: center; gap: 10px; }
        .fi-label { font-size: var(--fs-sm); color: var(--text-muted); margin-bottom: 6px; }
        .fi-input {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-family: inherit;
          font-size: var(--fs-base);
          padding: 8px 11px;
        }
        .fi-input:focus { outline: none; border-color: var(--primary); }

        .fi-card { padding: 4px 0; overflow-x: auto; }
        .fi-card:hover { transform: none; }
        .fi-tabla { width: 100%; border-collapse: collapse; font-size: var(--fs-base); }
        /* Mismo tratamiento de etiqueta que el resto de las tablas: el escalon
           mas bajo, el gris mas apagado y tracking de 0.8. */
        .fi-tabla th {
          text-align: left;
          font-size: var(--fs-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-dim);
          padding: 11px 14px;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        .fi-tabla td { padding: 9px 14px; border-bottom: 1px solid var(--border); }
        .fi-tabla tbody tr:last-child td { border-bottom: none; }
        /* El nombre es lo que se viene a leer; el resto de la fila es contexto. */
        .fi-nombre { font-weight: 600; color: var(--text); }
        .fi-vacio { text-align: center; color: var(--text-muted); padding: 28px 0; }
        .fi-mono { font-variant-numeric: tabular-nums; }
        .fi-dim { color: var(--text-dim); font-size: var(--fs-xs); }

        .fi-estado {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: var(--fs-xs);
          font-weight: 600;
        }
        .fi-estado::before {
          content: '';
          width: 7px; height: 7px;
          border-radius: 50%;
          background: currentColor;
        }
        .fi-estado.ok  { color: var(--green); }
        /* --red pleno vibra cuando es texto y no un icono: va el suave. */
        .fi-estado.off { color: var(--red-soft); }

        .fi-acciones { text-align: right; white-space: nowrap; }
        .fi-btn {
          border: none;
          background: none;
          color: var(--text-dim);
          font-family: inherit;
          font-size: var(--fs-sm);
          padding: 4px 7px;
          cursor: pointer;
          transition: color 0.15s, transform 0.16s ease-out;
        }
        .fi-btn:hover { color: var(--text); }
        .fi-btn.peligro { color: var(--red-soft); }
        .fi-confirm { font-size: var(--fs-sm); color: var(--text-muted); margin-right: 4px; }
      `}</style>
    </>
  )
}
