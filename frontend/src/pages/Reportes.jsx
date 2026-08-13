import { useState, useEffect, useRef } from 'react'
import Vacio from '../components/Vacio'
import VolverInicio from '../components/VolverInicio'
import { Icono } from '../components/Iconos'
import { ticketUrl } from '../lib/glpi'

const REPORTS = [
  {
    id: 'by_technician',
    label: 'Por Técnico',
    description: 'Todos los tickets de un técnico en el período seleccionado.',
    icon: 'usuarios',
  },
  {
    id: 'by_area',
    label: 'Por Área',
    description: 'Todos los tickets asignados a un área/grupo en el período.',
    icon: 'area',
  },
  {
    id: 'by_form',
    label: 'Por Formulario',
    description: 'Tickets generados desde un formulario del catálogo de servicios.',
    icon: 'formulario',
  },
]

/* Los estados salen de las variables --estado-*, que son las que ya usan la
   tabla de tickets y el Kanban. Aca estaban en --blue, --yellow y --green, con
   lo cual el mismo ticket que en Novedades se veia violeta ("En proceso") aca
   se veia azul, y "Resuelto" y "Cerrado" compartian color. */
const STATUS_COLORS = {
  'Nuevo': 'var(--estado-nuevo)',
  'En curso': 'var(--estado-proceso)',
  'En curso (Plan.)': 'var(--estado-planificado)',
  'Pendiente': 'var(--estado-espera)',
  'Resuelto': 'var(--estado-resuelto)',
  'Cerrado': 'var(--estado-cerrado)',
}

/* El nombre del archivo lo decide el backend, que es el que sabe de que
   formulario o de que tecnico es el reporte. Viene en el Content-Disposition en
   las dos formas del RFC 6266: `filename*` con el nombre real (acentos incluidos)
   y `filename` sin acentos para clientes viejos. Se prefiere el primero. */
function nombreDelArchivo(contentDisposition, porDefecto) {
  if (!contentDisposition) return porDefecto
  const utf8 = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1])
    } catch {
      /* si viene mal codificado, queda el filename comun */
    }
  }
  const simple = contentDisposition.match(/filename="([^"]+)"/i)
  return simple ? simple[1] : porDefecto
}

