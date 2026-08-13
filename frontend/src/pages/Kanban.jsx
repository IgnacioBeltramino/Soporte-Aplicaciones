import { useCallback, useEffect, useRef, useState } from 'react'
import { TarjetasCargando } from '../components/Cargando'

// Tableros de tareas del area. Dos: el del grupo, que comparte el equipo, y el
// personal de cada uno, que es privado.
//
// Arrastrar usa el drag and drop nativo de HTML5 y no una libreria: la app no
// tiene ninguna de esto y no vale la pena sumar una dependencia para un modulo
// interno de escritorio. Como con el dedo no anda, cada tarjeta tiene ademas un
// menu para mandarla a otra columna, que encima sirve cuando la lista es larga.

const REFRESCO_MS = 15000   // el tablero del grupo lo toca mas de uno

const TABLEROS = [
  { id: 'grupo', label: 'Del grupo' },
  { id: 'personal', label: 'Mis tareas' },
]

// Paleta para las iniciales del responsable. El color sale del id, asi que a
// una misma persona le toca siempre el mismo y se la reconoce de un vistazo.
const COLORES = ['var(--estado-nuevo)', 'var(--estado-espera)', 'var(--estado-resuelto)', 'var(--estado-proceso)', 'var(--red-soft)', 'var(--estado-planificado)']

function iniciales(nombre) {
  const partes = (nombre || '').trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  return (partes[0][0] + (partes[1]?.[0] || '')).toUpperCase()
}

function Responsable({ id, nombre }) {
  return (
    <span
      className="kb-avatar"
      style={{ '--av': COLORES[id % COLORES.length] }}
      title={nombre || 'Sin asignar'}
    >
      {iniciales(nombre)}
    </span>
  )
}

