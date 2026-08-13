// Boton de vuelta para las secciones que cuelgan de la pantalla de Inicio
// (pages/Inicio.jsx). Como esas paginas no tienen su propio item en la barra
// lateral, sin esto el camino de vuelta no queda a la vista.
//
// El texto es cambiable porque Reportes lo usa para volver a su propia lista y
// no al inicio: la forma del boton es la misma, lo unico que cambia es a donde
// lleva.
export default function VolverInicio({ onVolver, texto = 'Volver al inicio' }) {
  return (
    <>
      <button className="volver-inicio" onClick={onVolver}>
        <span className="volver-inicio-flecha">‹</span>
        {texto}
      </button>

      <style>{`
        .volver-inicio {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 14px;
          padding: 5px 10px 5px 7px;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: none;
          color: var(--text-muted);
          font-family: inherit;
          font-size: var(--fs-sm);
          font-weight: 500;
          cursor: pointer;
          transition: color 0.15s, background 0.15s, border-color 0.15s, transform 0.16s ease-out;
        }
        .volver-inicio:hover {
          color: var(--text);
          background: var(--surface2);
          border-color: var(--text-muted);
        }
        .volver-inicio:hover .volver-inicio-flecha { transform: translateX(-2px); }

        .volver-inicio-flecha {
          font-size: 16px;
          line-height: 1;
          transition: transform 0.15s;
        }
      `}</style>
    </>
  )
}
