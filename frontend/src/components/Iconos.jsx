// Iconos compartidos entre la barra lateral y la pantalla de Inicio.
// Todos dibujados sobre la misma grilla de 20x20 y con el trazo sin relleno,
// asi cambian de tamano y de color solos segun donde se usen.
export const ICONOS = {
  inicio: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.5" />
    </>
  ),
  home: (
    <>
      <path d="M4 4h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7l-3 3z" />
      <path d="M7 8h6M7 11h4" />
    </>
  ),
  tickets: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M3 8h14M7 12h6" />
    </>
  ),
  // Tres columnas de distinto alto: la forma de un tablero de tareas.
  kanban: (
    <>
      <rect x="3" y="3.5" width="4" height="13" rx="1.2" />
      <rect x="8" y="3.5" width="4" height="9" rx="1.2" />
      <rect x="13" y="3.5" width="4" height="6" rx="1.2" />
    </>
  ),
  pases: (
    <>
      <path d="M10 3v10" />
      <path d="M6.5 9.5 10 13l3.5-3.5" />
      <path d="M4 16h12" />
    </>
  ),
  stats: (
    <>
      <path d="M4 16V9M8.7 16V5M13.3 16v-5M18 16v-8" />
    </>
  ),
  soporte: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="2.5" />
    </>
  ),
  usuarios: (
    <>
      <circle cx="8" cy="7.5" r="3" />
      <path d="M2.5 16.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M14 5.5a2.75 2.75 0 0 1 0 5.5" />
    </>
  ),
  ficheros: (
    <>
      <rect x="3" y="3.5" width="14" height="5" rx="1.5" />
      <rect x="3" y="11.5" width="14" height="5" rx="1.5" />
      <path d="M6 6h.01M6 14h.01" />
    </>
  ),
  eflow: (
    <>
      <rect x="6" y="2.5" width="8" height="12" rx="1.5" />
      <path d="M8.5 5.5h3" />
      <path d="M7 17.5h6" />
    </>
  ),
  // Un edificio: es el area/grupo al que se le asigna un ticket. Con dos filas
  // de ventanas se empastaba: en 21px los trazos quedan a menos de 2px entre si
  // y se ve una mancha. Queda una fila, que alcanza para leer el edificio.
  area: (
    <>
      <path d="M3.5 16.5V5.5L10 3l6.5 2.5v11" />
      <path d="M2.5 16.5h15" />
      <path d="M7 9h2M11 9h2" />
      <path d="M8.25 16.5v-3.5h3.5v3.5" />
    </>
  ),
  // Una hoja con barras adentro: el reporte que sale impreso o en planilla.
  // No repite el de Estadistica (barras sueltas) porque aca lo que importa no
  // son los numeros sino que terminan en un archivo.
  reportes: (
    <>
      <rect x="4" y="2.5" width="12" height="15" rx="1.5" />
      <path d="M7.5 13.5V9M10 13.5V6.5M12.5 13.5v-3" />
    </>
  ),
  // Una hoja con renglones y un tilde: el formulario del catalogo.
  formulario: (
    <>
      <rect x="4" y="2.5" width="12" height="15" rx="1.5" />
      <path d="M7 6.5h6M7 9.5h6" />
      <path d="M7 13l1.5 1.5L12 11" />
    </>
  ),
  generar_link: (
    <>
      <path d="M8.5 11.5a3 3 0 0 0 4.25 0l2.5-2.5a3 3 0 0 0-4.25-4.25l-1 1" />
      <path d="M11.5 8.5a3 3 0 0 0-4.25 0l-2.5 2.5a3 3 0 0 0 4.25 4.25l1-1" />
    </>
  ),
}

export function Icono({ id, className = 'sb-icon' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONOS[id]}
    </svg>
  )
}