function SearchSelect({ options, placeholder, value, onChange, loading }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const inputRef = useRef(null)

  // Limita a 80 resultados para no pintar miles de nodos
  const filtered = options
    .filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 80)

  const selected = options.find(o => String(o.id) === String(value))

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Foco garantizado cuando abre el dropdown
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        className="ss-trigger"
        onClick={() => { setOpen(o => !o); setQuery('') }}
      >
        {selected ? selected.name : (loading ? 'Cargando…' : placeholder)}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>▾</span>
      </div>
      {open && (
        <div className="ss-dropdown">
          <input
            ref={inputRef}
            className="ss-search"
            placeholder="Buscar…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="ss-list">
            {filtered.length === 0
              ? <div className="ss-empty">Sin resultados</div>
              : filtered.map(o => (
                <div
                  key={o.id}
                  className={`ss-option${String(o.id) === String(value) ? ' selected' : ''}`}
                  onMouseDown={() => { onChange(o); setOpen(false) }}
                >
                  {o.name}
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

function ReportCard({ report, onSelect }) {
  return (
    <button className="rp-card card" onClick={() => onSelect(report)}>
      <span className="rp-card-icon">
        <Icono id={report.icon} className="rp-icon" />
      </span>
      <span className="rp-card-txt">
        <span className="rp-card-title">{report.label}</span>
        <span className="rp-card-desc">{report.description}</span>
      </span>
      <span className="rp-card-arrow">›</span>
    </button>
  )
}

/* Una cifra del resumen. El cero va apagado y no en su color: un "0" en
   amarillo se lee como una alerta, y lo que dice es que no hay nada de eso.
   Es el mismo criterio que los guiones de Cerrados por Día. */
function Cifra({ etiqueta, valor, color }) {
  const vacio = !valor
  return (
    <div className="rp-stat">
      <span className="rp-stat-l">{etiqueta}</span>
      <span
        className="rp-stat-n"
        style={{ color: vacio ? 'var(--text-dim)' : (color || 'var(--text)') }}
      >
        {valor}
      </span>
    </div>
  )
}

function FilterPanel({ report, onBack }) {
  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)

  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo] = useState(today)
  const [options, setOptions] = useState([])
  const [loadingOpts, setLoadingOpts] = useState(true)
  const [selected, setSelected] = useState(null)
  const [result, setResult] = useState(null)
  // null, 'excel' o 'pdf': ademas de saber si esta generando, hace falta saber
  // cual de los dos botones es el que tiene que decir "Generando…".
  const [loading, setLoading] = useState(null)
  const [error, setError] = useState(null)

  const endpointMap = {
    by_technician: '/api/reports/technicians',
    by_area: '/api/reports/groups',
    by_form: '/api/reports/forms',
  }

  useEffect(() => {
    fetch(endpointMap[report.id])
      .then(r => r.json())
      .then(data => { setOptions(data); setLoadingOpts(false) })
      .catch(() => setLoadingOpts(false))
  }, [report.id])

  // Cada formato tiene su ruta y su extension, y el resto del pedido es igual.
  // El Excel se agrego porque el PDF no se puede filtrar ni ordenar: sirve para
  // leerlo y mandarlo, no para trabajar sobre los datos.
  const FORMATOS = {
    excel: {
      ext: 'xlsx',
      rutas: {
        by_technician: '/api/reports/excel/by-technician',
        by_area:       '/api/reports/excel/by-area',
        by_form:       '/api/reports/excel/by-form',
      },
    },
    pdf: {
      ext: 'pdf',
      rutas: {
        by_technician: '/api/reports/pdf/by-technician',
        by_area:       '/api/reports/pdf/by-area',
        by_form:       '/api/reports/pdf/by-form',
      },
    },
  }

  // formato null = solo buscar y mostrar en pantalla, sin descargar nada.
  const handleGenerate = async (formato) => {
    if (!selected) return
    setLoading(formato || 'buscar')
    setError(null)
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
      if (report.id === 'by_technician') params.set('tech_id', selected.id)
      if (report.id === 'by_area')       params.set('group_id', selected.id)
      if (report.id === 'by_form')       params.set('form_id', selected.id)

      // Buscar: trae los datos y los muestra en pantalla.
      if (!formato) {
        setResult(null)
        const endpointData = {
          by_technician: '/api/reports/by-technician',
          by_area:       '/api/reports/by-area',
          by_form:       '/api/reports/by-form',
        }
        const res = await fetch(`${endpointData[report.id]}?${params}`)
        if (!res.ok) throw new Error('Error al obtener datos')
        setResult(await res.json())
        return
      }

      // Descargar: el archivo ya trae los mismos tickets adentro, asi que pedir
      // ademas el endpoint de datos era consultar GLPI dos veces para lo mismo.
      // El resultado en pantalla, si lo hay, se deja como esta.
      if (report.id === 'by_technician') params.set('tech_name', selected.name)
      if (report.id === 'by_area')       params.set('group_name', selected.name)

      const { rutas, ext } = FORMATOS[formato]
      const archivoRes = await fetch(`${rutas[report.id]}?${params}`)
      if (!archivoRes.ok) throw new Error(`No se pudo generar el ${ext.toUpperCase()}`)

      const blob = await archivoRes.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombreDelArchivo(
        archivoRes.headers.get('Content-Disposition'),
        `reporte_${report.id}_${dateFrom}_${dateTo}.${ext}`,
      )
      document.body.appendChild(a)
      a.click()
      a.remove()
      // La descarga arranca despues del click, no durante: liberar la URL en la
      // misma vuelta la mataba antes de que el navegador llegara a leerla.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(null)
    }
  }

  const filterLabel = {
    by_technician: 'Técnico',
    by_area: 'Área',
    by_form: 'Formulario',
  }[report.id]

  const formatDate = (d) => {
    if (!d) return '—'
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  return (
    <div>
      {/* El mismo boton de vuelta que Ficheros y EFLOW, con su propio destino:
          aca lleva a la lista de reportes. */}
      <VolverInicio onVolver={onBack} texto="Volver a reportes" />

      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            Reporte {report.label.toLowerCase()}
          </h1>
        </div>
      </div>

      <div className="rp-filters card">
        <div className="rp-filter-row">
          <div className="rp-filter-group">
            <label className="rp-label">{filterLabel}</label>
            <SearchSelect
              options={options}
              placeholder={`Seleccioná un ${filterLabel.toLowerCase()}…`}
              value={selected?.id}
              onChange={setSelected}
              loading={loadingOpts}
            />
          </div>
          <div className="rp-filter-group">
            <label className="rp-label">Desde</label>
            <input type="date" className="rp-date-input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="rp-filter-group">
            <label className="rp-label">Hasta</label>
            <input type="date" className="rp-date-input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>

          {/* Buscar va pegado a Hasta porque cierra los filtros: es el final de
              la frase "tal tecnico, entre estas dos fechas". Muestra el
              resultado en pantalla y no descarga nada, que es lo que uno quiere
              la mayoria de las veces. */}
          <button
            className="rp-buscar-btn"
            disabled={!selected || !!loading}
            onClick={() => handleGenerate(null)}
          >
            {loading === 'buscar' ? 'Buscando…' : 'Buscar'}
          </button>

          {/* Las descargas se van al otro extremo: son otra cosa que mirar el
              resultado, y de este lado no se aprietan sin querer. */}
          <div className="rp-acciones">
            <button
              className="rp-generate-btn"
              disabled={!selected || !!loading}
              onClick={() => handleGenerate('excel')}
            >
              {loading === 'excel' ? 'Generando…' : 'Generar Excel'}
            </button>
            <button
              className="rp-generate-btn secundario"
              disabled={!selected || !!loading}
              onClick={() => handleGenerate('pdf')}
            >
              {loading === 'pdf' ? 'Generando…' : 'Generar PDF'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">⚠ {error}</div>}

      {result && (
        <div className="rp-result">
          {/* La etiqueta arriba y la cifra abajo, como los paneles de Historico:
              el numero solo no dice nada hasta que uno lee que hay debajo. */}
          <div className="rp-summary">
            <Cifra etiqueta="Abiertos"   valor={result.summary.open}    color="var(--estado-nuevo)" />
            <div className="rp-stat-sep" />
            <Cifra etiqueta="Pendientes" valor={result.summary.pending} color="var(--estado-espera)" />
            <div className="rp-stat-sep" />
            <Cifra etiqueta="Cerrados"   valor={result.summary.closed}  color="var(--estado-resuelto)" />
            <div className="rp-stat-sep" />
            <Cifra etiqueta="Total"      valor={result.summary.total} />
          </div>

          {result.tickets.length === 0 ? (
            <Vacio
              icono="tickets"
              titulo="Sin tickets en el período seleccionado"
              texto="Cambiá las fechas o los filtros y volvé a generar el reporte."
            />
          ) : (
            <div className="rp-wrap">
              <table className="rp-table">
                <thead>
                  <tr>
                    <th className="rp-c-id">#</th>
                    <th>Título</th>
                    <th className="rp-c-estado">Estado</th>
                    <th className="rp-c-pers">Técnico</th>
                    <th className="rp-c-pers">Solicitante</th>
                    <th className="rp-c-fecha">Apertura</th>
                    <th className="rp-c-fecha">Vencimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tickets.map(t => (
                    <tr key={t.id}>
                      <td className="rp-id">{t.id}</td>
                      {/* El titulo es el link, como en la tabla de tickets y en
                          la de pases: el #id repetido en cada fila era un link
                          de seis caracteres al que habia que apuntarle. */}
                      <td className="rp-title" title={t.title}>
                        <a href={ticketUrl(t.id)} target="_blank" rel="noreferrer" className="rp-title-link">
                          {t.title}
                        </a>
                      </td>
                      <td>
                        <span className="rp-status" style={{ '--sc': STATUS_COLORS[t.status_label] || 'var(--estado-cerrado)' }}>
                          {t.status_label}
                        </span>
                      </td>
                      <td className="rp-muted" title={t.tech}>{t.tech || '—'}</td>
                      <td className="rp-muted" title={t.requester}>{t.requester || '—'}</td>
                      <td className="rp-muted">{formatDate(t.opened_at?.slice(0, 10))}</td>
                      <td className="rp-muted">{formatDate(t.due_at?.slice(0, 10))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <style>{`
        /* overflow visible: .card recorta lo que se sale, y el desplegable de
           tecnicos se abre hacia abajo, fuera del panel. Quedaba cortado a la
           altura del borde (se veia el buscador y ninguna opcion) y, al enfocar
           el buscador, el panel se scrolleaba por dentro y se comia las
           etiquetas de arriba. */
        .rp-filters { padding: 16px 18px; margin-bottom: 16px; overflow: visible; }
        .rp-filters:hover { transform: none; box-shadow: none; }
        .rp-filter-row { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
        .rp-filter-group { display: flex; flex-direction: column; gap: 6px; min-width: 200px; }
        .rp-label {
          font-size: var(--fs-xs); color: var(--text-dim); font-weight: 700;
          letter-spacing: 0.8px; text-transform: uppercase;
        }
        /* Los tres controles miden lo mismo de alto. La fila alinea por abajo,
           asi que cuando el desplegable media 30px y las fechas 32, las tres
           etiquetas de arriba quedaban a distinta altura. */
        .rp-date-input {
          background: var(--surface2); border: 1px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text); font-family: inherit;
          font-size: var(--fs-base); padding: 0 10px; height: 32px; outline: none;
          transition: border-color 0.15s;
        }
        .rp-date-input:focus { border-color: #404040; }
        .rp-generate-btn {
          background: var(--text); color: var(--bg); border: none;
          border-radius: var(--radius-sm); font-family: inherit; font-size: var(--fs-base);
          font-weight: 600; padding: 0 20px; height: 32px; cursor: pointer;
          transition: opacity 0.15s, transform 0.16s ease-out; white-space: nowrap; align-self: flex-end;
        }
        .rp-generate-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .rp-generate-btn:not(:disabled):hover { opacity: 0.85; }
        /* Pegado al campo Hasta: el gap de la fila es 14px y aca queda en 0,
           que es lo que hace que se lea como parte del filtro y no como una
           accion suelta mas. */
        .rp-buscar-btn {
          margin-left: -6px; align-self: flex-end;
          background: var(--surface2); color: var(--text);
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          font-family: inherit; font-size: var(--fs-base); font-weight: 600;
          padding: 0 18px; height: 32px; cursor: pointer; white-space: nowrap;
          transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.16s ease-out;
        }
        .rp-buscar-btn:not(:disabled):hover {
          background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.25);
        }
        .rp-buscar-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* margin-left auto: las descargas se van al extremo derecho de la fila,
           lejos del filtro que se toca todo el tiempo. */
        .rp-acciones {
          display: flex; align-items: flex-end; gap: 8px;
          align-self: flex-end; margin-left: auto;
        }
        /* El segundo formato no compite con el primero: mismo tamaño, sin el
           relleno blanco. */
        .rp-generate-btn.secundario {
          background: var(--surface2); color: var(--text);
          border: 1px solid var(--border);
        }
        .rp-generate-btn.secundario:not(:disabled):hover {
          opacity: 1; background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2);
        }

        /* SearchSelect */
        .ss-trigger {
          display: flex; align-items: center; gap: 8px;
          background: var(--surface2); border: 1px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text); font-family: inherit;
          font-size: var(--fs-base); padding: 0 10px; height: 32px; cursor: pointer;
          transition: border-color 0.15s, transform 0.16s ease-out; min-width: 220px;
        }
        .ss-trigger:hover { border-color: #404040; }
        .ss-dropdown {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius-sm); z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          overflow: hidden;
        }
        .ss-search {
          width: 100%; background: var(--surface2); border: none;
          border-bottom: 1px solid var(--border); color: var(--text);
          font-family: inherit; font-size: var(--fs-base); padding: 8px 12px; outline: none;
        }
        .ss-list { max-height: 200px; overflow-y: auto; }
        .ss-option {
          padding: 8px 12px; font-size: var(--fs-base); cursor: pointer;
          color: var(--text-muted); transition: background 0.1s, color 0.1s;
        }
        .ss-option:hover, .ss-option.selected { background: var(--surface2); color: var(--text); }
        .ss-empty { padding: 10px 12px; font-size: var(--fs-base); color: var(--text-muted); }

        /* Result */
        .rp-result { display: flex; flex-direction: column; gap: 16px; }
        /* Alineado a la izquierda, como todo lo demas de la app. Centrado era la
           unica fila de datos que no arrancaba pegada al margen. */
        .rp-summary {
          display: flex; align-items: center; gap: 0;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius); padding: 16px 0;
        }
        .rp-stat { display: flex; flex-direction: column; gap: 6px; flex: 1; padding: 0 18px; }
        .rp-stat-n { font-size: var(--fs-display); font-weight: 800; line-height: 1; }
        .rp-stat-l {
          font-size: var(--fs-xs); color: var(--text-dim); font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.8px;
        }
        .rp-stat-sep { width: 1px; height: 42px; background: var(--border); }

        /* Table: la misma caja, los mismos anchos declarados y los mismos tres
           escalones de gris que .tt y .pp-table. Estaba suelta sobre el fondo,
           sin borde ni fondo propio, y era la unica tabla de la app asi. */
        .rp-wrap {
          overflow-x: auto;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
        }
        .rp-table { width: 100%; min-width: 900px; table-layout: fixed; border-collapse: collapse; font-size: var(--fs-base); }
        .rp-c-id     { width: 64px; }
        .rp-c-estado { width: 124px; }
        .rp-c-pers   { width: 150px; }
        .rp-c-fecha  { width: 110px; }
        .rp-table th {
          text-align: left; padding: 10px 14px;
          color: var(--text-dim); font-weight: 600;
          font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.8px;
          border-bottom: 1px solid var(--border); white-space: nowrap;
        }
        .rp-table td { padding: 8px 14px; border-top: 1px solid var(--border); vertical-align: middle; }
        .rp-table tbody tr { transition: background 0.15s; }
        .rp-table tbody tr:hover { background: rgba(255,255,255,0.03); }

        .rp-id { color: var(--text-dim); font-weight: 600; white-space: nowrap; font-size: var(--fs-xs); }
        .rp-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rp-title-link {
          color: var(--text); font-weight: 600; text-decoration: none;
          transition: color 0.15s ease;
        }
        .rp-table tbody tr:hover .rp-title-link {
          color: var(--primary); text-decoration: underline; text-underline-offset: 3px;
        }
        .rp-muted {
          color: var(--text-dim); white-space: nowrap; font-size: var(--fs-xs);
          overflow: hidden; text-overflow: ellipsis;
        }
        /* Badge, no texto de color suelto: es el mismo estado que en el resto de
           la app, y ahi es una pastilla. */
        .rp-status {
          display: inline-block; padding: 2px 9px; border-radius: var(--radius-sm);
          font-size: var(--fs-xs); font-weight: 600; white-space: nowrap;
          color: var(--sc);
          background: color-mix(in srgb, var(--sc) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--sc) 30%, transparent);
        }
      `}</style>
    </div>
  )
}

export default function Reportes() {
  const [activeReport, setActiveReport] = useState(null)

  if (activeReport) {
    return <FilterPanel report={activeReport} onBack={() => setActiveReport(null)} />
  }

  return (
    <div>
      {/* "compacto" y no un margen negativo a mano: es la variante que ya usan
          las pantallas que abren con un parrafo debajo del titulo. */}
      <div className="page-header compacto">
        <div className="page-header-left">
          <h1 className="page-title" style={{ marginBottom: 0 }}>Reportes</h1>
        </div>
      </div>
      <p className="rp-intro">
        Seleccioná el tipo de reporte para configurar los filtros y descargarlo en Excel o PDF.
      </p>
      <div className="rp-list">
        {REPORTS.map(r => <ReportCard key={r.id} report={r} onSelect={setActiveReport} />)}
      </div>
      <style>{`
        .rp-intro { font-size: var(--fs-base); color: var(--text-muted); margin: 0 0 24px; }

        /* Misma tarjeta que los accesos de Inicio: son lo mismo (un boton grande
           que lleva a otra pantalla) y estaban dibujados distinto. */
        /* Centradas: son tres y no hay nada mas en la pantalla, asi que pegadas
           al margen izquierdo dejaban toda la derecha vacia. */
        .rp-list { display: flex; flex-direction: column; gap: 12px; max-width: 640px; margin: 0 auto; }
        .rp-card {
          display: flex; align-items: center; gap: 14px;
          width: 100%; padding: 18px; text-align: left;
          font-family: inherit; color: var(--text); cursor: pointer;
        }
        .rp-card-icon {
          flex-shrink: 0; display: grid; place-items: center;
          width: 42px; height: 42px; border-radius: var(--radius);
          background: var(--surface2); border: 1px solid var(--border);
          color: var(--text);
        }
        .rp-icon { width: 21px; height: 21px; }
        .rp-card-txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
        .rp-card-title { font-size: var(--fs-lg); font-weight: 700; color: var(--text); }
        .rp-card-desc  { font-size: var(--fs-sm); color: var(--text-muted); line-height: 1.45; }
        .rp-card-arrow {
          flex-shrink: 0; margin-left: auto; color: var(--text-muted);
          font-size: var(--fs-xl); line-height: 1;
          transition: color 0.15s, transform 0.15s;
        }
        .rp-card:hover .rp-card-arrow { transform: translateX(2px); color: var(--text); }
      `}</style>
    </div>
  )
}
