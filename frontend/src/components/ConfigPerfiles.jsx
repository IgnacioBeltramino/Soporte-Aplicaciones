import { useEffect, useState } from 'react'

// Que ve cada perfil.
//
// Antes esto estaba escrito en dos lugares del codigo (PAGINAS en rutas.js y
// las dependencias de main.py), asi que sumarle una pantalla al pasante era
// tocar el fuente y reiniciar el backend. Ahora sale de la tabla de permisos y
// se cambia desde aca.
//
// El catalogo de secciones lo manda el backend en vez de estar escrito aca: si
// algun dia se agrega una seccion, aparece sola en esta pantalla.
//
// Una grilla y no un desplegable por rol: lo que uno viene a hacer es comparar
// ("el tecnico ve esto y el pasante no"), y eso se lee de una sola mirada
// cuando los tres estan uno al lado del otro.

export default function ConfigPerfiles({ onCerrar, onGuardado }) {
  const [secciones, setSecciones] = useState([])
  const [permisos, setPermisos] = useState(null)     // { rol: [seccion, ...] }
  const [original, setOriginal] = useState(null)
  const [seccionAdmin, setSeccionAdmin] = useState('usuarios')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)

  useEffect(() => {
    const alTecla = (e) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', alTecla)
    return () => window.removeEventListener('keydown', alTecla)
  }, [onCerrar])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch('/api/admin/perfiles', { credentials: 'include' })
        const data = await res.json()
        if (!vivo) return
        if (!res.ok) {
          setError(data.detail || 'No se pudieron cargar los perfiles')
          return
        }
        setSecciones(data.secciones)
        setPermisos(data.permisos)
        setOriginal(data.permisos)
        setSeccionAdmin(data.seccion_admin)
      } catch {
        if (vivo) setError('No se pudo conectar con el servidor')
      }
    })()
    return () => { vivo = false }
  }, [])

  const roles = permisos ? Object.keys(permisos) : []

  // El jefe no puede perder la seccion de administracion: es de donde se
  // configura esto. El backend lo vuelve a poner igual; aca se muestra tildado
  // y sin poder tocarse, para que se entienda que es a proposito y no un error.
  const trabado = (rol, seccion) => rol === 'jefe' && seccion === seccionAdmin

  const alternar = (rol, seccion) => {
    if (trabado(rol, seccion)) return
    setGuardado(false)
    setPermisos(prev => {
      const tiene = prev[rol].includes(seccion)
      return {
        ...prev,
        [rol]: tiene ? prev[rol].filter(s => s !== seccion) : [...prev[rol], seccion],
      }
    })
  }

  const hayCambios = permisos && original && roles.some(
    rol => [...permisos[rol]].sort().join() !== [...original[rol]].sort().join()
  )

  const guardar = async () => {
    setGuardando(true)
    setError('')
    try {
      // Solo los roles que cambiaron: no tiene sentido reescribir los tres.
      const cambiados = roles.filter(
        rol => [...permisos[rol]].sort().join() !== [...original[rol]].sort().join()
      )
      for (const rol of cambiados) {
        const res = await fetch(`/api/admin/perfiles/${rol}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ secciones: permisos[rol] }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.detail || `No se pudo guardar el perfil ${rol}`)
          return
        }
        // El backend devuelve como quedo de verdad (por ejemplo, con Usuarios
        // repuesto en el jefe), asi que se toma eso y no lo que se mando.
        setPermisos(prev => ({ ...prev, [rol]: data.secciones }))
        setOriginal(prev => ({ ...prev, [rol]: data.secciones }))
      }
      setGuardado(true)
      // El menu del usuario que esta mirando puede haber cambiado recien ahora.
      if (onGuardado) await onGuardado()
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="cp-fondo" onClick={onCerrar}>
      <div className="cp" onClick={e => e.stopPropagation()}>
        <div className="cp-header">
          <h3 className="cp-titulo">Perfiles</h3>
          <button className="cp-x" onClick={onCerrar} aria-label="Cerrar">&times;</button>
        </div>

        <p className="cp-ayuda">
          Qué ve cada perfil. El cambio vale para todos los usuarios que tengan ese
          rol, y se aplica cuando vuelven a cargar la página.
        </p>

        {error && <div className="error-banner">{error}</div>}

        {!permisos ? (
          <div className="cp-cargando">Cargando…</div>
        ) : (
          <>
            <div className="cp-grilla" style={{ '--roles': roles.length }}>
              <div className="cp-fila cp-cabecera">
                <div className="cp-seccion cp-th">Sección</div>
                {roles.map(rol => (
                  <div key={rol} className="cp-celda cp-th">{rol}</div>
                ))}
              </div>

              {secciones.map(s => (
                <div key={s.id} className="cp-fila">
                  <div className="cp-seccion">{s.label}</div>
                  {roles.map(rol => {
                    const fijo = trabado(rol, s.id)
                    return (
                      <label
                        key={rol}
                        className={`cp-celda${fijo ? ' cp-fijo' : ''}`}
                        title={fijo ? 'El jefe no puede perder esta sección: es donde se configuran los permisos' : ''}
                      >
                        <input
                          type="checkbox"
                          checked={permisos[rol].includes(s.id)}
                          disabled={fijo}
                          onChange={() => alternar(rol, s.id)}
                        />
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>

            <p className="cp-nota">
              Dar <b>Usuarios y permisos</b> a otro perfil le permite cambiar roles y
              permisos, incluido el suyo.
            </p>

            <div className="cp-pie">
              {guardado && !hayCambios && <span className="cp-ok">Guardado</span>}
              <button className="cp-cancelar" onClick={onCerrar}>Cerrar</button>
              <button
                className="cp-guardar"
                onClick={guardar}
                disabled={!hayCambios || guardando}
              >
                {guardando ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </>
        )}
      </div>

      <style>{`
        /* Mismo modal que Configurar Telegram: entra por opacidad y la ventana
           ademas crece de 0.97 a 1. */
        .cp-fondo {
          position: fixed;
          inset: 0;
          z-index: 300;
          background: rgba(0,0,0,0.55);
          backdrop-filter: blur(3px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          opacity: 1;
          transition: opacity 0.2s cubic-bezier(0.23, 1, 0.32, 1);
        }
        @starting-style {
          .cp-fondo { opacity: 0; }
        }
        .cp {
          width: 100%;
          max-width: 560px;
          max-height: 85vh;
          overflow-y: auto;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 22px 24px 24px;
          opacity: 1;
          transform: scale(1);
          transition: opacity 0.2s cubic-bezier(0.23, 1, 0.32, 1),
                      transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        @starting-style {
          .cp { opacity: 0; transform: scale(0.97); }
        }

        .cp-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .cp-titulo { flex: 1; font-size: var(--fs-xl); font-weight: 700; color: var(--text); margin: 0; }
        .cp-x {
          background: none; border: none; color: var(--text-muted);
          font-size: 20px; line-height: 1; padding: 0 2px; cursor: pointer;
        }
        .cp-x:hover { color: var(--text); }

        .cp-ayuda { font-size: var(--fs-base); color: var(--text-muted); line-height: 1.6; margin: 0 0 16px; }
        .cp-cargando { font-size: var(--fs-base); color: var(--text-muted); padding: 20px 0; }

        /* Una columna para el nombre y una por rol, todas del mismo ancho: las
           marcas quedan alineadas y se leen como columna. */
        .cp-grilla { display: flex; flex-direction: column; }
        .cp-fila {
          display: grid;
          grid-template-columns: 1fr repeat(var(--roles), 76px);
          align-items: center;
          border-bottom: 1px solid var(--border);
        }
        .cp-fila:last-of-type { border-bottom: none; }
        /* Los nombres de los roles son etiquetas de columna: mismo tratamiento
           que los encabezados de tabla del resto de la app. */
        .cp-th {
          font-size: var(--fs-xs); font-weight: 700; color: var(--text-dim);
          text-transform: uppercase; letter-spacing: 0.8px;
        }
        .cp-seccion { font-size: var(--fs-base); color: var(--text); padding: 9px 0; }
        .cp-celda {
          display: flex; align-items: center; justify-content: center;
          padding: 9px 0; cursor: pointer;
        }
        .cp-celda input { width: 15px; height: 15px; cursor: pointer; accent-color: var(--primary); }
        .cp-fijo { cursor: default; }
        .cp-fijo input { cursor: default; opacity: 0.5; }

        .cp-nota {
          font-size: var(--fs-sm); color: var(--text-dim); line-height: 1.5;
          margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--border);
        }
        .cp-nota b { color: var(--text-muted); font-weight: 600; }

        .cp-pie { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 18px; }
        .cp-ok { margin-right: auto; font-size: var(--fs-sm); color: var(--green); }
        .cp-cancelar {
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          background: none; color: var(--text-muted);
          font-family: inherit; font-size: var(--fs-base); font-weight: 500;
          padding: 7px 14px; cursor: pointer;
          transition: color 0.15s, background 0.15s, transform 0.16s ease-out;
        }
        .cp-cancelar:hover { color: var(--text); background: var(--surface2); }
        .cp-guardar {
          border: none; border-radius: var(--radius-sm);
          background: var(--primary); color: var(--primary-fg);
          font-family: inherit; font-size: var(--fs-base); font-weight: 600;
          padding: 7px 16px; cursor: pointer;
          transition: opacity 0.15s, transform 0.16s ease-out;
        }
        .cp-guardar:hover:not(:disabled) { opacity: 0.85; }
        .cp-guardar:disabled { opacity: 0.4; cursor: default; }
      `}</style>
    </div>
  )
}
