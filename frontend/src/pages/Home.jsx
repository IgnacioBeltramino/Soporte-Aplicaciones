import { useState } from "react"
import Vacio from "../components/Vacio"
import { ticketUrl } from "../lib/glpi"

function formatTime(iso) {
  if (!iso) return ""
  const d = new Date(iso.replace(" ", "T"))
  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  })
}

// La tarjeta entera es el link al ticket. Antes cada una cerraba con un
// "Ir al ticket ->" propio: con veinte novedades en pantalla eran veinte
// lineas repitiendo lo mismo, y el destino del clic era solo esa linea.
function NotifCard({ notif, onDismiss }) {
  const isFollowup = notif.type === "new_followup"
  const isRejection = notif.type === "solution_rejected"
  const key = notif.type + "-" + notif.id

  const accent = isFollowup ? "var(--estado-espera)" : isRejection ? "var(--red-soft)" : "var(--estado-nuevo)"
  const ticketId = isFollowup || isRejection ? notif.ticket_id : notif.id
  const titulo = isFollowup || isRejection ? notif.ticket_title : notif.title

  // Los metadatos cierran la tarjeta en una sola linea. Antes la hora abria
  // arriba de todo, que es el lugar de mas peso visual, para el dato que menos
  // importa de los tres.
  const quien = isFollowup ? notif.author : isRejection ? "Solucion rechazada" : "Apertura"
  const cuando = formatTime(isFollowup || isRejection ? notif.receivedAt : (notif.opened_at || notif.receivedAt))

  const cuerpo = isFollowup && notif.content
    ? notif.content.replace(/<[^>]*>/g, "").slice(0, 250)
    : null

  return (
    <a
      className="nc"
      style={{ "--nc": accent }}
      href={ticketUrl(ticketId)}
      target="_blank"
      rel="noreferrer"
    >
      <button
        className="nc-x"
        aria-label="Descartar"
        // La X vive adentro del link: sin esto, descartar abriria el ticket.
        onClick={e => { e.preventDefault(); e.stopPropagation(); onDismiss(key) }}
      >
        &times;
      </button>

      <div className="nc-head">
        <span className="nc-id">#{ticketId}</span>
        <span className="nc-title">{titulo}</span>
      </div>

      {cuerpo && <div className="nc-body">{cuerpo}</div>}

      <div className="nc-meta">
        <strong>{quien}</strong>
        <span className="nc-sep">·</span>
        <span>{cuando}</span>
      </div>
    </a>
  )
}

function Column({ title, accent, icono, notifications, onDismiss, emptyMsg }) {
  return (
    <div>
      <div className="col-title-row" style={{ "--accent": accent }}>
        <span className="col-marca" />
        <span className="col-title">{title}</span>
        <span className="col-n">{notifications.length}</span>
      </div>
      {notifications.length === 0
        ? <Vacio icono={icono} titulo={emptyMsg} texto="Te avisamos apenas entre algo." />
        : <div className="nc-list">{notifications.map(n => (
            <NotifCard key={n.type + "-" + n.id} notif={n} onDismiss={onDismiss} />
          ))}</div>
      }
    </div>
  )
}

export default function Home({ notifications, onDismiss, onRefresh }) {
  const [lastRefresh, setLastRefresh] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await onRefresh()
    setLastRefresh(new Date())
    setRefreshing(false)
  }

  const followups = notifications.filter(n => n.type === "new_followup")
  const tickets   = notifications.filter(n => n.type === "new_ticket" || n.type === "solution_rejected")

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Novedades</h1>
        </div>
        <div className="page-header-right">
          {lastRefresh && (
            <span className="refresh-time">
              {lastRefresh.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
          )}
          <button className="btn" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "..." : "↻ Actualizar"}
          </button>
        </div>
      </div>

      <div className="notif-grid">
        <Column title="Seguimientos"   accent="var(--estado-espera)" icono="home"    notifications={followups} onDismiss={onDismiss} emptyMsg="Sin seguimientos nuevos" />
        <Column title="Tickets nuevos" accent="var(--estado-nuevo)" icono="tickets" notifications={tickets}   onDismiss={onDismiss} emptyMsg="Sin tickets nuevos" />
      </div>

      <style>{`
        .notif-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }

        /* El titulo de columna es una etiqueta, no un titular: va en el escalon
           mas bajo de la escala y en mayusculas. El color pasa a un cuadradito
           al costado, en lugar de una linea de 2px a todo el ancho. */
        .col-title-row {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 14px; padding-bottom: 10px;
          border-bottom: 1px solid var(--border);
        }
        .col-marca { width: 3px; height: 12px; background: var(--accent); border-radius: 1px; flex-shrink: 0; }
        .col-title {
          flex: 1;
          font-size: var(--fs-xs); font-weight: 700;
          letter-spacing: 0.8px; text-transform: uppercase;
          color: var(--text-muted);
        }
        .col-n { font-size: var(--fs-xs); font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }

        .nc-list { display: flex; flex-direction: column; gap: 6px; }

        .nc {
          display: block; position: relative;
          text-decoration: none; color: inherit;
          background: var(--surface);
          border: 1px solid var(--border);
          border-left: 2px solid var(--nc);
          border-radius: var(--radius);
          padding: 12px 14px;
          /* El hover ilumina en el lugar en vez de levantar la tarjeta: en una
             lista que se mira todo el dia, que las cosas salten es ruido. */
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .nc:hover { background: #141414; border-color: #333; }
        .nc:hover .nc-x { opacity: 1; }

        .nc-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; padding-right: 18px; }
        .nc-id { flex-shrink: 0; font-size: var(--fs-xs); font-weight: 700; color: var(--nc); font-variant-numeric: tabular-nums; }
        .nc-title { font-size: var(--fs-lg); font-weight: 600; color: var(--text); line-height: 1.45; }

        /* El cuerpo era una caja con fondo y borde adentro de otra caja. Ahora
           es texto, cortado a dos lineas. */
        .nc-body {
          font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.6; margin-bottom: 8px;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }

        .nc-meta { display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-dim); }
        .nc-meta strong { color: var(--text-muted); font-weight: 600; }
        .nc-sep { opacity: 0.4; }

        .nc-x {
          position: absolute; top: 8px; right: 8px;
          background: none; border: none;
          color: var(--text-dim); cursor: pointer;
          font-size: var(--fs-base); line-height: 1; padding: 2px 4px;
          opacity: 0;
          transition: opacity 0.15s ease, color 0.15s ease, transform 0.16s ease-out;
        }
        .nc-x:hover { color: var(--red-soft); }
        /* En touch no hay hover: ahi la X se ve siempre. */
        @media (hover: none) { .nc-x { opacity: 1; } }

        @media (max-width: 700px) { .notif-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
