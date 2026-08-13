import { Icono } from './Iconos'

// Estado vacio: cuando una seccion no tiene nada que mostrar.
//
// Antes era una linea de texto suelta y la pantalla quedaba desierta, sin
// distinguirse de algo que fallo. Con el icono en tenue se entiende que esta
// bien asi, y el texto de abajo dice que hacer cuando hay algo que hacer.

export default function Vacio({ icono, titulo, texto, children }) {
  return (
    <div className="vac">
      {icono && (
        <span className="vac-icono">
          <Icono id={icono} />
        </span>
      )}
      <div className="vac-titulo">{titulo}</div>
      {texto && <div className="vac-texto">{texto}</div>}
      {children}

      <style>{`
        .vac {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 9px;
          padding: 44px 24px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          text-align: center;
        }
        .vac-icono {
          display: grid;
          place-items: center;
          width: 42px;
          height: 42px;
          border-radius: var(--radius);
          background: var(--surface2);
          border: 1px solid var(--border);
          color: var(--text-muted);
          /* Tenue a proposito: acompaña, no llama la atencion. */
          opacity: 0.65;
          margin-bottom: 3px;
        }
        .vac-icono svg { width: 20px; height: 20px; }
        .vac-titulo { font-size: var(--fs-base); font-weight: 600; color: var(--text); }
        .vac-texto {
          font-size: var(--fs-sm);
          color: var(--text-muted);
          line-height: 1.6;
          max-width: 340px;
        }
      `}</style>
    </div>
  )
}
