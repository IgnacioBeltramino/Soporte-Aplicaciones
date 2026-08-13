import { useEffect, useRef, useState } from 'react'

// Sub-páginas que pertenecen al tab "soporte"
const TAB_PARENT = { soporte_tecnico: 'soporte', soporte_dia: 'soporte' }

const LINKS = [
  { id: 'home',     label: 'Notificaciones' },
  { id: 'tickets',  label: 'Tickets Abiertos' },
  {
    id: 'soporte',
    label: 'Soporte Aplicaciones',
    dropdown: [
      { id: 'soporte_tecnico', label: 'Tickets por Técnico' },
      { id: 'soporte_dia',     label: 'Cerrados por Día' },
    ],
  },
  { id: 'stats',    label: 'Estadísticas' },
  { id: 'pases',    label: 'Pases a Producción' },
  // { id: 'reportes', label: 'Reportes' },
]

export default function Navbar({ page, onNavigate, notifCount }) {
  const activeTab = TAB_PARENT[page] || page

  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const pillRef  = useRef(null)
  const btnRefs  = useRef({})

  // Mueve el slider al tab activo
  useEffect(() => {
    const activeBtn = btnRefs.current[activeTab]
    const pill = pillRef.current
    if (!activeBtn || !pill) return
    const pillRect = pill.getBoundingClientRect()
    const btnRect  = activeBtn.getBoundingClientRect()
    setIndicator({ left: btnRect.left - pillRect.left, width: btnRect.width, ready: true })
  }, [activeTab])

  // Cierra el dropdown al hacer click fuera
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e) => {
      if (pillRef.current && !pillRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const handleTabClick = (link) => {
    if (link.dropdown) {
      setDropdownOpen(o => !o)
    } else {
      setDropdownOpen(false)
      onNavigate(link.id)
    }
  }

  const handleSubNav = (id) => {
    setDropdownOpen(false)
    onNavigate(id)
  }

  // Posición horizontal del dropdown (centrado en el botón soporte)
  const [dropLeft, setDropLeft] = useState(0)
  useEffect(() => {
    if (!dropdownOpen) return
    const btn  = btnRefs.current['soporte']
    const pill = pillRef.current
    if (!btn || !pill) return
    const pillRect = pill.getBoundingClientRect()
    const btnRect  = btn.getBoundingClientRect()
    setDropLeft(btnRect.left - pillRect.left + btnRect.width / 2)
  }, [dropdownOpen])

  return (
    <div className="nb-wrap">
      <div className="nb-pill" ref={pillRef}>
        <div
          className="nb-slider"
          style={{
            left: indicator.left,
            width: indicator.width,
            opacity: indicator.ready ? 1 : 0,
          }}
        />

        {LINKS.map((l) => {
          const isActive = activeTab === l.id
          return (
            <button
              key={l.id}
              ref={el => { btnRefs.current[l.id] = el }}
              className={`nb-item${isActive ? ' active' : ''}`}
              onClick={() => handleTabClick(l)}
            >
              {isActive && (
                <span className="nb-lamp">
                  <span className="nb-lamp-g1" />
                  <span className="nb-lamp-g2" />
                  <span className="nb-lamp-g3" />
                </span>
              )}
              <span>{l.label}</span>
              {l.dropdown && (
                <span className="nb-chevron" style={{ opacity: dropdownOpen ? 1 : 0.5 }}>
                  {dropdownOpen ? '▴' : '▾'}
                </span>
              )}
              {l.id === 'home' && notifCount > 0 && (
                <span className="nb-badge">{notifCount}</span>
              )}
            </button>
          )
        })}

        {dropdownOpen && (
          <div className="nb-dropdown" style={{ left: dropLeft }}>
            {LINKS.find(l => l.id === 'soporte').dropdown.map(sub => (
              <button
                key={sub.id}
                className={`nb-drop-item${page === sub.id ? ' active' : ''}`}
                onClick={() => handleSubNav(sub.id)}
              >
                {sub.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .nb-wrap {
          position: fixed;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 50;
        }
        .nb-pill {
          position: relative;
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 4px;
          border-radius: 9999px;
          background: rgba(17,17,17,0.8);
          border: 1px solid var(--border);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
          overflow: visible;
        }
        .nb-slider {
          position: absolute;
          top: 4px;
          height: calc(100% - 8px);
          border-radius: 9999px;
          background: rgba(255,255,255,0.06);
          transition: left 0.3s cubic-bezier(0.4,0,0.2,1), width 0.3s cubic-bezier(0.4,0,0.2,1);
          pointer-events: none;
          z-index: 0;
        }
        .nb-item {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 16px;
          border-radius: 9999px;
          border: none;
          background: none;
          color: var(--text-muted);
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: color 0.15s;
        }
        .nb-item:hover { color: var(--text); }
        .nb-item.active { color: var(--text); }
        .nb-chevron { font-size: 9px; transition: opacity 0.15s; }
        .nb-lamp {
          position: absolute;
          top: 0px;
          left: 50%;
          transform: translateX(-50%);
          width: 32px;
          height: 3px;
          background: var(--primary);
          border-radius: 0 0 4px 4px;
          display: block;
        }
        .nb-lamp-g1 {
          position: absolute;
          width: 48px; height: 24px;
          background: rgba(250,250,250,0.15);
          border-radius: 50%;
          filter: blur(8px);
          top: -8px; left: -8px;
        }
        .nb-lamp-g2 {
          position: absolute;
          width: 32px; height: 20px;
          background: rgba(250,250,250,0.1);
          border-radius: 50%;
          filter: blur(6px);
          top: -4px; left: 0;
        }
        .nb-lamp-g3 {
          position: absolute;
          width: 16px; height: 14px;
          background: rgba(250,250,250,0.08);
          border-radius: 50%;
          filter: blur(4px);
          top: 0; left: 8px;
        }
        .nb-badge {
          background: var(--primary);
          color: var(--primary-fg);
          font-size: 10px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 10px;
          min-width: 18px;
          text-align: center;
        }

        /* Dropdown */
        .nb-dropdown {
          position: absolute;
          top: calc(100% + 10px);
          transform: translateX(-50%);
          background: rgba(17,17,17,0.96);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 5px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          z-index: 100;
          min-width: 200px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .nb-drop-item {
          display: block;
          width: 100%;
          padding: 9px 14px;
          border: none;
          border-radius: 8px;
          background: none;
          color: var(--text-muted);
          font-family: inherit;
          font-size: 13px;
          font-weight: 500;
          text-align: left;
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
          white-space: nowrap;
        }
        .nb-drop-item:hover { background: rgba(255,255,255,0.06); color: var(--text); }
        .nb-drop-item.active { color: var(--text); background: rgba(255,255,255,0.06); }
      `}</style>
    </div>
  )
}
