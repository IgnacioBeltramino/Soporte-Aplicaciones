import { useEffect, useState } from 'react'
import { Icono } from './Iconos'
import { diasEntre } from '../lib/estadisticas'

// Cuadros de la semana, al estilo del grafico de aportes de GitHub, pero con
// los tickets que cerro uno mismo: siete casilleros, del lunes al domingo.
//
// Es personal y no del equipo. La tabla con todos ya existe en "Cerrados por
// Día", que es una pantalla de seguimiento; esto es para ver como viene la
// semana propia de un vistazo, y por eso lo ve cualquiera sin ese permiso.

// Solo dias habiles: el sabado y el domingo estaban casi siempre vacios y lo
// unico que hacian era ocupar dos septimos del dibujo con nada. Lo que llegue
// a cerrarse un fin de semana no se pierde, se avisa aparte en el pie.
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie']
const NIVELES = 4

const hoyISO = () => new Date().toISOString().slice(0, 10)

/**
 * De cuantos cerrados a que tan fuerte se pinta el casillero.
 *
 * La escala es relativa al mejor dia de la semana y no absoluta: si un dia
 * bueno son cuatro tickets, una escala fija dejaria todo del mismo tono claro
 * y el dibujo no diria nada.
 */
function nivelDe(cantidad, maximo) {
  if (!cantidad || maximo <= 0) return 0
  return Math.max(1, Math.ceil((cantidad / maximo) * NIVELES))
}

