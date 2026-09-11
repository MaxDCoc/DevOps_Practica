import { useEffect, useState } from 'react'
import './App.css'

type Health = { status: string; hostname: string }

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setError('No se pudo conectar con la API'))
  }, [])

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Sistema de Subastas</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!error && !health && <p>Consultando /api/health...</p>}
      {health && (
        <p>
          API status: <strong>{health.status}</strong> — respondió el
          contenedor <code>{health.hostname}</code>
        </p>
      )}
    </main>
  )
}

export default App
