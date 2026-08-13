import { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import FondoIsolineas from './components/FondoIsolineas'
import Inicio from './pages/Inicio'
import GenerarLink from './pages/GenerarLink'
import Home from './pages/Home'
import Login from './pages/Login'
import TicketsAbiertos from './pages/TicketsAbiertos'
import Kanban from './pages/Kanban'
import SoporteAplicaciones from './pages/SoporteAplicaciones'
import TicketsPorDia from './pages/TicketsPorDia'
import Estadisticas from './pages/Estadisticas'
import Reportes from './pages/Reportes'
import PasesProduccion from './pages/PasesProduccion'
import Usuarios from './pages/Usuarios'
import Ficheros from './pages/Ficheros'
import Eflow from './pages/Eflow'
import ToastsNotificaciones from './components/ToastsNotificaciones'
import { VALID_TYPES, claveDe } from './lib/notificaciones'
import { puedeVer, usePagina } from './lib/rutas'
import './App.css'

// Los avisos salen solo por los toasts de la pagina (ToastsNotificaciones): no
// se usa la API Notification del navegador. Depende de un permiso que se puede
// bloquear sin que la app se entere, y del centro de notificaciones del sistema,
// que puede estar en silencio. Para cuando no estas en el dashboard esta Telegram.

// Tope de avisos acumulados. Sin cierre automatico la cola crece sola: pasado
// esto se descartan los mas viejos, que igual quedan listados en Novedades.
const MAX_TOASTS = 25

export default function App() {
  // La pagina vive en la direccion del navegador: se puede compartir un link,
  // el boton Atras funciona y F5 deja donde estabas.
  const [page, setPage] = usePagina()
  const [usuario, setUsuario] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [notifications, setNotifications] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('glpi_notifications') || '[]')
      return stored.filter(n => VALID_TYPES.includes(n.type))
    } catch { return [] }
  })
  // Los toasts son efimeros: no se guardan en localStorage a proposito, si
  // recargas la pagina no tiene sentido que vuelvan a saltar.
  const [toasts, setToasts] = useState([])

  // La barra plegada si se recuerda: es una preferencia de como trabaja cada
  // uno, y volver a plegarla en cada visita seria molesto.
  const [sbChica, setSbChica] = useState(() => localStorage.getItem('sb_chica') === '1')
  useEffect(() => {
    localStorage.setItem('sb_chica', sbChica ? '1' : '0')
  }, [sbChica])
  const seenRef = useRef(null)
  if (!seenRef.current) {
    try {
      const stored = JSON.parse(localStorage.getItem('glpi_notifications') || '[]')
      seenRef.current = new Set(stored.map(n => n.type + '-' + n.id))
    } catch {
      seenRef.current = new Set()
    }
  }

  // Al cargar, pregunta si ya hay una sesion activa (cookie firmada)
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => setUsuario(data))
      .catch(() => setUsuario(null))
      .finally(() => setCheckingSession(false))
  }, [])

  // Los permisos del usuario vienen con /me. Despues de tocarlos en Perfiles
  // hay que volver a pedirlos, si no el menu sigue mostrando lo de antes hasta
  // que alguien recargue la pagina.
  const releerUsuario = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (res.ok) setUsuario(await res.json())
    } catch { /* si falla, queda lo que ya estaba */ }
  }, [])

  useEffect(() => {
    localStorage.setItem('glpi_notifications', JSON.stringify(notifications))
  }, [notifications])

  // Los eventos ya vistos se descartan aca ademas de en el backend: el /poll los
  // marca entregados, pero el boton Actualizar y el intervalo pueden pisarse.
  const procesarEventos = useCallback((events) => {
    const fresh = events
      .filter(e => VALID_TYPES.includes(e.type))
      .filter(e => {
        const key = claveDe(e)
        if (seenRef.current.has(key)) return false
        seenRef.current.add(key)
        return true
      })
    if (!fresh.length) return

    // El aviso que salta encima, y la tarjeta en Novedades como historial.
    setToasts(prev => [...prev, ...fresh.map(e => ({ ...e, key: claveDe(e) }))].slice(-MAX_TOASTS))
    setNotifications(prev =>
      [...fresh.map(e => ({ ...e, receivedAt: e.receivedAt || new Date().toISOString() })), ...prev].slice(0, 100)
    )
  }, [])

  // Una sola rutina para el intervalo y para el boton Actualizar de Novedades:
  // antes estaba duplicada y habia que acordarse de tocar las dos copias.
  const traerNotificaciones = useCallback(async (abortado = () => false) => {
    try {
      const res = await fetch('/api/notifications/poll', { credentials: 'include' })
      if (!res.ok || abortado()) return
      procesarEventos(await res.json())
    } catch (_) {}
  }, [procesarEventos])

  useEffect(() => {
    if (!usuario) return
    let cancelado = false

    const poll = () => traerNotificaciones(() => cancelado)
    poll()
    const interval = setInterval(poll, 30000)
    return () => {
      cancelado = true
      clearInterval(interval)
    }
  }, [usuario, traerNotificaciones])

  const cerrarToast = useCallback((key) => {
    setToasts(prev => prev.filter(t => t.key !== key))
  }, [])

  const cerrarTodosLosToasts = useCallback(() => setToasts([]), [])

  const dismissNotification = (key) => {
    setNotifications(prev => prev.filter(n => n.type + '-' + n.id !== key))
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch { /* si falla la red igual cerramos del lado del cliente */ }
    setUsuario(null)
    setToasts([])
    setPage('inicio')
  }

  if (checkingSession) {
    return (
      <div className="app">
        <FondoIsolineas />
        <div className="loading">Cargando...</div>
      </div>
    )
  }

  if (!usuario) {
    return (
      <div className="app">
        <FondoIsolineas />
        <Login onLogin={setUsuario} />
      </div>
    )
  }

  // Cada pantalla se muestra si el usuario tiene su seccion. Antes esto era
  // "esJefe" y "esEquipo", que ataba lo que se ve al rol: con los permisos
  // configurables, el rol ya no alcanza para saberlo.
  const tiene = (seccion) => (usuario.secciones || []).includes(seccion)

  return (
    <div className={`app${sbChica ? ' app-sb-chica' : ''}`}>
      <FondoIsolineas />
      <Sidebar
        page={page}
        onNavigate={setPage}
        notifCount={notifications.length}
        usuario={usuario}
        onLogout={logout}
        chica={sbChica}
        onPlegar={() => setSbChica(v => !v)}
      />
      <main className="main">
        {/* Ahora que las secciones tienen direccion propia, cualquiera puede
            escribir una a mano. El backend igual no le va a dar los datos, pero
            sin esto veria una pantalla en blanco sin entender por que. */}
        {!puedeVer(page, usuario.secciones) && (
          <div className="sin-acceso">
            <h1 className="page-title">Esta sección no está disponible para vos</h1>
            <p>Tu rol ({usuario.rol}) no tiene acceso a esta parte del sistema.</p>
            <button className="btn" onClick={() => setPage('inicio')}>Ir al inicio</button>
          </div>
        )}

        {tiene('inicio') && page === 'inicio' && (
          <Inicio usuario={usuario} onNavigate={setPage} notifCount={notifications.length} />
        )}
        {tiene('home') && page === 'home' && (
          <Home
            notifications={notifications}
            onDismiss={dismissNotification}
            onRefresh={traerNotificaciones}
          />
        )}
        {tiene('tickets') && page === 'tickets' && <TicketsAbiertos esJefe={usuario.rol === 'jefe'} />}
        {tiene('kanban') && page === 'kanban' && <Kanban />}
        {tiene('pases') && page === 'pases' && <PasesProduccion />}
        {tiene('ficheros') && page === 'ficheros' && <Ficheros onVolver={() => setPage('inicio')} />}
        {tiene('eflow') && page === 'eflow' && <Eflow onVolver={() => setPage('inicio')} />}
        {tiene('generar_link') && page === 'generar_link' && <GenerarLink onVolver={() => setPage('inicio')} />}
        {tiene('stats') && page === 'stats' && <Estadisticas />}
        {tiene('soporte_tecnico') && page === 'soporte_tecnico' && <SoporteAplicaciones />}
        {tiene('soporte_dia') && page === 'soporte_dia' && <TicketsPorDia />}
        {tiene('reportes') && page === 'reportes' && <Reportes />}
        {tiene('usuarios') && page === 'usuarios' && (
          <Usuarios usuarioActual={usuario} onPermisosCambiados={releerUsuario} />
        )}
      </main>

      {/* Fuera del <main> porque va fijo a la ventana, no al contenido. */}
      <ToastsNotificaciones
        items={toasts}
        onCerrar={cerrarToast}
        onCerrarTodos={cerrarTodosLosToasts}
      />

      <style>{`
        .sin-acceso p { color: var(--text-muted); font-size: var(--fs-base); margin: 0 0 20px; }
      `}</style>
    </div>
  )
}
