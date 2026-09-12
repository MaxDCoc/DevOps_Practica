import { useEffect, useState, useCallback } from 'react'
import { UserProvider } from './context'
import { UserBadge, IdentificarUsuarioModal } from './components/user'
import {
  ListaSubastas,
  DetalleSubasta,
  CrearSubastaModal,
} from './components/subastas'
import { listarSubastas } from './api/subastas'
import type { Subasta } from './types/subasta'
import './App.css'

type Health = { status: string; hostname: string }

function SubastasApp() {
  const [health, setHealth] = useState<Health | null>(null)
  const [errorApi, setErrorApi] = useState<string | null>(null)

  const [subastas, setSubastas] = useState<Subasta[]>([])
  const [cargandoSubastas, setCargandoSubastas] = useState(true)
  const [subastaSeleccionadaId, setSubastaSeleccionadaId] = useState<string | null>(null)
  const [modalCrearAbierto, setModalCrearAbierto] = useState(false)

  // Consultar healthcheck de la API
  const verificarHealth = useCallback(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: Health) => {
        setHealth(data)
        setErrorApi(null)
      })
      .catch(() => setErrorApi('No se pudo conectar con la API (verificar Traefik o contenedor api)'))
  }, [])

  // Listar subastas reales desde Redis
  const cargarSubastas = useCallback(async () => {
    try {
      setCargandoSubastas(true)
      const data = await listarSubastas()
      setSubastas(data)
    } catch {
      // Si la API falla, queda vacía o maneja el error
    } finally {
      setCargandoSubastas(false)
    }
  }, [])

  useEffect(() => {
    verificarHealth()
    cargarSubastas()
  }, [verificarHealth, cargarSubastas])

  const handleSubastaCreada = (nueva: Subasta) => {
    setSubastas((prev) => [nueva, ...prev])
    setSubastaSeleccionadaId(nueva.id)
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '900px', margin: '0 auto', padding: '1.5rem' }}>
      {/* Header Principal con Identificación de Usuario (Fase 5) */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '1rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', color: '#0f172a' }}>
            🔨 Sistema de Subastas
          </h1>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            TP DevOps UTN FRRe 2026 — Tiempo Real & Concurrencia con Redis
          </span>
        </div>
        <UserBadge />
      </header>

      {/* Banner de Infraestructura y Réplicas (Fase 0 & Fase 6) */}
      <section
        style={{
          background: '#f8fafc',
          padding: '0.85rem 1.25rem',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block' }}>
            Infraestructura (API & Proxy Traefik)
          </span>
          {errorApi && <span style={{ color: '#dc2626', fontSize: '0.85rem' }}>{errorApi}</span>}
          {!errorApi && !health && (
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Consultando /api/health...</span>
          )}
          {health && (
            <span style={{ color: '#16a34a', fontSize: '0.85rem' }}>
              API: <strong>{health.status}</strong> — Atendió la réplica: <code>{health.hostname}</code>
            </span>
          )}
        </div>
        <button
          type="button"
          className="user-btn-secondary"
          onClick={verificarHealth}
          title="Verifica el balanceo de carga entre las réplicas"
          style={{ fontSize: '0.8rem', border: '1px solid #cbd5e1' }}
        >
          🔄 Probar balanceo
        </button>
      </section>

      {/* Vista Principal: Detalle o Listado */}
      {subastaSeleccionadaId ? (
        <DetalleSubasta
          subastaId={subastaSeleccionadaId}
          onVolver={() => {
            setSubastaSeleccionadaId(null)
            cargarSubastas()
          }}
        />
      ) : (
        <ListaSubastas
          subastas={subastas}
          subastaSeleccionadaId={subastaSeleccionadaId}
          onSeleccionar={(id) => setSubastaSeleccionadaId(id)}
          onCrearClick={() => setModalCrearAbierto(true)}
          cargando={cargandoSubastas}
        />
      )}

      {/* Modales */}
      <IdentificarUsuarioModal />
      <CrearSubastaModal
        abierto={modalCrearAbierto}
        onCerrar={() => setModalCrearAbierto(false)}
        onSubastaCreada={handleSubastaCreada}
      />
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
