import { useState, useEffect, useRef } from 'react'
import Navbar from './components/Navbar'
import DottedSurface from './components/DottedSurface'
import Home from './pages/Home'
import TicketsAbiertos from './pages/TicketsAbiertos'
import SoporteAplicaciones from './pages/SoporteAplicaciones'
import TicketsPorDia from './pages/TicketsPorDia'
import Estadisticas from './pages/Estadisticas'
import Reportes from './pages/Reportes'
import PasesProduccion from './pages/PasesProduccion'
import './App.css'

const VALID_TYPES = ['new_ticket', 'new_followup', 'solution_rejected']

function notifContent(data) {
  if (data.type === 'new_ticket') {
    return { title: 'Ticket nuevo #' + data.id, body: data.title || '' }
  }
  if (data.type === 'new_followup') {
    const text = (data.content || '').replace(/<[^>]*>/g, '').slice(0, 120)
    return {
      title: 'Seguimiento en ticket #' + data.ticket_id,
      body: data.author + (text ? ': ' + text : ''),
    }
  }
  if (data.type === 'solution_rejected') {
    return { title: 'Solución rechazada #' + data.ticket_id, body: data.ticket_title || '' }
  }
  return { title: 'Nueva notificacion GLPI', body: '' }
}

function showBrowserNotif(data, key) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const { title, body } = notifContent(data)
  const n = new Notification(title, { body, icon: '/favicon.svg', tag: key })
  n.onclick = () => { window.focus(); n.close() }
}

export default function App() {
  const [page, setPage] = useState('home')
  const [notifications, setNotifications] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('glpi_notifications') || '[]')
      return stored.filter(n => VALID_TYPES.includes(n.type))
    } catch { return [] }
  })
  const seenRef = useRef(null)
  if (!seenRef.current) {
    try {
      const stored = JSON.parse(localStorage.getItem('glpi_notifications') || '[]')
      seenRef.current = new Set(stored.map(n => n.type + '-' + n.id))
    } catch {
      seenRef.current = new Set()
    }
  }

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('glpi_notifications', JSON.stringify(notifications))
  }, [notifications])

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch('/api/notifications/poll')
        if (!res.ok || cancelled) return
        const events = await res.json()
        if (!events.length) return

        const fresh = events
          .filter(e => VALID_TYPES.includes(e.type))
          .filter(e => {
            const key = e.type + '-' + e.id
            if (seenRef.current.has(key)) return false
            seenRef.current.add(key)
            showBrowserNotif(e, key)
            return true
          })
        if (!fresh.length) return
        setNotifications(prev =>
          [...fresh.map(e => ({ ...e, receivedAt: new Date().toISOString() })), ...prev].slice(0, 100)
        )
      } catch (_) {}
    }

    poll()
    const interval = setInterval(poll, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const dismissNotification = (key) => {
    setNotifications(prev => prev.filter(n => n.type + '-' + n.id !== key))
  }

  const refreshNotifications = async () => {
    try {
      const res = await fetch('/api/notifications/poll')
      if (!res.ok) return
      const events = await res.json()
      if (!events.length) return
      const fresh = events.filter(e => VALID_TYPES.includes(e.type)).filter(e => {
        const key = e.type + '-' + e.id
        if (seenRef.current.has(key)) return false
        seenRef.current.add(key)
        showBrowserNotif(e, key)
        return true
      })
      if (!fresh.length) return
      setNotifications(prev =>
        [...fresh.map(e => ({ ...e, receivedAt: new Date().toISOString() })), ...prev].slice(0, 100)
      )
    } catch (_) {}
  }

  return (
    <div className="app">
      <DottedSurface />
      <Navbar page={page} onNavigate={setPage} notifCount={notifications.length} />
      <main className="main">
        {page === 'home' && (
          <Home
            notifications={notifications}
            onDismiss={dismissNotification}
            onRefresh={refreshNotifications}
          />
        )}
        {page === 'tickets' && <TicketsAbiertos />}
        {page === 'soporte_tecnico' && <SoporteAplicaciones />}
        {page === 'soporte_dia' && <TicketsPorDia />}
        {page === 'stats' && <Estadisticas />}
        {page === 'reportes' && <Reportes />}
        {page === 'pases' && <PasesProduccion />}
      </main>
    </div>
  )
}
