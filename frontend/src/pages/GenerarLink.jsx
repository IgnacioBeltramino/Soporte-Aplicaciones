import { useState } from 'react'
import VolverInicio from '../components/VolverInicio'
import { GLPI_WEB_URL, generarLinkDeRedireccion } from '../lib/glpi'

export default function GenerarLink({ onVolver }) {
  const [entrada, setEntrada] = useState('')
  const [copiado, setCopiado] = useState(false)

  const resultado = entrada.trim() ? generarLinkDeRedireccion(entrada) : null

  const copiar = async () => {
    if (!resultado?.ok) return
    try {
      await navigator.clipboard.writeText(resultado.link)
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS): se copia a la vieja usanza.
      const ta = document.createElement('textarea')
      ta.value = resultado.link
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 1800)
  }

  return (
    <>
      <VolverInicio onVolver={onVolver} />

      <div className="page-header compacto">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Generar link</h1>
        </div>
      </div>

      <p className="gl-intro">
        Pegá cualquier URL de GLPI y te devuelve la versión que se le puede pasar a
        alguien sin sesión abierta: en vez de perder el destino en el login, GLPI lo
        deja parado donde corresponde.
      </p>

      <div className="card gl-caja">
        <label className="gl-label" htmlFor="gl-url">URL de GLPI</label>
        <textarea
          id="gl-url"
          className="gl-input"
          value={entrada}
          onChange={e => setEntrada(e.target.value)}
          placeholder={`${GLPI_WEB_URL || 'https://tu-glpi'}/ServiceCatalog`}
          rows={3}
          spellCheck="false"
        />

        {resultado && !resultado.ok && (
          <div className="gl-error">{resultado.error}</div>
        )}

        {resultado?.ok && (
          <>
            {resultado.aviso && <div className="gl-aviso">{resultado.aviso}</div>}

            <label className="gl-label gl-label-sep">Link para compartir</label>
            <div className="gl-salida">{resultado.link}</div>

            <div className="gl-acciones">
              <button className="gl-copiar" onClick={copiar}>
                {copiado ? '✓ Copiado' : 'Copiar link'}
              </button>
              <a
                className="gl-probar"
                href={resultado.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Probar en una pestaña nueva ↗
              </a>
            </div>

            <div className="gl-destino">
              Destino: <code>{resultado.destino}</code>
            </div>
          </>
        )}
      </div>

      <style>{`

        .gl-intro {
          font-size: var(--fs-base);
          color: var(--text-muted);
          line-height: 1.6;
          margin: 0 0 22px;
          max-width: 680px;
        }

        .gl-caja { padding: 22px; max-width: 780px; }
        .gl-caja:hover { transform: none; box-shadow: none; }

        .gl-label {
          display: block;
          font-size: var(--fs-sm);
          color: var(--text-muted);
          margin-bottom: 7px;
        }
        .gl-label-sep { margin-top: 20px; }

        .gl-input {
          width: 100%;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-family: inherit;
          font-size: var(--fs-base);
          line-height: 1.5;
          padding: 10px 12px;
          resize: vertical;
        }
        .gl-input:focus { outline: none; border-color: var(--primary); }

        .gl-salida {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 12px;
          font-size: var(--fs-base);
          line-height: 1.6;
          color: var(--text);
          word-break: break-all;
        }

        .gl-acciones { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }

        .gl-copiar {
          border: none;
          border-radius: var(--radius-sm);
          background: var(--primary);
          color: var(--primary-fg);
          font-family: inherit;
          font-size: var(--fs-base);
          font-weight: 600;
          padding: 9px 18px;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.16s ease-out;
        }
        .gl-copiar:hover { opacity: 0.85; }

        .gl-probar {
          font-size: var(--fs-base);
          color: var(--text-muted);
          text-decoration: none;
          transition: color 0.15s;
        }
        .gl-probar:hover { color: var(--text); }

        .gl-destino {
          margin-top: 16px;
          padding-top: 14px;
          border-top: 1px solid var(--border);
          font-size: var(--fs-sm);
          color: var(--text-muted);
          word-break: break-all;
        }
        .gl-destino code { color: var(--text); }

        .gl-error {
          margin-top: 12px;
          font-size: var(--fs-base);
          color: var(--red-soft);
        }

        .gl-aviso {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: var(--radius-sm);
          background: rgba(251, 191, 36, 0.08);
          border: 1px solid rgba(251, 191, 36, 0.28);
          font-size: var(--fs-base);
          line-height: 1.5;
          color: var(--yellow);
        }
      `}</style>
    </>
  )
}
