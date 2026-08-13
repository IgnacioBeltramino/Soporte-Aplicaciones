import { useState } from 'react'
import { Icono } from './Iconos'

// Que items ve cada uno sale de usuario.secciones, que arma el backend con la
// tabla de permisos (se configura en Usuarios y permisos → Perfiles). Esconder
// el item es comodidad: el backend valida lo mismo por su cuenta.
//
// Ficheros y EFLOW no estan aca a proposito: se entra por la pantalla de Inicio
// (pages/Inicio.jsx), que es la que agrupa las secciones menos usadas.
const LINKS = [
  { id: 'inicio',  label: 'Inicio' },
  { id: 'home',    label: 'Novedades' },
  { id: 'tickets', label: 'Tickets Abiertos' },
  // Tareas propias del area, no tickets. El pasante lo ve pero no lo edita.
  { id: 'kanban',  label: 'Tareas' },
  { id: 'pases',   label: 'Pases a Producción' },
  { id: 'stats',   label: 'Histórico' },
  {
    id: 'soporte',
    label: 'Estadística',
    sub: [
      { id: 'soporte_tecnico', label: 'Tickets por Técnico' },
      { id: 'soporte_dia',     label: 'Cerrados por Día' },
    ],
  },
  { id: 'usuarios', label: 'Usuarios' },
  // Reportes va ultimo. Hasta ahora no estaba en ningun lado: existia la
  // pantalla pero no habia como llegar, salvo escribiendo la direccion.
  { id: 'reportes', label: 'Reportes' },
]

// Paginas a las que se entra desde Inicio. Sin esto, al abrir Ficheros o EFLOW
// no quedaria ningun item marcado en el menu y se pierde de donde venis.
const PAGINAS_DE_INICIO = ['ficheros', 'eflow', 'generar_link']

