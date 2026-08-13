import { useState } from "react"

const GLPI_BASE = "https://tickets.msm.gov.ar"
const ticketUrl = (id) => GLPI_BASE + "/index.php?redirect=/front/ticket.form.php?id=" + id

function formatTime(iso) {
  if (!iso) return ""
  const d = new Date(iso.replace(" ", "T"))
  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  })
}

function NotifCard({ notif, onDismiss }) {
  const isFollowup = notif.type === "new_followup"
  const isRejection = notif.type === "solution_rejected"
  const key = notif.type + "-" + notif.id
  const accent = isFollowup ? "#fbbf24" : isRejection ? "#f87171" : "#60a5fa"
  return (
    <div className="nc card" style={{ "--nc": accent }}>
      <div className="nc-top">
        <span className="nc-dot" />
        <span className="nc-time">{formatTime(notif.receivedAt)}</span>
        <button className="nc-x" onClick={() => onDismiss(key)}>&times;</button>
      </div>
      {isFollowup ? (
        <>
          <div className="nc-title"><span className="nc-id">#{notif.ticket_id}</span> {notif.ticket_title}</div>
          <div className="nc-author">Por: <strong>{notif.author}</strong></div>
          {notif.content && (
            <div className="nc-body">{notif.content.replace(/<[^>]*>/g, "").slice(0, 250)}</div>
          )}
          <a href={ticketUrl(notif.ticket_id)} target="_blank" rel="noreferrer" className="nc-link">Ir al ticket &rarr;</a>
        </>
      ) : isRejection ? (
        <>
          <div className="nc-title"><span className="nc-id">#{notif.ticket_id}</span> {notif.ticket_title}</div>
          <a href={ticketUrl(notif.ticket_id)} target="_blank" rel="noreferrer" className="nc-link">Ir al ticket &rarr;</a>
        </>
      ) : (
        <>
          <div className="nc-title"><span className="nc-id">#{notif.id}</span> {notif.title}</div>
          {notif.opened_at && <div className="nc-author">Apertura: {formatTime(notif.opened_at)}</div>}
          <a href={ticketUrl(notif.id)} target="_blank" rel="noreferrer" className="nc-link">Ir al ticket &rarr;</a>
        </>
      )}
    </div>
  )
}

function Column({ title, accent, notifications, onDismiss, emptyMsg }) {
  return (
    <div>
      <div className="col-title-row" style={{ "--accent": accent }}>
        <span className="col-title">{title}</span>
        <span className="badge">{notifications.length}</span>
      </div>
      {notifications.length === 0
        ? <div className="col-empty">{emptyMsg}</div>
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
          <h1 className="page-title" style={{ marginBottom: 0 }}>Notificaciones</h1>
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
        <Column title="Seguimientos"   accent="#fbbf24" notifications={followups} onDismiss={onDismiss} emptyMsg="Sin seguimientos nuevos." />
        <Column title="Tickets nuevos" accent="#60a5fa" notifications={tickets}   onDismiss={onDismiss} emptyMsg="Sin tickets nuevos." />
      </div>

      <style>{`
        .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
        .page-header-left { display: flex; align-items: center; gap: 12px; }
        .page-header-right { display: flex; align-items: center; gap: 12px; }
        .refresh-time { font-size: 12px; color: var(--text-muted); }
        .notif-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }

        .col-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid var(--accent); }
        .col-title { font-size: 15px; font-weight: 700; color: var(--text); flex: 1; }
        .col-empty { color: var(--text-muted); font-size: 13px; padding: 16px 0; }
        .nc-list { display: flex; flex-direction: column; gap: 10px; }

        .nc { border-left: 3px solid var(--nc) !important; padding: 14px 16px; cursor: default; }
        .nc-top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
        .nc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--nc); flex-shrink: 0; }
        .nc-time { font-size: 11px; color: var(--text-muted); flex: 1; }
        .nc-x { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 11px; padding: 0; line-height: 1; }
        .nc-x:hover { color: #f87171; }
        .nc-title { font-weight: 600; font-size: 13px; color: var(--text); line-height: 1.4; margin-bottom: 5px; }
        .nc-id { color: var(--nc); }
        .nc-author { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
        .nc-body { font-size: 12px; color: var(--text-muted); background: rgba(255,255,255,0.04); border-radius: 8px; padding: 8px 10px; line-height: 1.6; border: 1px solid var(--border); margin-bottom: 8px; }
        .nc-link { display: inline-block; margin-top: 10px; font-size: 12px; color: var(--nc); opacity: 0.7; transition: opacity 0.15s; }
        .nc-link:hover { opacity: 1; }

        @media (max-width: 700px) { .notif-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
