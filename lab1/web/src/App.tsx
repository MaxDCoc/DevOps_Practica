import { useEffect, useState } from 'react'
import { UserProvider, useUser } from './context'
import { UserBadge, IdentificarUsuarioModal } from './components/user'
import './App.css'

type Health = { status: string; hostname: string }

function SubastasApp() {
  const { usuario, abrirModal } = useUser()
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Estado para la simulación de puja (Fase 5 -> Contrato con Fase 2)
  const [montoPuja, setMontoPuja] = useState<number>(150)
  const [ultimoEnvio, setUltimoEnvio] = useState<{
    subastaId: string
    payload: { monto: number; usuario: string }
    timestamp: string
  } | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setError('No se pudo conectar con la API'))
  }, [])

  const handleSimularPuja = () => {
    if (!usuario) {
      abrirModal()
      return
    }

    // Contrato pactado en AGENTS.md: POST /api/subastas/:id/pujas -> { monto, usuario }
    const subastaId = 'subasta-demo-1'
    const payload = {
      monto: montoPuja,
      usuario: usuario,
    }

    setUltimoEnvio({
      subastaId,
      payload,
      timestamp: new Date().toLocaleTimeString(),
    })
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', color: '#0f172a' }}>Sistema de Subastas</h1>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>DevOps UTN FRRe 2026 — Fase 5: Identificación de Usuario</span>
        </div>
        <UserBadge />
      </header>

      {/* Estado del contenedor (Fase 0) */}
      <section style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', color: '#334155' }}>Infraestructura (Fase 0)</h3>
        {error && <p style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
        {!error && !health && <p style={{ margin: 0, color: '#64748b' }}>Consultando /api/health...</p>}
        {health && (
          <p style={{ margin: 0, color: '#16a34a' }}>
            API status: <strong>{health.status}</strong> — respondió el contenedor <code>{health.hostname}</code>
          </p>
        )}
      </section>

      {/* Simulación de Puja con Usuario Identificado (Fase 5) */}
      <section style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <h2 style={{ fontSize: '1.25rem', marginTop: 0, color: '#0f172a' }}>
          Simulación de Puja (Verificación Fase 5)
        </h2>
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
          Demuestra la integración de la identidad del usuario con el contrato de la API: <code>POST /api/subastas/:id/pujas</code>.
        </p>

        <div style={{ background: '#f1f5f9', padding: '1rem', borderRadius: '6px', margin: '1rem 0' }}>
          <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>Artículo: MacBook Pro M3 Max</p>
          <p style={{ margin: '0 0 0.5rem 0', color: '#475569', fontSize: '0.9rem' }}>
            Usuario actual en sesión: <strong>{usuario ? `👤 ${usuario}` : '⚠️ Ninguno (se solicitará identificación)'}</strong>
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem' }}>
            <label htmlFor="monto-input" style={{ fontSize: '0.9rem', fontWeight: 500 }}>
              Monto a pujar ($):
            </label>
            <input
              id="monto-input"
              type="number"
              value={montoPuja}
              onChange={(e) => setMontoPuja(Number(e.target.value))}
              style={{ padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid #cbd5e1', width: '100px' }}
            />
            <button
              type="button"
              onClick={handleSimularPuja}
              style={{
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                padding: '0.45rem 1rem',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Realizar Puja
            </button>
          </div>
        </div>

        {ultimoEnvio && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '6px' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#065f46' }}>
              ✅ Payload generado para <code>POST /api/subastas/{ultimoEnvio.subastaId}/pujas</code> ({ultimoEnvio.timestamp}):
            </h4>
            <pre style={{ margin: 0, background: '#ffffff', padding: '0.75rem', borderRadius: '4px', border: '1px solid #d1fae5', overflowX: 'auto' }}>
              {JSON.stringify(ultimoEnvio.payload, null, 2)}
            </pre>
          </div>
        )}
      </section>

      {/* Modal de Identificación */}
      <IdentificarUsuarioModal />
    </main>
  )
}

export function App() {
  return (
    <UserProvider>
      <SubastasApp />
    </UserProvider>
  )
}

export default App
