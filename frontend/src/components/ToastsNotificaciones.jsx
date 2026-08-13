import { acentoDe, notifContent, ticketIdDe } from '../lib/notificaciones'
import { ticketUrl } from '../lib/glpi'

// Avisos de la pagina, abajo a la derecha. Son la unica forma en que el
// dashboard avisa que entro algo: no se usan las notificaciones del navegador.
//
// No se cierran solos. Se muestran los primeros que llegaron y el resto espera
// en cola, asi que cerrar uno es lo que hace aparecer al siguiente y no te
// enteras de menos por haber estado mirando para otro lado.
//
// Cerrar un aviso no borra la novedad: la tarjeta sigue en Novedades.

const MAX_VISIBLES = 4

function Toast({ item, onCerrar }) {
  const { title, body } = notifContent(item)
  const ticketId = ticketIdDe(item)

  return (
    <div className="tn" style={{ '--tn': acentoDe(item) }}>
      <div className="tn-top">
        <span className="tn-dot" />
        <span className="tn-title">{title}</span>
        <button className="tn-x" onClick={() => onCerrar(item.key)} aria-label="Cerrar">
          &times;
        </button>
      </div>

      {body && <div className="tn-body">{body}</div>}

      {ticketId && (
        <a
          className="tn-link"
          href={ticketUrl(ticketId)}
          target="_blank"
          rel="noreferrer"
        >
          Ir al ticket &rarr;
        </a>
      )}
    </div>
  )
}

export default function ToastsNotificaciones({ items, onCerrar, onCerrarTodos }) {
  if (!items.length) return null

  // En orden de llegada: los primeros a la vista, los demas esperando turno.
  const visibles = items.slice(0, MAX_VISIBLES)
  const enCola = items.length - visibles.length

  return (
    <div className="tn-wrap">
      {items.length > 1 && (
        <div className="tn-barra">
          <span className="tn-cuenta">
            {enCola > 0
              ? `${items.length} novedades · ${enCola} esperando`
              : `${items.length} novedades`}
          </span>
          <button className="tn-todos" onClick={onCerrarTodos}>Cerrar todos</button>
        </div>
      )}

      {visibles.map(it => (
        <Toast key={it.key} item={it} onCerrar={onCerrar} />
      ))}

      <style>{`
        .tn-wrap {
          position: fixed;
          right: 22px;
          bottom: 22px;
          z-index: 200;
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 340px;
          max-width: calc(100vw - 44px);
          /* El contenedor no tapa la pagina; cada aviso si recibe clicks. */
          pointer-events: none;
        }

        .tn-barra {
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 7px 12px;
          border-radius: var(--radius);
          background: var(--surface2);
          border: 1px solid var(--border);
        }
        .tn-cuenta { flex: 1; font-size: var(--fs-sm); color: var(--text-muted); }
        .tn-todos {
          background: none;
          border: none;
          padding: 0;
          font-family: inherit;
          font-size: var(--fs-sm);
          font-weight: 600;
          color: var(--text-muted);
          cursor: pointer;
          transition: color 0.15s, transform 0.16s ease-out;
        }
        .tn-todos:hover { color: var(--text); }

        .tn {
          pointer-events: auto;
          background: var(--surface);
          border: 1px solid var(--border);
          border-left: 3px solid var(--tn);
          border-radius: var(--radius);
          padding: 12px 14px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.45);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          animation: tn-entra 0.22s ease-out;
        }
        @keyframes tn-entra {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }

        .tn-top { display: flex; align-items: center; gap: 8px; }
        .tn-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--tn); flex-shrink: 0; }
        .tn-title {
          flex: 1;
          font-size: var(--fs-base);
          font-weight: 700;
          color: var(--text);
          line-height: 1.4;
        }
        .tn-x {
          flex-shrink: 0;
          background: none;
          border: none;
          color: var(--text-muted);
          font-size: 15px;
          line-height: 1;
          padding: 0 2px;
          cursor: pointer;
          transition: color 0.15s, transform 0.16s ease-out;
        }
        .tn-x:hover { color: var(--text); }

        .tn-body {
          margin-top: 7px;
          font-size: var(--fs-sm);
          color: var(--text-muted);
          line-height: 1.5;
          /* Un seguimiento largo no puede estirar el aviso a lo alto. */
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .tn-link {
          display: inline-block;
          margin-top: 9px;
          font-size: var(--fs-sm);
          color: var(--tn);
          opacity: 0.75;
          text-decoration: none;
          transition: opacity 0.15s;
        }
        .tn-link:hover { opacity: 1; }

        @media (max-width: 720px) {
          .tn-wrap { right: 12px; bottom: 12px; width: auto; left: 74px; }
        }
      `}</style>
    </div>
  )
}
