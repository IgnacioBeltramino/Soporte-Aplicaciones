// Bloques grises con la forma de lo que se esta cargando.
//
// Reemplazan al texto "Cargando...". Sirven para dos cosas: se ve que algo esta
// pasando, y el espacio ya queda reservado, asi la pantalla no pega el salto
// cuando llegan los datos y te mueve el clic de lugar.
//
// Respetan prefers-reduced-motion: a quien configuro el sistema para no ver
// animaciones se le muestran quietos.

export function Bloque({ ancho = '100%', alto = 13, radio = 4, style }) {
  return (
    <span
      className="sk"
      style={{ width: ancho, height: alto, borderRadius: radio, ...style }}
      aria-hidden="true"
    />
  )
}

/** Filas de una tabla. Los anchos son distintos entre si para que no parezca una grilla. */
export function TablaCargando({ filas = 5 }) {
  const anchos = ['16%', '55%', '38%', '46%', '30%', '24%']
  return (
    <div className="sk-tabla" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }).map((_, f) => (
        <div className="sk-fila" key={f}>
          {anchos.map((a, c) => (
            <Bloque key={c} ancho={a} style={{ flex: c === 1 ? 2 : 1 }} />
          ))}
        </div>
      ))}
      <Estilos />
    </div>
  )
}

/** Tarjetas apiladas: novedades, tableros, listados en general. */
export function TarjetasCargando({ cantidad = 3 }) {
  return (
    <div className="sk-tarjetas" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: cantidad }).map((_, i) => (
        <div className="sk-tarjeta" key={i}>
          <Bloque ancho="45%" alto={11} />
          <Bloque ancho="85%" />
          <Bloque ancho="60%" />
        </div>
      ))}
      <Estilos />
    </div>
  )
}

function Estilos() {
  return (
    <style>{`
      .sk {
        display: block;
        background: linear-gradient(
          90deg,
          var(--surface2) 0%,
          rgba(255,255,255,0.07) 50%,
          var(--surface2) 100%
        );
        background-size: 200% 100%;
        animation: sk-brillo 1.4s ease-in-out infinite;
      }
      @keyframes sk-brillo {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .sk-tabla {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        overflow: hidden;
      }
      .sk-fila {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 16px;
        border-top: 1px solid var(--border);
      }
      .sk-fila:first-child { border-top: none; }

      .sk-tarjetas { display: flex; flex-direction: column; gap: 10px; }
      .sk-tarjeta {
        display: flex;
        flex-direction: column;
        gap: 9px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-left: 3px solid var(--border);
        border-radius: var(--radius);
        padding: 14px 16px;
      }

      @media (prefers-reduced-motion: reduce) {
        .sk { animation: none; }
      }
    `}</style>
  )
}
