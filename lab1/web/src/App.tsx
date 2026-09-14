import { useEffect, useState, useCallback } from 'react'
import { UserProvider } from './context'
import { UserBadge, IdentificarUsuarioModal } from './components/user'
import {
  ListaSubastas,
  DetalleSubasta,
  CrearSubastaModal,
} from './components/subastas'
import { listarSubastas } from './api/subastas'
import { useListadoSocket } from './hooks/useListadoSocket'
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

  // Consultar healthcheck de la API. credentials: 'omit' es a propósito: la
  // sticky cookie de Traefik (api_sticky) pinea todo /api a la misma réplica
  // una vez que el navegador la recibe, así que el botón "Probar balanceo"
  // mostraría siempre el mismo hostname después del primer click. Al no
  // mandar/guardar esa cookie acá, cada click vuelve a repartir round-robin.
  const verificarHealth = useCallback(() => {
    fetch('/api/health', { credentials: 'omit' })
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

  // Tiempo real en el listado: la card se actualiza sola con cada puja o
  // cierre de CUALQUIER subasta, y las que crean otros usuarios aparecen
  // sin refrescar. El `some(...)` evita duplicar la que uno mismo acaba de
  // crear (ya se agregó arriba, de forma optimista, al recibir la respuesta
  // del POST).
  useListadoSocket({
    onNuevaPuja: ({ id, montoActual }) => {
      setSubastas((prev) => prev.map((s) => (s.id === id ? { ...s, montoActual } : s)))
    },
    onSubastaCerrada: ({ id, ganador }) => {
      setSubastas((prev) =>
        prev.map((s) => (s.id === id ? { ...s, cerrada: true, ganador } : s)),
      )
    },
    onSubastaCreada: (subasta) => {
      setSubastas((prev) => (prev.some((s) => s.id === subasta.id) ? prev : [subasta, ...prev]))
    },
  })

  return (
    <div className="app-shell">
      {/* Header Principal con Identificación de Usuario (Fase 5) */}
      <header className="app-header">
        <div className="app-brand">
          <div className="app-brand-mark">🔨</div>
          <div className="app-brand-text">
            <h1>Rematé</h1>
            <span>Subastas en vivo · Tiempo real con Redis</span>
          </div>
        </div>
        <UserBadge />
      </header>

      {/* Banner de Infraestructura y Réplicas (Fase 0 & Fase 6) */}
      <section className="status-strip">
        <div className="status-strip-info">
          <span className={`status-dot ${errorApi ? 'error' : health ? 'ok' : ''}`} />
          {errorApi && <span>{errorApi}</span>}
          {!errorApi && !health && <span>Consultando /api/health…</span>}
          {health && (
            <span>
              API {health.status} · réplica <code>{health.hostname}</code>
            </span>
          )}
        </div>
        <button
          type="button"
          className="user-btn-secondary"
          onClick={verificarHealth}
          title="Verifica el balanceo de carga entre las réplicas"
        >
          Probar balanceo ↻
        </button>
      </section>

      <main className="app-main">
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
      </main>

      {/* Modales */}
      <IdentificarUsuarioModal />
      <CrearSubastaModal
        abierto={modalCrearAbierto}
        onCerrar={() => setModalCrearAbierto(false)}
        onSubastaCreada={handleSubastaCreada}
      />
    </div>
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