export default function Sidebar({ page, onNavigate, notifCount, usuario, onLogout, chica, onPlegar }) {
  const secciones = usuario?.secciones || []
  // Un agrupador se muestra si queda con al menos un subitem visible, y se
  // queda solo con los que el usuario puede ver: si tiene Cerrados por Dia pero
  // no Tickets por Tecnico, Estadistica aparece con uno solo adentro.
  const links = LINKS
    .map(l => (l.sub ? { ...l, sub: l.sub.filter(s => secciones.includes(s.id)) } : l))
    .filter(l => (l.sub ? l.sub.length > 0 : secciones.includes(l.id)))

  // Arranca abierto si estas parado en alguna de sus subpaginas
  const [abierto, setAbierto] = useState(
    () => page === 'soporte_tecnico' || page === 'soporte_dia'
  )

  return (
    <aside className={`sb${chica ? ' sb-chica' : ''}`}>
      <div className="sb-marca">
        <span className="sb-marca-t">Soporte Aplicaciones</span>
        <button
          className="sb-plegar"
          onClick={onPlegar}
          title={chica ? 'Expandir el menú' : 'Replegar el menú'}
          aria-label={chica ? 'Expandir el menú' : 'Replegar el menú'}
        >
          {chica ? '»' : '«'}
        </button>
      </div>

      <nav className="sb-nav">
        {links.map(l => {
          // Un agrupador se marca activo si esta parado en alguna de sus subpaginas.
          // Inicio hace lo mismo con las secciones que cuelgan de su pantalla.
          const activo = l.sub
            ? l.sub.some(s => s.id === page)
            : l.id === 'inicio'
              ? page === 'inicio' || PAGINAS_DE_INICIO.includes(page)
              : page === l.id

          return (
            <div key={l.id}>
              <button
                className={`sb-item${activo ? ' activo' : ''}`}
                // Plegada no hay lugar para los subitems, asi que tocar un
                // agrupador la expande en vez de no hacer nada visible.
                onClick={() => {
                  if (l.sub) {
                    if (chica) onPlegar()
                    setAbierto(o => (chica ? true : !o))
                  } else {
                    onNavigate(l.id)
                  }
                }}
                title={chica ? l.label : ''}
              >
                <Icono id={l.id} />
                <span className="sb-label">{l.label}</span>
                {l.id === 'home' && notifCount > 0 && (
                  <span className="sb-badge">{notifCount}</span>
                )}
                {l.sub && (
                  <span className={`sb-chevron${abierto ? ' abierto' : ''}`}>›</span>
                )}
              </button>

              {l.sub && abierto && (
                <div className="sb-sub">
                  {l.sub.map(s => (
                    <button
                      key={s.id}
                      className={`sb-subitem${page === s.id ? ' activo' : ''}`}
                      onClick={() => onNavigate(s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="sb-pie">
        <div className="sb-user">
          <span className="sb-user-nombre" title={usuario?.nombre}>{usuario?.nombre}</span>
          <span className="sb-user-rol">{usuario?.rol}</span>
        </div>

        {/* El glifo va en el markup y no en un ::after del modo plegado: asi es
            el mismo boton en los dos anchos y lo unico que cambia es si el
            texto se ve. La clase .sb-label es la que ya usan los items del
            menu, con lo cual la regla que los oculta plegados vale tambien
            aca sin escribir una nueva. */}
        <button className="sb-salir" onClick={onLogout} title="Cerrar sesión">
          <span className="sb-salir-icono">⏻</span>
          <span className="sb-label">Cerrar sesión</span>
        </button>
      </div>

      <style>{`
        .sb {
          position: fixed;
          top: 0;
          left: 0;
          width: 236px;
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: rgba(17,17,17,0.72);
          border-right: 1px solid var(--border);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          z-index: 50;
          transition: width 0.18s ease;
        }

        .sb-marca {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 22px 14px 18px 20px;
          border-bottom: 1px solid var(--border);
        }
        .sb-marca-t {
          flex: 1;
          font-size: var(--fs-lg);
          font-weight: 700;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sb-plegar {
          flex-shrink: 0;
          display: grid;
          place-items: center;
          width: 24px;
          height: 24px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: var(--surface2);
          color: var(--text-muted);
          font-family: inherit;
          font-size: var(--fs-sm);
          line-height: 1;
          cursor: pointer;
          transition: color 0.15s, border-color 0.15s, transform 0.16s ease-out;
        }
        .sb-plegar:hover { color: var(--text); border-color: var(--text-muted); }

        /* Plegada: el mismo modo angosto que ya se usaba en pantallas chicas,
           pero a pedido. Quedan solo los iconos, con el nombre en el tooltip. */
        .sb-chica { width: 62px; }
        .sb-chica .sb-marca-t,
        .sb-chica .sb-label,
        .sb-chica .sb-badge,
        .sb-chica .sb-chevron,
        .sb-chica .sb-sub,
        .sb-chica .sb-user { display: none; }
        .sb-chica .sb-marca { padding: 22px 0 18px; justify-content: center; }
        .sb-chica .sb-item { justify-content: center; padding: 11px 0; }
        .sb-chica .sb-pie { padding: 14px 0 16px; align-items: center; }
        /* Plegada queda el glifo solo, centrado y en una caja cuadrada. Antes
           el texto se apagaba con font-size: 0 y el icono lo ponia un ::after,
           asi que el boton era una cosa distinta en cada ancho. */
        .sb-chica .sb-salir { width: auto; align-self: center; padding: 6px 9px; gap: 0; }

        .sb-nav {
          flex: 1;
          overflow-y: auto;
          padding: 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .sb-item {
          position: relative;
          display: flex;
          align-items: center;
          gap: 11px;
          width: 100%;
          padding: 9px 12px;
          border: none;
          border-radius: var(--radius-sm);
          background: none;
          color: var(--text-muted);
          font-family: inherit;
          font-size: var(--fs-base);
          font-weight: 500;
          text-align: left;
          cursor: pointer;
          transition: background 0.14s, color 0.14s;
        }
        .sb-item:hover:not(:disabled) { background: rgba(255,255,255,0.05); color: var(--text); }
        .sb-item.activo { background: rgba(255,255,255,0.07); color: var(--text); }
        /* Barrita clara del lado izquierdo del item activo */
        .sb-item.activo::before {
          content: '';
          position: absolute;
          left: -10px;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 18px;
          border-radius: 0 3px 3px 0;
          background: var(--primary);
        }
        /* Flecha del desplegable: apunta a la derecha cerrado, abajo abierto */
        .sb-chevron {
          flex-shrink: 0;
          font-size: var(--fs-lg);
          line-height: 1;
          color: var(--text-dim);
          transition: transform 0.2s ease;
        }
        .sb-chevron.abierto { transform: rotate(90deg); }

        .sb-icon { width: 17px; height: 17px; flex-shrink: 0; }
        .sb-label {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* --radius-sm y no --radius: es una pastilla chica, y le toca el mismo
           radio que los badges del resto de la app. */
        .sb-badge {
          background: var(--primary);
          color: var(--primary-fg);
          font-size: var(--fs-xs);
          font-weight: 700;
          padding: 1px 6px;
          border-radius: var(--radius-sm);
          min-width: 18px;
          text-align: center;
          flex-shrink: 0;
        }

        .sb-sub { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 2px 0; }
        .sb-subitem {
          position: relative;
          padding: 8px 12px 8px 40px;
          border: none;
          border-radius: var(--radius-sm);
          background: none;
          color: var(--text-muted);
          font-family: inherit;
          font-size: var(--fs-sm);
          font-weight: 500;
          text-align: left;
          cursor: pointer;
          transition: background 0.14s, color 0.14s;
        }
        .sb-subitem::before {
          content: '';
          position: absolute;
          left: 22px;
          top: 0;
          bottom: 0;
          width: 1px;
          background: var(--border);
        }
        .sb-subitem:hover { background: rgba(255,255,255,0.05); color: var(--text); }
        .sb-subitem.activo { background: rgba(255,255,255,0.07); color: var(--text); }
        .sb-subitem.activo::before { background: var(--primary); width: 2px; }

        .sb-pie {
          border-top: 1px solid var(--border);
          padding: 14px 16px 16px;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        /* Nombre y rol en columna, no uno al lado del otro. El rol es un dato
           sobre quien esta logueado, no algo que se toca: va debajo del nombre
           y en el escalon tipografico mas bajo, apagado. Antes era un badge con
           borde, fondo y mayusculas, o sea que el metadato pesaba mas que el
           unico boton del pie. */
        .sb-user {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 1px;
          min-width: 0;
        }
        .sb-user-nombre {
          max-width: 100%;
          font-size: var(--fs-sm);
          font-weight: 500;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sb-user-rol {
          font-size: var(--fs-xs);
          letter-spacing: 0.3px;
          color: var(--text-muted);
        }
        /* Tiene forma de boton. Era texto pelado sin borde ni fondo, con lo
           cual era la unica accion de toda la barra que no se parecia ni a un
           boton ni a un item del menu, y pesaba igual que el nombre de arriba,
           que es informacion y no algo que se toca.
         *
         * El rojo aparece solo al pasar el mouse: en reposo es una accion mas y
         * no tiene por que llamar la atencion desde el arranque. Va en
         * --red-soft y no en --red, como el resto de los textos rojos de la
         * app. */
        /* A todo el ancho y con el contenido a la izquierda, como los items del
         * menu de arriba: asi la barra entera se lee con la misma grilla en vez
         * de terminar en una pastilla suelta flotando en el medio. Y al sacarle
         * el borde al rol, queda una sola caja con borde en todo el pie. */
        .sb-salir {
          width: 100%;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: none;
          color: var(--text-muted);
          font-family: inherit;
          font-size: var(--fs-sm);
          font-weight: 500;
          padding: 7px 11px;
          cursor: pointer;
          transition: color 0.15s, background 0.15s, border-color 0.15s,
                      transform 0.16s ease-out;
        }
        .sb-salir:hover {
          color: var(--red-soft);
          border-color: color-mix(in srgb, var(--red) 35%, transparent);
          background: color-mix(in srgb, var(--red) 8%, transparent);
        }
        /* El glifo queda fuera de la escala --fs-*, como el resto de los iconos
           de la app: esa escala dimensiona tipografia. */
        .sb-salir-icono { font-size: 14px; line-height: 1; }

        @media (max-width: 720px) {
          .sb { width: 62px; }
          .sb-marca, .sb-label, .sb-sub, .sb-pie { display: none; }
          .sb-item { justify-content: center; padding: 11px 0; }
          .sb-grupo { display: none; }
        }
      `}</style>
    </aside>
  )
}