/** "06/08" a partir de un YYYY-MM-DD. */
function etiquetaDia(iso) {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** Un dia corrido desde `desde`, en YYYY-MM-DD. */
function sumarDias(desde, cantidad) {
  const d = new Date(desde + 'T12:00:00')
  d.setDate(d.getDate() + cantidad)
  return d.toISOString().slice(0, 10)
}

/** De lunes a viernes de la semana que arranca en `lunes`. */
function semanaDe(lunes) {
  return diasEntre(lunes, sumarDias(lunes, 4)).slice(0, 5)
}

export default function SemanaTickets() {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelado = false
    fetch('/api/tickets/mi-semana', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('sin datos'))))
      .then(d => { if (!cancelado) setDatos(d) })
      .catch(() => { if (!cancelado) setError(true) })
    return () => { cancelado = true }
  }, [])

  const hoy = hoyISO()
  // Los cinco dias se dibujan siempre, aunque el dato llegue hasta hoy: la
  // semana tiene la misma forma el lunes que el viernes, y los que faltan
  // quedan como casilleros vacios en vez de encoger la grilla.
  const dias = datos ? semanaDe(datos.desde) : []
  const porDia = dias.map(d => datos?.por_dia?.[d] || 0)
  const maximo = Math.max(0, ...porDia)

  // El total que se muestra es el de los dias dibujados, para que el numero de
  // arriba y los casilleros no digan cosas distintas. Lo que se haya cerrado
  // sabado o domingo se cuenta aparte en vez de desaparecer.
  const total = porDia.reduce((a, b) => a + b, 0)
  const finDeSemana = datos
    ? [5, 6].reduce((a, n) => a + (datos.por_dia?.[sumarDias(datos.desde, n)] || 0), 0)
    : 0

  return (
    <section className="card sm">
      <header className="sm-head">
        <h2 className="sm-titulo">Tu semana</h2>
        {datos && (
          <span className="sm-cuenta">
            {total} {total === 1 ? 'cerrado' : 'cerrados'}
          </span>
        )}
      </header>

      {error ? (
        <div className="sm-cuadro">
          <span className="sm-cuadro-icono"><Icono id="soporte" /></span>
          <span className="sm-cuadro-txt">No se pudo consultar GLPI. Puede ser la VPN.</span>
        </div>
      ) : datos === null ? (
        <div className="sm-cuadro sm-cuadro-apagado">
          <span className="sm-cuadro-icono"><Icono id="soporte" /></span>
          <span className="sm-cuadro-txt">Buscando…</span>
        </div>
      ) : (
        <div className="sm-centro">
          <div className="sm-grilla">
            {dias.map((d, i) => (
              <span key={`t-${d}`} className={`sm-dia${d === hoy ? ' sm-dia-hoy' : ''}`}>
                {DIAS_CORTOS[i]}
              </span>
            ))}

            {dias.map((d, i) => {
              const n = porDia[i]
              const futura = d > hoy
              const clases = [
                'sm-celda',
                d === hoy ? 'sm-celda-hoy' : '',
                futura ? 'sm-celda-futura' : '',
              ].filter(Boolean).join(' ')
              return (
                <span
                  key={d}
                  className={clases}
                  data-nivel={futura ? 0 : nivelDe(n, maximo)}
                  title={futura
                    ? `${DIAS_CORTOS[i]} ${etiquetaDia(d)} · todavía no`
                    : `${DIAS_CORTOS[i]} ${etiquetaDia(d)} · ${n} ${n === 1 ? 'cerrado' : 'cerrados'}`}
                >
                  {!futura && n > 0 && <span className="sm-n">{n}</span>}
                </span>
              )
            })}
          </div>

          <div className="sm-pie">
            <span className="sm-rango">
              {etiquetaDia(dias[0])} al {etiquetaDia(dias[4])}
              {finDeSemana > 0 && ` · ${finDeSemana} el fin de semana`}
            </span>
            <span className="sm-leyenda">
              menos
              {[0, 1, 2, 3, 4].map(n => (
                <span key={n} className="sm-muestra" data-nivel={n} />
              ))}
              más
            </span>
          </div>
        </div>
      )}

      <style>{`
        .sm { padding: 18px 20px 16px; }
        .sm:hover { transform: none; box-shadow: none; }

        .sm-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .sm-titulo { font-size: var(--fs-lg); font-weight: 700; margin: 0; }
        .sm-cuenta {
          font-size: var(--fs-xs);
          color: var(--text-dim);
          text-transform: uppercase;
          letter-spacing: 0.8px;
        }

        /* La grilla se centra en la tarjeta en vez de arrancar pegada al
           borde: son siete casilleros y sin la columna de nombres quedaban
           amontonados a la izquierda, con todo el ancho vacio al lado. */
        .sm-centro {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
        }

        .sm-grilla {
          display: grid;
          grid-template-columns: repeat(5, 46px);
          gap: 6px;
          align-items: center;
          justify-content: center;
        }

        .sm-dia {
          font-size: var(--fs-xs);
          color: var(--text-dim);
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .sm-dia-hoy { color: var(--text); font-weight: 700; }

        .sm-celda {
          display: grid;
          place-items: center;
          aspect-ratio: 1;
          width: 100%;
          border-radius: var(--radius-sm);
          background: var(--surface2);
          border: 1px solid var(--border);
        }
        /* El cero no va en verde apagado sino en el gris de los paneles: un dia
           sin cerrar nada no es poca actividad, es ninguna. */
        .sm-celda[data-nivel="1"] { background: color-mix(in srgb, var(--green) 22%, var(--surface2)); border-color: transparent; }
        .sm-celda[data-nivel="2"] { background: color-mix(in srgb, var(--green) 45%, var(--surface2)); border-color: transparent; }
        .sm-celda[data-nivel="3"] { background: color-mix(in srgb, var(--green) 70%, var(--surface2)); border-color: transparent; }
        .sm-celda[data-nivel="4"] { background: var(--green); border-color: transparent; }

        /* Hoy lleva un anillo en vez de otro color: el color ya esta diciendo
           cuanto se cerro y no puede decir dos cosas a la vez. */
        .sm-celda-hoy { box-shadow: 0 0 0 1px var(--text-muted); }
        /* Los dias que todavia no llegaron: se ve el casillero, no el dato. */
        .sm-celda-futura { opacity: 0.5; border-style: dashed; }

        /* Ahora que los casilleros son grandes entra el numero adentro. En los
           tonos fuertes el verde pide texto oscuro para poder leerse. */
        .sm-n { font-size: var(--fs-sm); font-weight: 700; color: var(--text); }
        .sm-celda[data-nivel="3"] .sm-n,
        .sm-celda[data-nivel="4"] .sm-n { color: var(--bg); }

        .sm-muestra {
          width: 11px;
          height: 11px;
          border-radius: var(--radius-sm);
          background: var(--surface2);
          border: 1px solid var(--border);
        }
        .sm-muestra[data-nivel="1"] { background: color-mix(in srgb, var(--green) 22%, var(--surface2)); border-color: transparent; }
        .sm-muestra[data-nivel="2"] { background: color-mix(in srgb, var(--green) 45%, var(--surface2)); border-color: transparent; }
        .sm-muestra[data-nivel="3"] { background: color-mix(in srgb, var(--green) 70%, var(--surface2)); border-color: transparent; }
        .sm-muestra[data-nivel="4"] { background: var(--green); border-color: transparent; }

        .sm-pie {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 18px;
          flex-wrap: wrap;
          width: 100%;
          padding-top: 12px;
          border-top: 1px solid rgba(255,255,255,0.05);
        }
        .sm-rango { font-size: var(--fs-xs); color: var(--text-dim); }
        .sm-leyenda {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: var(--fs-xs);
          color: var(--text-dim);
        }

        .sm-cuadro {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 9px;
          padding: 26px 20px;
          margin: 4px 0 8px;
          background: var(--surface2);
          border: 1px dashed var(--border);
          border-radius: var(--radius);
          text-align: center;
        }
        .sm-cuadro-apagado { opacity: 0.55; }
        .sm-cuadro-icono {
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          border-radius: var(--radius);
          border: 1px solid var(--border);
          color: var(--text-muted);
          opacity: 0.65;
        }
        .sm-cuadro-icono svg { width: 17px; height: 17px; }
        .sm-cuadro-txt { font-size: var(--fs-sm); color: var(--text-muted); }
      `}</style>
    </section>
  )
}