function Tarjeta({
  tarjeta, indice, columnas, columnaActual, gente, puedeEditar,
  onEditar, onBorrar, onMover, onAsignar, onArrastrar, onHover,
}) {
  // El menu va con position fixed y coordenadas propias, no pegado a la tarjeta:
  // la lista de tarjetas scrollea (overflow-y), y ahi adentro un menu absolute
  // se recorta contra el borde de la columna.
  const [menu, setMenu] = useState(null)

  const abrirMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    // Si esta muy abajo, se abre para arriba y no se sale de la pantalla.
    const alto = 80 + (columnas.length + gente.length) * 30
    const haciaArriba = r.bottom + alto > window.innerHeight
    setMenu({
      top: haciaArriba ? Math.max(8, r.top - alto) : r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
    })
  }

  // El detalle se guarda como texto y cada linea se muestra como una viñeta.
  const lineas = (tarjeta.detalle || '').split('\n').map(l => l.trim()).filter(Boolean)

  return (
    <div
      className="kb-tarjeta"
      draggable={puedeEditar && !menu}
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'move'
        onArrastrar({ id: tarjeta.id, columnaId: columnaActual, indice })
      }}
      onDragEnd={() => onArrastrar(null)}
      onDragOver={e => {
        if (!puedeEditar) return
        // Segun de que lado del medio este el puntero, la tarjeta cae antes o
        // despues de esta. Sin esto solo se podria soltar al principio.
        e.preventDefault()
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        onHover(e.clientY < r.top + r.height / 2 ? indice : indice + 1)
      }}
    >
      <div className="kb-t-top">
        <span className="kb-t-titulo">{tarjeta.titulo}</span>

        {tarjeta.responsable && (
          <Responsable id={tarjeta.responsable} nombre={tarjeta.responsable_nombre} />
        )}

        {puedeEditar && (
          <>
            <button
              className="kb-t-puntos"
              // Sin esto el navegador toma el clic como el arranque de un
              // arrastre de la tarjeta y el menu no llega a abrirse.
              draggable={false}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); menu ? setMenu(null) : abrirMenu(e) }}
              aria-label="Opciones"
            >
              ⋯
            </button>

            {menu && (
              <>
                <div className="kb-menu-fondo" onClick={() => setMenu(null)} />
                <div className="kb-menu" style={{ top: menu.top, right: menu.right }}>
                  <button onClick={() => { setMenu(null); onEditar(tarjeta) }}>Editar</button>

                  {gente.length > 0 && (
                    <>
                      <div className="kb-menu-titulo">Asignar a</div>
                      {gente.map(p => (
                        <button
                          key={p.glpi_user_id}
                          className={tarjeta.responsable === p.glpi_user_id ? 'kb-menu-actual' : ''}
                          onClick={() => { setMenu(null); onAsignar(tarjeta.id, p.glpi_user_id) }}
                        >
                          {p.nombre}
                        </button>
                      ))}
                      {tarjeta.responsable && (
                        <button onClick={() => { setMenu(null); onAsignar(tarjeta.id, null) }}>
                          Sin asignar
                        </button>
                      )}
                    </>
                  )}

                  {columnas.length > 1 && <div className="kb-menu-titulo">Mover a</div>}
                  {columnas.filter(c => c.id !== columnaActual).map(c => (
                    <button key={c.id} onClick={() => { setMenu(null); onMover(tarjeta.id, c.id, 0) }}>
                      {c.nombre}
                    </button>
                  ))}

                  <button className="kb-menu-rojo" onClick={() => { setMenu(null); onBorrar(tarjeta) }}>
                    Borrar
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {lineas.length > 0 && (
        <ul className="kb-t-detalle">
          {lineas.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </div>
  )
}

function Columna({ columna, columnas, gente, puedeEditar, acciones, arrastrando }) {
  const [posDrop, setPosDrop] = useState(null)
  const [agregando, setAgregando] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [renombrando, setRenombrando] = useState(false)
  const [nombre, setNombre] = useState(columna.nombre)

  const agregar = async () => {
    const t = titulo.trim()
    if (!t) { setAgregando(false); return }
    await acciones.crearTarjeta(columna.id, t)
    setTitulo('')
    setAgregando(false)
  }

  const renombrar = async () => {
    const n = nombre.trim()
    setRenombrando(false)
    if (!n || n === columna.nombre) { setNombre(columna.nombre); return }
    await acciones.renombrarColumna(columna.id, n)
  }

  const soltar = () => {
    if (!arrastrando) return
    let destino = posDrop ?? columna.tarjetas.length
    // Al mover dentro de la misma columna, el backend primero saca la tarjeta
    // de la lista: si venia de mas arriba, todo lo de abajo corrio un lugar.
    if (arrastrando.columnaId === columna.id && arrastrando.indice < destino) destino -= 1
    setPosDrop(null)
    acciones.moverTarjeta(arrastrando.id, columna.id, destino)
  }

  return (
    <div
      className={`kb-columna${posDrop !== null ? ' kb-encima' : ''}`}
      onDragOver={e => {
        if (!puedeEditar || !arrastrando) return
        e.preventDefault()
        // Soltar en el hueco de abajo manda la tarjeta al final.
        setPosDrop(columna.tarjetas.length)
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPosDrop(null)
      }}
      onDrop={e => { e.preventDefault(); soltar() }}
    >
      <div className="kb-c-header">
        {renombrando ? (
          <input
            className="kb-c-input"
            value={nombre}
            autoFocus
            onChange={e => setNombre(e.target.value)}
            onBlur={renombrar}
            onKeyDown={e => {
              if (e.key === 'Enter') renombrar()
              if (e.key === 'Escape') { setNombre(columna.nombre); setRenombrando(false) }
            }}
          />
        ) : (
          <span
            className="kb-c-nombre"
            onDoubleClick={() => puedeEditar && setRenombrando(true)}
            title={puedeEditar ? 'Doble clic para renombrar' : ''}
          >
            {columna.nombre}
          </span>
        )}
        <span className="kb-c-cuenta">{columna.tarjetas.length}</span>
        {puedeEditar && (
          <button
            className="kb-c-x"
            onClick={() => acciones.borrarColumna(columna)}
            title="Borrar columna"
          >
            ×
          </button>
        )}
      </div>

      <div className="kb-c-lista">
        {columna.tarjetas.map((t, i) => (
          <div key={t.id}>
            {posDrop === i && <div className="kb-linea" />}
            <Tarjeta
              tarjeta={t}
              indice={i}
              columnas={columnas}
              columnaActual={columna.id}
              gente={gente}
              puedeEditar={puedeEditar}
              onEditar={acciones.editarTarjeta}
              onBorrar={acciones.borrarTarjeta}
              onMover={acciones.moverTarjeta}
              onAsignar={acciones.asignar}
              onArrastrar={acciones.setArrastrando}
              onHover={setPosDrop}
            />
          </div>
        ))}
        {posDrop === columna.tarjetas.length && columna.tarjetas.length > 0 && (
          <div className="kb-linea" />
        )}
      </div>

      {puedeEditar && (
        agregando ? (
          <div className="kb-nueva">
            <textarea
              className="kb-nueva-input"
              value={titulo}
              autoFocus
              rows={2}
              placeholder="Titulo de la tarea"
              onChange={e => setTitulo(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); agregar() }
                if (e.key === 'Escape') { setTitulo(''); setAgregando(false) }
              }}
            />
            <div className="kb-nueva-btns">
              <button className="kb-btn kb-btn-ok" onClick={agregar}>Agregar</button>
              <button className="kb-btn" onClick={() => { setTitulo(''); setAgregando(false) }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="kb-agregar" onClick={() => setAgregando(true)}>+ Agregar tarjeta</button>
        )
      )}
    </div>
  )
}

// Confirmacion de borrado, en la pagina y no con el window.confirm del
// navegador. El nativo bloquea la pestaña entera, no se parece en nada al
// resto de la app y no puede mostrar el detalle de lo que se lleva puesto:
// borrar una columna con tarjetas adentro no es lo mismo que borrar una vacia,
// y eso hay que poder decirlo antes y no despues.
//
// El foco arranca en Cancelar a proposito: si alguien viene tecleando y
// aparece esto, Enter tiene que ser la salida sin daño.
function ConfirmarBorrado({ tipo, item, onConfirmar, onCancelar }) {
  const cancelarRef = useRef(null)

  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onCancelar() }
    window.addEventListener('keydown', esc)
    cancelarRef.current?.focus()
    return () => window.removeEventListener('keydown', esc)
  }, [onCancelar])

  const esTarjeta = tipo === 'tarjeta'
  const cuantas = esTarjeta ? 0 : (item.tarjetas?.length || 0)

  return (
    <div className="kb-modal-fondo" onClick={onCancelar}>
      <div className="kb-modal kb-modal-confirmar" onClick={e => e.stopPropagation()}>
        <div className="kb-modal-top">
          <h3>{esTarjeta ? 'Borrar tarea' : 'Borrar columna'}</h3>
        </div>

        <p className="kb-confirmar-texto">
          Se va a borrar <strong>{esTarjeta ? item.titulo : item.nombre}</strong>.
        </p>

        {cuantas > 0 && (
          <p className="kb-confirmar-aviso">
            La columna tiene {cuantas} {cuantas === 1 ? 'tarea' : 'tareas'} adentro
            y se {cuantas === 1 ? 'borra' : 'borran'} con ella.
          </p>
        )}

        <p className="kb-confirmar-nota">Esto no se puede deshacer.</p>

        <div className="kb-modal-btns">
          <button className="kb-btn" ref={cancelarRef} onClick={onCancelar}>Cancelar</button>
          <button className="kb-btn kb-btn-borrar" onClick={onConfirmar}>
            {esTarjeta ? 'Borrar tarea' : 'Borrar columna'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalTarjeta({ tarjeta, gente, onGuardar, onCerrar }) {
  const [titulo, setTitulo] = useState(tarjeta.titulo)
  const [detalle, setDetalle] = useState(tarjeta.detalle || '')
  const [responsable, setResponsable] = useState(tarjeta.responsable || '')

  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCerrar])

  return (
    <div className="kb-modal-fondo" onClick={onCerrar}>
      <div className="kb-modal" onClick={e => e.stopPropagation()}>
        <div className="kb-modal-top">
          <h3>Editar tarea</h3>
          <button className="kb-t-puntos" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        <label className="kb-label">Titulo</label>
        <input className="kb-input" value={titulo} autoFocus onChange={e => setTitulo(e.target.value)} />

        {gente.length > 0 && (
          <>
            <label className="kb-label">Responsable</label>
            <select
              className="kb-input"
              value={responsable}
              onChange={e => setResponsable(e.target.value)}
            >
              <option value="">Sin asignar</option>
              {gente.map(p => (
                <option key={p.glpi_user_id} value={p.glpi_user_id}>{p.nombre}</option>
              ))}
            </select>
          </>
        )}

        <label className="kb-label">Detalle</label>
        <textarea
          className="kb-input kb-textarea"
          value={detalle}
          rows={6}
          placeholder="Una linea por punto"
          onChange={e => setDetalle(e.target.value)}
        />
        <div className="kb-ayuda">Cada linea se muestra como una viñeta en la tarjeta.</div>

        <div className="kb-modal-btns">
          <button
            className="kb-btn kb-btn-ok"
            disabled={!titulo.trim()}
            onClick={() => onGuardar(tarjeta.id, titulo.trim(), detalle, responsable ? Number(responsable) : null)}
          >
            Guardar
          </button>
          <button className="kb-btn" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

export default function Kanban() {
  const [tablero, setTablero] = useState('grupo')
  const [columnas, setColumnas] = useState([])
  const [gente, setGente] = useState([])
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [editando, setEditando] = useState(null)
  const [nuevaColumna, setNuevaColumna] = useState(false)
  const [nombreColumna, setNombreColumna] = useState('')
  // Lo que se esta por borrar, esperando confirmacion:
  // { tipo: 'tarjeta' | 'columna', item }
  const [confirmando, setConfirmando] = useState(null)
  const [arrastrando, setArrastrandoEstado] = useState(null)
  const arrastrandoRef = useRef(null)

  const cargar = useCallback(async (cual) => {
    try {
      const res = await fetch(`/api/kanban/${cual}`, { credentials: 'include' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.detail || 'No se pudo cargar el tablero')
        return
      }
      const data = await res.json()
      setColumnas(data.columnas)
      setGente(data.gente || [])
      setPuedeEditar(data.puede_editar)
      setError('')
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    setCargando(true)
    cargar(tablero)
  }, [tablero, cargar])

  // El del grupo lo tocan varios, asi que se refresca solo. El personal no lo
  // toca nadie mas, no tiene sentido pedirlo cada 15 segundos.
  useEffect(() => {
    if (tablero !== 'grupo') return
    const id = setInterval(() => cargar('grupo'), REFRESCO_MS)
    return () => clearInterval(id)
  }, [tablero, cargar])

  // Toda accion devuelve el tablero completo ya actualizado: alcanza con pisar
  // el estado y no hay que volver a pedirlo.
  const llamar = async (url, opciones = {}) => {
    setError('')
    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...opciones,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError((data && data.detail) || 'No se pudo guardar el cambio')
        return false
      }
      if (Array.isArray(data)) setColumnas(data)
      else if (data && data.columnas) setColumnas(data.columnas)
      return true
    } catch {
      setError('No se pudo conectar con el servidor')
      return false
    }
  }

  const setArrastrando = (info) => { arrastrandoRef.current = info; setArrastrandoEstado(info) }

  const acciones = {
    setArrastrando,
    crearTarjeta: (columnaId, titulo) =>
      llamar(`/api/kanban/columnas/${columnaId}/tarjetas`, {
        method: 'POST',
        body: JSON.stringify({ titulo }),
      }),
    editarTarjeta: (tarjeta) => setEditando(tarjeta),
    // Borrar no llama al backend: abre la confirmacion. El DELETE lo hace
    // confirmarBorrado cuando el usuario dice que si.
    borrarTarjeta: (tarjeta) => setConfirmando({ tipo: 'tarjeta', item: tarjeta }),
    asignar: (tarjetaId, responsable) =>
      llamar(`/api/kanban/tarjetas/${tarjetaId}/asignar`, {
        method: 'PUT',
        body: JSON.stringify({ responsable }),
      }),
    moverTarjeta: (tarjetaId, columnaId, posicion = 0) => {
      setArrastrando(null)
      return llamar(`/api/kanban/tarjetas/${tarjetaId}/mover`, {
        method: 'PUT',
        body: JSON.stringify({ columna_id: columnaId, posicion }),
      })
    },
    renombrarColumna: (columnaId, nombre) =>
      llamar(`/api/kanban/columnas/${columnaId}`, {
        method: 'PUT',
        body: JSON.stringify({ nombre }),
      }),
    borrarColumna: (columna) => setConfirmando({ tipo: 'columna', item: columna }),
  }

  const confirmarBorrado = async () => {
    if (!confirmando) return
    const { tipo, item } = confirmando
    const url = tipo === 'tarjeta'
      ? `/api/kanban/tarjetas/${item.id}`
      : `/api/kanban/columnas/${item.id}`
    setConfirmando(null)
    await llamar(url, { method: 'DELETE' })
  }

  const guardarTarjeta = async (id, titulo, detalle, responsable) => {
    const ok = await llamar(`/api/kanban/tarjetas/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ titulo, detalle, responsable }),
    })
    if (ok) setEditando(null)
  }

  const agregarColumna = async () => {
    const n = nombreColumna.trim()
    setNuevaColumna(false)
    setNombreColumna('')
    if (!n) return
    await llamar(`/api/kanban/${tablero}/columnas`, {
      method: 'POST',
      body: JSON.stringify({ nombre: n }),
    })
  }

  return (
    <div className="kb-page">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Tareas</h1>
          <div className="kb-tabs">
            {TABLEROS.map(t => (
              <button
                key={t.id}
                className={`kb-tab${tablero === t.id ? ' activo' : ''}`}
                onClick={() => setTablero(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="page-header-right">
          {tablero === 'personal' && <span className="kb-privado">Solo lo ves vos</span>}
          {tablero === 'grupo' && !puedeEditar && <span className="kb-privado">Solo lectura</span>}
          <button className="kb-btn" onClick={() => cargar(tablero)}>↻ Actualizar</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {cargando ? (
        // Tres columnas de mentira: el tablero no salta cuando llegan las de verdad.
        <div className="kb-tablero">
          {[0, 1, 2].map(i => (
            <div className="kb-columna" key={i}>
              <TarjetasCargando cantidad={2} />
            </div>
          ))}
        </div>
      ) : (
        <div className="kb-tablero">
          {columnas.map(c => (
            <Columna
              key={c.id}
              columna={c}
              columnas={columnas}
              gente={gente}
              puedeEditar={puedeEditar}
              acciones={acciones}
              arrastrando={arrastrando}
            />
          ))}

          {puedeEditar && (
            <div className="kb-columna kb-columna-nueva">
              {nuevaColumna ? (
                <input
                  className="kb-c-input"
                  value={nombreColumna}
                  autoFocus
                  placeholder="Nombre de la columna"
                  onChange={e => setNombreColumna(e.target.value)}
                  onBlur={agregarColumna}
                  onKeyDown={e => {
                    if (e.key === 'Enter') agregarColumna()
                    if (e.key === 'Escape') { setNombreColumna(''); setNuevaColumna(false) }
                  }}
                />
              ) : (
                <button className="kb-agregar" onClick={() => setNuevaColumna(true)}>
                  + Agregar columna
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {editando && (
        <ModalTarjeta
          tarjeta={editando}
          gente={gente}
          onGuardar={guardarTarjeta}
          onCerrar={() => setEditando(null)}
        />
      )}

      {confirmando && (
        <ConfirmarBorrado
          tipo={confirmando.tipo}
          item={confirmando.item}
          onConfirmar={confirmarBorrado}
          onCancelar={() => setConfirmando(null)}
        />
      )}

      <style>{`

        .kb-tabs { display: flex; gap: 3px; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius); padding: 3px; }
        .kb-tab {
          border: none; background: none; border-radius: var(--radius-sm);
          color: var(--text-muted); font-family: inherit; font-size: var(--fs-base); font-weight: 600;
          padding: 6px 14px; cursor: pointer; transition: background 0.15s, color 0.15s, transform 0.16s ease-out;
        }
        .kb-tab:hover { color: var(--text); }
        .kb-tab.activo { background: var(--surface); color: var(--text); }

        .kb-privado { font-size: var(--fs-xs); color: var(--text-dim); }

        /* El tablero scrollea a lo ancho: las columnas no se achican para entrar */
        .kb-tablero {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          overflow-x: auto;
          padding-bottom: 14px;
        }

        .kb-columna {
          flex: 0 0 290px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: calc(100vh - 210px);
        }
        .kb-encima { border-color: var(--primary); }
        .kb-columna-nueva { background: none; border-style: dashed; }

        /* La linea corta el encabezado de las tarjetas: el nombre de la columna
           es el rotulo del monton, no la primera de la pila. Va del mismo gris
           que los bordes de la app y pegada al titulo (9px), asi el aire que
           queda por debajo es el gap de la columna y se lee de que lado cae. */
        .kb-c-header {
          display: flex; align-items: center; gap: 8px;
          padding-bottom: 9px;
          border-bottom: 1px solid var(--border);
        }
        /* Etiqueta en mayusculas como los titulos de columna de Novedades, pero
           en --text: en un tablero de varias columnas, saber en cual estas
           parado importa mas que en una lista de dos.
         *
         * Sube otro escalon, de 12 a 13px, y queda del mismo tamaño que el
         * titulo de la tarjeta. No compiten igual: la columna va en mayusculas,
         * en 700 y con las letras separadas, y el titulo de la tarjeta en
         * minusculas y 600. Con la misma altura de letra, lo que distingue a
         * cada uno es la forma, que es lo que se lee de lejos en un tablero
         * con cinco columnas al lado. */
        .kb-c-nombre {
          flex: 1; font-size: var(--fs-base); font-weight: 700; color: var(--text);
          text-transform: uppercase; letter-spacing: 0.8px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        /* --radius-sm y no --radius: es una pastilla, como el contador del
           sidebar y los badges. */
        .kb-c-cuenta {
          font-size: var(--fs-xs); color: var(--text-dim);
          background: var(--surface2); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 1px 7px;
        }
        .kb-c-x {
          background: none; border: none; color: var(--text-dim);
          font-size: 15px; line-height: 1; padding: 0 2px; cursor: pointer;
        }
        .kb-c-x:hover { color: var(--red-soft); }
        .kb-c-input {
          flex: 1; width: 100%;
          background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-sm);
          color: var(--text); font-family: inherit; font-size: var(--fs-sm); padding: 5px 8px;
        }
        .kb-c-input:focus { outline: none; border-color: var(--primary); }

        .kb-c-lista { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }

        /* Marca donde va a caer la tarjeta que se esta arrastrando */
        .kb-linea {
          height: 2px; margin: 3px 0;
          background: var(--primary); border-radius: 2px;
        }

        .kb-tarjeta {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 10px 11px;
          cursor: grab;
          /* El borde se aclara al pasar por encima, como las tarjetas de
             Novedades. En algo que se arrastra, que la tarjeta acuse el mouse
             antes de que la agarres ayuda a saber que se puede. */
          transition: border-color 0.15s ease;
        }
        .kb-tarjeta:hover { border-color: #333; }
        .kb-tarjeta:active { cursor: grabbing; }
        .kb-t-top { display: flex; align-items: flex-start; gap: 6px; }
        /* 600 y no 700: con el nombre de la columna ya en su propio escalon, el
           titulo no necesita gritar para ser lo primero que se lee. */
        .kb-t-titulo {
          flex: 1; font-size: var(--fs-base); font-weight: 600; color: var(--text);
          line-height: 1.45;
        }
        /* El area que responde al clic tiene que ser la que se ve. Antes la caja
           medía lo que el glifo (unos 12x14) y el ⋯ se dibuja abajo del centro,
           asi que habia que apuntar arriba de los puntitos para embocarle.
           Con tamaño fijo y el contenido centrado, se toca donde se ve. */
        .kb-t-puntos {
          flex-shrink: 0;
          display: grid;
          place-items: center;
          width: 26px; height: 26px;
          /* Los negativos evitan que el boton mas grande corra el titulo. */
          margin: -4px -5px -4px 0;
          padding: 0;
          background: none; border: none; border-radius: var(--radius-sm);
          color: var(--text-muted);
          font-size: 15px; line-height: 1;
          cursor: pointer;
          transition: background 0.15s, color 0.15s, transform 0.16s ease-out;
        }
        .kb-t-puntos:hover { color: var(--text); background: rgba(255,255,255,0.07); }

        .kb-avatar {
          flex-shrink: 0;
          display: grid; place-items: center;
          width: 21px; height: 21px;
          border-radius: 50%;
          font-size: var(--fs-xs); font-weight: 700; letter-spacing: 0.3px;
          color: var(--av);
          background: color-mix(in srgb, var(--av) 15%, transparent);
          border: 1px solid color-mix(in srgb, var(--av) 40%, transparent);
        }

        .kb-t-detalle { margin: 8px 0 0; padding-left: 16px; }
        .kb-t-detalle li { font-size: var(--fs-xs); color: var(--text-dim); line-height: 1.55; }

        .kb-menu-fondo { position: fixed; inset: 0; z-index: 300; }
        /* fixed y no absolute: adentro de .kb-c-lista, que scrollea, un menu
           absolute se recorta contra el borde de la columna. */
        .kb-menu {
          position: fixed; z-index: 301;
          min-width: 190px; max-height: 70vh; overflow-y: auto;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 5px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.45);
          display: flex; flex-direction: column;
        }
        .kb-menu button {
          text-align: left; background: none; border: none; border-radius: var(--radius-sm);
          color: var(--text); font-family: inherit; font-size: var(--fs-sm);
          padding: 7px 9px; cursor: pointer;
        }
        .kb-menu button:hover { background: var(--surface2); }
        /* "Borrar" es texto, no un icono: le toca el rojo suave. */
        .kb-menu-rojo { color: var(--red-soft) !important; }
        .kb-menu-actual { color: var(--primary) !important; }
        .kb-menu-titulo {
          font-size: var(--fs-xs); font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.8px; color: var(--text-dim);
          padding: 8px 9px 4px;
        }

        .kb-agregar {
          background: none; border: none; border-radius: var(--radius-sm);
          color: var(--text-muted); font-family: inherit; font-size: var(--fs-sm);
          padding: 8px; text-align: left; cursor: pointer; width: 100%;
        }
        .kb-agregar:hover { background: var(--surface2); color: var(--text); }

        .kb-nueva { display: flex; flex-direction: column; gap: 7px; }
        .kb-nueva-input {
          width: 100%;
          background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-sm);
          color: var(--text); font-family: inherit; font-size: var(--fs-sm);
          padding: 8px 10px; resize: vertical;
        }
        .kb-nueva-input:focus { outline: none; border-color: var(--primary); }
        .kb-nueva-btns { display: flex; gap: 7px; }

        .kb-btn {
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          background: var(--surface2); color: var(--text);
          font-family: inherit; font-size: var(--fs-sm); font-weight: 500;
          padding: 6px 12px; cursor: pointer; transition: opacity 0.15s, transform 0.16s ease-out;
          white-space: nowrap;
        }
        .kb-btn:hover:not(:disabled) { opacity: 0.75; }
        .kb-btn:disabled { opacity: 0.35; cursor: default; }
        .kb-btn-ok { border-color: var(--primary); color: var(--primary); }

        /* Igual que el modal de Telegram: el fondo entra por opacidad y la
           ventana ademas crece desde 0.97. Antes aparecia todo de un frame al
           otro. */
        .kb-modal-fondo {
          position: fixed; inset: 0; z-index: 300;
          background: rgba(0,0,0,0.55); backdrop-filter: blur(3px);
          display: flex; align-items: center; justify-content: center; padding: 24px;
          opacity: 1;
          transition: opacity 0.2s cubic-bezier(0.23, 1, 0.32, 1);
        }
        @starting-style {
          .kb-modal-fondo { opacity: 0; }
        }
        .kb-modal {
          width: 100%; max-width: 520px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 20px 22px 22px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
          opacity: 1;
          transform: scale(1);
          transition: opacity 0.2s cubic-bezier(0.23, 1, 0.32, 1),
                      transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
        }
        @starting-style {
          .kb-modal { opacity: 0; transform: scale(0.97); }
        }
        .kb-modal-top { display: flex; align-items: center; margin-bottom: 14px; }
        .kb-modal-top h3 { flex: 1; margin: 0; font-size: var(--fs-xl); font-weight: 700; color: var(--text); }
        .kb-label { display: block; font-size: var(--fs-sm); color: var(--text-muted); margin: 12px 0 6px; }
        .kb-input {
          width: 100%;
          background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-sm);
          color: var(--text); font-family: inherit; font-size: var(--fs-base);
          padding: 8px 10px; line-height: 1.5;
        }
        .kb-input:focus { outline: none; border-color: var(--primary); }
        .kb-textarea { resize: vertical; }
        .kb-ayuda { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 6px; }
        .kb-modal-btns { display: flex; gap: 8px; margin-top: 18px; }

        /* Confirmacion de borrado */
        .kb-modal-confirmar { max-width: 420px; }
        .kb-confirmar-texto { font-size: var(--fs-base); color: var(--text); line-height: 1.55; margin: 0; }
        .kb-confirmar-texto strong { font-weight: 700; }
        /* El aviso de que se lleva puesto lo de adentro es lo unico que hace
           falta destacar: el resto ya se entiende. */
        .kb-confirmar-aviso {
          font-size: var(--fs-sm); color: var(--red-soft); line-height: 1.55;
          margin: 10px 0 0;
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          background: color-mix(in srgb, var(--red) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
        }
        .kb-confirmar-nota { font-size: var(--fs-xs); color: var(--text-dim); margin: 10px 0 0; }
        /* El boton que borra se distingue del que cancela, pero sin ser lo
           primero que el ojo agarra: el rojo va en el texto y el borde, no de
           fondo. Que la salida sin daño sea la mas facil de apretar. */
        .kb-btn-borrar { border-color: color-mix(in srgb, var(--red) 45%, transparent); color: var(--red-soft); }
        .kb-btn-borrar:hover:not(:disabled) { background: color-mix(in srgb, var(--red) 12%, transparent); opacity: 1; }
      `}</style>
    </div>
  )
}
