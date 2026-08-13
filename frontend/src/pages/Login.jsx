import { useState } from 'react'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || 'No se pudo iniciar sesion')
        return
      }
      setPassword('')
      onLogin(data)
    } catch {
      setError('No se pudo conectar con el servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card card" onSubmit={submit}>
        <h1 className="login-title">Soporte Aplicaciones</h1>
        <p className="login-sub">Ingresa con tu usuario de red</p>

        {error && <div className="error-banner">{error}</div>}

        <label className="login-label" htmlFor="username">Usuario</label>
        <input
          id="username"
          className="login-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="u00000"
          autoComplete="username"
          autoFocus
          disabled={loading}
        />

        <label className="login-label" htmlFor="password">Contrasena</label>
        <input
          id="password"
          className="login-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={loading}
        />

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? 'Verificando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}
