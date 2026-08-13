import { useEffect, useState } from 'react'

// Configuracion de los avisos por Telegram, uno por usuario.
//
// Antes esto vivia en el .env (TELEGRAM_TECH_IDS="701:12345,836:67890") y para
// cambiar un destinatario habia que editar el archivo y reiniciar el backend.
// El chat es un dato de cada persona, asi que ahora vive con el usuario.
//
// El token del bot NO se toca desde aca: es un secreto del servidor y sigue en
// el .env. De el solo se muestra si esta cargado o no.

const ROLES_SIN_TELEGRAM = ['pasante']

export default function ConfigTelegram({ usuarios, onCerrar, onGuardado }) {
  // Solo los que ya ingresaron: el resto todavia no tiene fila en la base.
  const gente = usuarios.filter(u => u.ingreso)

  const [borradores, setBorradores] = useState(() =>
    Object.fromEntries(gente.map(u => [u.glpi_user_id, {
      chat_id: u.telegram_chat_id || '',
      activo: u.telegram_activo !== 0,
    }]))
  )
  const [estados, setEstados] = useState({})   // por usuario: { tipo, texto }
  const [ocupado, setOcupado] = useState(null)

  // Cerrar con Escape, que es lo que uno intenta primero.
  useEffect(() => {
    const alTecla = (e) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', alTecla)
    return () => window.removeEventListener('keydown', alTecla)
  }, [onCerrar])

  const editar = (id, campo, valor) => {
    setBorradores(prev => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }))
    setEstados(prev => ({ ...prev, [id]: null }))
  }

  const cambio = (u) => {
    const b = borradores[u.glpi_user_id]
    return b.chat_id !== (u.telegram_chat_id || '') || b.activo !== (u.telegram_activo !== 0)
  }

  const guardar = async (u) => {
    const id = u.glpi_user_id
    setOcupado(id)
    try {
      const res = await fetch(`/api/admin/usuarios/${id}/telegram`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(borradores[id]),
      })
      const data = await res.json()
      if (!res.ok) {
        setEstados(prev => ({ ...prev, [id]: { tipo: 'error', texto: data.detail || 'No se pudo guardar' } }))
        return
      }
      setEstados(prev => ({ ...prev, [id]: { tipo: 'ok', texto: 'Guardado' } }))
      await onGuardado()
    } catch {
      setEstados(prev => ({ ...prev, [id]: { tipo: 'error', texto: 'No se pudo conectar con el servidor' } }))
    } finally {
      setOcupado(null)
    }
  }

  const probar = async (u) => {
    const id = u.glpi_user_id
    setOcupado(id)
    try {
      const res = await fetch(`/api/admin/usuarios/${id}/telegram/probar`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setEstados(prev => ({ ...prev, [id]: { tipo: 'error', texto: data.detail || 'No se pudo enviar' } }))
        return
      }
      setEstados(prev => ({
        ...prev,
        [id]: data.aviso
          ? { tipo: 'aviso', texto: data.aviso }
          : { tipo: 'ok', texto: 'Mensaje enviado, fijate en Telegram' },
      }))
    } catch {
      setEstados(prev => ({ ...prev, [id]: { tipo: 'error', texto: 'No se pudo conectar con el servidor' } }))
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="ct-fondo" onClick={onCerrar}>
      <div className="ct" onClick={e => e.stopPropagation()}>
        <div className="ct-header">
          <h3 className="ct-titulo">Configurar Telegram</h3>
          <button className="ct-x" onClick={onCerrar} aria-label="Cerrar">&times;</button>
        </div>

        <p className="ct-ayuda">
          Cada persona recibe los avisos en su propio chat. Para conseguir el chat ID,
          esa persona tiene que escribirle una vez al bot y despues se puede leer con{' '}
          <code>getUpdates</code>. Los jefes reciben todo; los técnicos, lo de sus
          tickets; los pasantes no reciben Telegram.
        </p>

        <div className="ct-lista">
          {gente.map(u => {
            const b = borradores[u.glpi_user_id]
            const estado = estados[u.glpi_user_id]
            const trabajando = ocupado === u.glpi_user_id
            const sinTelegram = ROLES_SIN_TELEGRAM.includes(u.rol)
            const pendiente = cambio(u)

            return (
              <div key={u.glpi_user_id} className={`ct-fila${sinTelegram ? ' ct-na' : ''}`}>
                <div className="ct-quien">
                  <span className="ct-nombre">{u.nombre}</span>
                  <span className="ct-rol">{u.rol}</span>
                  {sinTelegram && <span className="ct-nota">no recibe Telegram</span>}
                </div>

                <div className="ct-campos">
                  <input
                    className="ct-input"
                    value={b.chat_id}
                    onChange={e => editar(u.glpi_user_id, 'chat_id', e.target.value)}
                    placeholder="Chat ID"
                    inputMode="numeric"
                    spellCheck="false"
                    disabled={trabajando}
                  />

                  <label className="ct-check" title="Si lo destildás deja de recibir, sin perder el chat ID">
                    <input
                      type="checkbox"
                      checked={b.activo}
                      onChange={e => editar(u.glpi_user_id, 'activo', e.target.checked)}
                      disabled={trabajando}
                    />
                    Activo
                  </label>

                  <button
                    className="ct-btn ct-guardar"
                    onClick={() => guardar(u)}
                    disabled={trabajando || !pendiente}
                  >
                    Guardar
                  </button>

                  <button
                    className="ct-btn"
                    onClick={() => probar(u)}
                    disabled={trabajando || !u.telegram_chat_id}
                    title={
                      !u.telegram_chat_id
                        ? 'Primero guardá un chat ID'
                        : 'Manda un mensaje real al chat guardado'
                    }
                  >
                    Probar
                  </button>
                </div>

                {(estado || pendiente) && (
                  <div className={`ct-estado ct-${estado ? estado.tipo : 'pendiente'}`}>
                    {estado ? estado.texto : 'Hay cambios sin guardar'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <style>{`
        /* El fondo entra por opacidad y la ventana ademas crece un poco. Antes
           aparecia todo de golpe: media pantalla se oscurecia de un frame al
           otro y costaba entender de donde habia salido la ventana.
           No arranca en scale(0), que se ve como salido de la nada, sino en
           0.97: apenas lo justo para que se lea como que se acerca. */
        .ct-fondo {
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
          .ct-fondo { opacity: 0; }
        }
        .ct {
          width: 100%;
          max-width: 720px;
          max-height: 85vh;
          overflow-y: auto;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 22px 24px 24px;
          /* Centrada y sin trigger al que anclarse: el origen va en el centro,
             que para un modal es lo correcto. */
          opacity: 1;
          transform: scale(1);
          transition: opacity 0.2s cubic-bezier(0.23, 1, 0.32, 1),
                      transform 0.2s cubic-bezier(0.23, 1, 0.32, 1);
          box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        @starting-style {
          .ct { opacity: 0; transform: scale(0.97); }
        }

        .ct-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .ct-titulo { flex: 1; font-size: var(--fs-xl); font-weight: 700; color: var(--text); margin: 0; }
        .ct-x {
          background: none; border: none; color: var(--text-muted);
          font-size: 20px; line-height: 1; padding: 0 2px; cursor: pointer;
        }
        .ct-x:hover { color: var(--text); }

        .ct-ayuda { font-size: var(--fs-base); color: var(--text-muted); line-height: 1.6; margin: 0 0 16px; }
        .ct-ayuda code {
          background: var(--surface2); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 1px 5px; font-size: var(--fs-sm); color: var(--text);
        }

        .ct-lista { display: flex; flex-direction: column; }
        .ct-fila { padding: 13px 0; border-bottom: 1px solid var(--border); }
        .ct-fila:last-child { border-bottom: none; }
        .ct-na { opacity: 0.5; }

        .ct-quien { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
        .ct-nombre { font-size: var(--fs-base); font-weight: 600; color: var(--text); }
        .ct-rol {
          font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
          padding: 2px 7px; border-radius: var(--radius);
          background: var(--surface2); border: 1px solid var(--border); color: var(--text-muted);
        }
        .ct-nota { font-size: var(--fs-xs); color: var(--text-muted); }

        .ct-campos { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
        .ct-input {
          width: 170px;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-family: inherit;
          font-size: var(--fs-base);
          font-variant-numeric: tabular-nums;
          padding: 6px 10px;
        }
        .ct-input:focus { outline: none; border-color: var(--primary); }

        .ct-check {
          display: flex; align-items: center; gap: 6px;
          font-size: var(--fs-sm); color: var(--text-muted); cursor: pointer; user-select: none;
        }

        .ct-btn {
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: var(--surface2);
          color: var(--text);
          font-family: inherit;
          font-size: var(--fs-sm);
          font-weight: 500;
          padding: 6px 12px;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.16s ease-out;
        }
        .ct-btn:hover:not(:disabled) { opacity: 0.75; }
        .ct-btn:disabled { opacity: 0.35; cursor: default; }
        .ct-guardar { border-color: var(--primary); color: var(--primary); }

        .ct-estado { margin-top: 8px; font-size: var(--fs-sm); line-height: 1.5; }
        .ct-ok { color: var(--green); }
        .ct-error { color: var(--red-soft); }
        .ct-aviso { color: var(--yellow); }
        .ct-pendiente { color: var(--text-muted); }

        @media (max-width: 620px) {
          .ct-input { width: 100%; }
        }
      `}</style>
    </div>
  )
}
