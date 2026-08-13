const TYPE_CONFIG = {
  new_ticket: { label: 'Ticket nuevo', icon: '🎫', color: '#4f8ef7' },
  new_followup: { label: 'Seguimiento', icon: '💬', color: '#f59e0b' },
  new_validation: { label: 'Validación', icon: '✅', color: '#22c55e' },
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function NotifCard({ notif, onDismiss }) {
  const config = TYPE_CONFIG[notif.type] ?? { label: notif.type, icon: '📌', color: '#6b7280' }

  return (
    <div className="notif-card" style={{ '--n-color': config.color }}>
      <div className="notif-header">
        <span className="notif-icon">{config.icon}</span>
        <span className="notif-type">{config.label}</span>
        <span className="notif-time">{formatTime(notif.receivedAt)}</span>
        <button className="notif-dismiss" onClick={onDismiss}>✕</button>
      </div>
      <div className="notif-body">
        {notif.type === 'new_ticket' && (
          <>
            <span className="notif-id">#{notif.id}</span> {notif.title}
            {notif.requester && <div className="notif-meta">De: {notif.requester}</div>}
          </>
        )}
        {notif.type === 'new_followup' && (
          <>
            <div><span className="notif-id">#{notif.ticket_id}</span> {notif.ticket_title}</div>
            <div className="notif-meta">Por: <strong>{notif.author}</strong></div>
            {notif.content && (
              <div className="notif-content">{notif.content.replace(/<[^>]*>/g, '').slice(0, 200)}</div>
            )}
          </>
        )}
        {notif.type === 'new_validation' && (
          <>
            Ticket <span className="notif-id">#{notif.ticket_id}</span>
            {notif.status && <div className="notif-meta">Estado: {notif.status}</div>}
          </>
        )}
      </div>
    </div>
  )
}

export default function NotificationPanel({ notifications, onDismiss }) {
  if (!notifications.length) {
    return (
      <div className="notif-empty">
        Sin notificaciones nuevas.<br />
        <span className="notif-empty-sub">Se actualizan cada 30 seg.</span>
        <style>{`
          .notif-empty { padding: 40px 20px; text-align: center; color: var(--text-muted); font-size: 13px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); line-height: 1.6; }
          .notif-empty-sub { font-size: 11px; opacity: 0.6; }
        `}</style>
      </div>
    )
  }

  return (
    <>
      <div className="notif-list">
        {notifications.map((n, i) => (
          <NotifCard key={i} notif={n} onDismiss={() => onDismiss(i)} />
        ))}
      </div>

      <style>{`
        .notif-list { display: flex; flex-direction: column; gap: 10px; max-height: 600px; overflow-y: auto; }
        .notif-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-left: 3px solid var(--n-color);
          border-radius: var(--radius);
          padding: 12px 14px;
          font-size: 13px;
        }
        .notif-header { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
        .notif-icon { font-size: 14px; }
        .notif-type { font-weight: 600; color: var(--n-color); flex: 1; font-size: 12px; }
        .notif-time { font-size: 11px; color: var(--text-muted); }
        .notif-dismiss {
          background: none; border: none; color: var(--text-muted);
          cursor: pointer; font-size: 12px; padding: 0 2px;
          line-height: 1;
        }
        .notif-dismiss:hover { color: var(--red); }
        .notif-body { color: var(--text); line-height: 1.5; }
        .notif-id { color: var(--primary); font-weight: 700; }
        .notif-meta { color: var(--text-muted); font-size: 12px; margin-top: 4px; }
        .notif-content { font-size: 12px; color: var(--text-muted); margin-top: 6px; background: var(--surface2); border-radius: 6px; padding: 6px 8px; line-height: 1.5; }
      `}</style>
    </>
  )
}
