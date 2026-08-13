import { useEffect, useState } from 'react'
import { TablaCargando } from '../components/Cargando'
import VolverInicio from '../components/VolverInicio'

function fechaCorta(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

const VACIO = { nombre: '', nro_pc: '' }

// Totems y nodos son la misma ficha con distinto nombre, asi que una sola
// pantalla con dos solapas en vez de dos paginas iguales.
const TIPOS = [
  { id: 'totem', plural: 'Totems', singular: 'totem' },
  { id: 'nodo',  plural: 'Nodos',  singular: 'nodo'  },
]

export default function Eflow({ onVolver }) {
  const [equipos, setEquipos] = useState([])
  const [tipo, setTipo] = useState('totem')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(null)   // id, o 'nuevo'
  const [form, setForm] = useState(VACIO)
  const [borrando, setBorrando] = useState(null)
  const [busqueda, setBusqueda] = useState('')

  const actual = TIPOS.find(t => t.id === tipo)

  // Traemos todo de una sola vez y filtramos en el cliente: son unas pocas
  // decenas de equipos, no vale la pena ir al servidor por cada solapa.
  const cargar = async () => {
    try {
      const res = await fetch('/api/eflow', { credentials: 'include' })
      if (!res.ok) {
        setError('No se pudo cargar la lista de equipos')
        return
      }
      setEquipos(await res.json())
      setError('')
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const guardar = async (e) => {
    e.preventDefault()
    const nuevo = editando === 'nuevo'
    const cuerpo = { nombre: form.nombre, nro_pc: form.nro_pc || null }
    if (nuevo) cuerpo.tipo = tipo

    try {
      const res = await fetch(
        nuevo ? '/api/eflow' : `/api/eflow/${editando}`,
        {
          method: nuevo ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(cuerpo),
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
      const res = await fetch(`/api/eflow/${id}`, {
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
  const abrirEditar = (eq) => {
    setEditando(eq.id)
    setForm({ nombre: eq.nombre, nro_pc: eq.nro_pc || '' })
    setError('')
  }

  const cambiarTipo = (id) => {
    setTipo(id)
    setEditando(null)
    setBorrando(null)
    setError('')
  }

  const delTipo = equipos.filter(eq => eq.tipo === tipo)
  const filtro = busqueda.trim().toLowerCase()
  const lista = filtro
    ? delTipo.filter(eq =>
        (eq.nombre || '').toLowerCase().includes(filtro) ||
        (eq.nro_pc || '').toLowerCase().includes(filtro))
    : delTipo

  if (loading) return <TablaCargando filas={6} />

  return (
    <>
      <VolverInicio onVolver={onVolver} />

      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>EFLOW</h1>
          <span className="badge">{delTipo.length} {actual.plural.toLowerCase()}</span>
        </div>
        <div className="page-header-right">
          <input
            className="ef-buscar"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar…"
          />
          <button className="ef-alta" onClick={abrirNuevo}>+ Agregar {actual.singular}</button>
        </div>
      </div>

      <div className="ef-solapas">
        {TIPOS.map(t => (
          <button
            key={t.id}
            className={`ef-solapa${tipo === t.id ? ' activa' : ''}`}
            onClick={() => cambiarTipo(t.id)}
          >
            {t.plural}
            <span className="ef-solapa-n">
              {equipos.filter(eq => eq.tipo === t.id).length}
            </span>
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {editando !== null && (
        <form className="card ef-form" onSubmit={guardar}>
          <div className="ef-form-campos">
            <div>
              <label className="ef-label">Nombre</label>
              <input
                className="ef-input"
                value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder={`Nombre del ${actual.singular}`}
                autoFocus
              />
            </div>
            <div>
              <label className="ef-label">Nro de PC <span className="ef-dim">(opcional)</span></label>
              <input
                className="ef-input"
                value={form.nro_pc}
                onChange={e => setForm({ ...form, nro_pc: e.target.value })}
                placeholder="PC-1234"
              />
            </div>
          </div>
          <div className="ef-form-acciones">
            <button type="submit" className="ef-alta">
              {editando === 'nuevo' ? 'Agregar' : 'Guardar'}
            </button>
            <button type="button" className="btn" onClick={() => setEditando(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="card ef-card">
        <table className="ef-tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Nro de PC</th>
              <th>Modificado por</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && (
              <tr>
                <td colSpan={5} className="ef-vacio">
                  {delTipo.length === 0
                    ? `No hay ${actual.plural.toLowerCase()} cargados todavía.`
                    : 'Ningún equipo coincide con la búsqueda.'}
                </td>
              </tr>
            )}
            {lista.map(eq => (
              <tr key={eq.id}>
                <td>{eq.nombre}</td>
                <td className="ef-mono">{eq.nro_pc || <span className="ef-dim">—</span>}</td>
                <td className="ef-dim">{eq.modificado_por_nombre || '—'}</td>
                <td className="ef-dim ef-mono">{fechaCorta(eq.modificado)}</td>
                <td className="ef-acciones">
                  {borrando === eq.id ? (
                    <>
                      <span className="ef-confirm">¿Eliminar?</span>
                      <button className="ef-btn peligro" onClick={() => borrar(eq.id)}>Sí</button>
                      <button className="ef-btn" onClick={() => setBorrando(null)}>No</button>
                    </>
                  ) : (
                    <>
                      <button className="ef-btn" onClick={() => abrirEditar(eq)}>Editar</button>
                      <button className="ef-btn" onClick={() => setBorrando(eq.id)}>Eliminar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`

        .ef-solapas { display: flex; gap: 6px; margin-bottom: 18px; }
        .ef-solapa {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: none;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          font-family: inherit;
          font-size: var(--fs-base);
          font-weight: 600;
          padding: 8px 16px;
          cursor: pointer;
          transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.16s ease-out;
        }
        .ef-solapa:hover { color: var(--text); border-color: var(--text-muted); }
        .ef-solapa.activa {
          background: rgba(255,255,255,0.07);
          color: var(--text);
          border-color: var(--text-muted);
        }
        .ef-solapa-n {
          font-size: var(--fs-xs);
          font-weight: 700;
          padding: 1px 7px;
          border-radius: var(--radius);
          background: var(--surface2);
          border: 1px solid var(--border);
        }

        .ef-buscar {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-family: inherit;
          font-size: var(--fs-base);
          padding: 7px 11px;
          width: 180px;
        }
        .ef-buscar:focus { outline: none; border-color: var(--primary); }

        .ef-alta {
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
        .ef-alta:hover { opacity: 0.85; }

        .ef-form { padding: 18px; margin-bottom: 18px; }
        .ef-form:hover { transform: none; }
        .ef-form-campos { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
        .ef-form-campos > div { flex: 1 1 220px; display: flex; flex-direction: column; }
        .ef-form-acciones { display: flex; align-items: center; gap: 10px; }
        .ef-label { font-size: var(--fs-sm); color: var(--text-muted); margin-bottom: 6px; }
        .ef-input {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-family: inherit;
          font-size: var(--fs-base);
          padding: 8px 11px;
        }
        .ef-input:focus { outline: none; border-color: var(--primary); }

        .ef-card { padding: 4px 0; overflow-x: auto; }
        .ef-card:hover { transform: none; }
        .ef-tabla { width: 100%; border-collapse: collapse; font-size: var(--fs-base); }
        .ef-tabla th {
          text-align: left;
          font-size: var(--fs-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          padding: 13px 18px;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        .ef-tabla td { padding: 11px 18px; border-bottom: 1px solid var(--border); }
        .ef-tabla tbody tr:last-child td { border-bottom: none; }
        .ef-vacio { text-align: center; color: var(--text-muted); padding: 28px 0; }
        .ef-mono { font-variant-numeric: tabular-nums; }
        .ef-dim { color: var(--text-muted); }

        .ef-acciones { text-align: right; white-space: nowrap; }
        .ef-btn {
          border: none;
          background: none;
          color: var(--text-muted);
          font-family: inherit;
          font-size: var(--fs-sm);
          padding: 4px 7px;
          cursor: pointer;
          transition: color 0.15s, transform 0.16s ease-out;
        }
        .ef-btn:hover { color: var(--text); }
        .ef-btn.peligro { color: var(--red-soft); }
        .ef-confirm { font-size: var(--fs-sm); color: var(--text-muted); margin-right: 4px; }
      `}</style>
    </>
  )
}
