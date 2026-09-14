import React, { useEffect, useState, useCallback } from 'react'
import { obtenerSubasta, realizarPuja } from '../../api/subastas'
import { useUser } from '../../context'
import { useSubastaSocket } from '../../hooks/useSubastaSocket'
import type { SubastaDetalle } from '../../types/subasta'

interface DetalleSubastaProps {
  subastaId: string
  onVolver?: () => void
  onSubastaActualizada?: (subasta: SubastaDetalle) => void
}

export function DetalleSubasta({
  subastaId,
  onVolver,
  onSubastaActualizada,
}: DetalleSubastaProps) {
  const { usuario, abrirModal } = useUser()
  const [subasta, setSubasta] = useState<SubastaDetalle | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Estado del formulario de puja
  const [montoPuja, setMontoPuja] = useState<number>(0)
  const [pujando, setPujando] = useState(false)
  const [modoIngenua, setModoIngenua] = useState(false)
  const [mensajeResultado, setMensajeResultado] = useState<{
    tipo: 'success' | 'error'
    texto: string
  } | null>(null)

  // Countdown
  const [segundosRestantes, setSegundosRestantes] = useState<number | null>(null)
  const [animarMonto, setAnimarMonto] = useState(false)

  // Cargar datos iniciales
  const recargar = useCallback(async () => {
    try {
      setCargando(true)
      setError(null)
      const data = await obtenerSubasta(subastaId)
      setSubasta(data)
      setMontoPuja(data.montoActual + 10)
      if (onSubastaActualizada) onSubastaActualizada(data)
    } catch (err: any) {
      setError(err.message || 'Error al cargar detalle')
    } finally {
      setCargando(false)
    }
  }, [subastaId, onSubastaActualizada])

  useEffect(() => {
    recargar()
  }, [recargar])

  // Socket en tiempo real (Fase 4 Web)
  const { conectado } = useSubastaSocket({
    subastaId,
    onNuevaPuja: ({ montoActual, usuario: pujaUsuario }) => {
      setSubasta((prev) => {
        if (!prev) return null
        const nuevoHistorial = [
          { monto: montoActual, usuario: pujaUsuario, timestamp: Date.now() },
          ...prev.historial,
        ]
        return {
          ...prev,
          montoActual,
          historial: nuevoHistorial,
        }
      })
      setMontoPuja(montoActual + 10)
      setAnimarMonto(true)
      setTimeout(() => setAnimarMonto(false), 1000)
    },
    onSubastaCerrada: ({ ganador }) => {
      setSubasta((prev) => {
        if (!prev) return null
        return {
          ...prev,
          cerrada: true,
          ganador,
        }
      })
      setSegundosRestantes(0)
    },
  })

  const subastaCreadaEn = subasta?.creadaEn
  const subastaDuracion = subasta?.duracionSegundos
  const subastaCerrada = subasta?.cerrada

  // Temporizador de cuenta regresiva
  useEffect(() => {
    if (!subastaCreadaEn || !subastaDuracion || subastaCerrada) {
      return
    }

    const expiraEn = subastaCreadaEn + subastaDuracion * 1000
    const actualizarCountdown = () => {
      const diff = Math.max(0, Math.floor((expiraEn - Date.now()) / 1000))
      setSegundosRestantes(diff)
    }

    actualizarCountdown()
    const interval = setInterval(actualizarCountdown, 1000)
    return () => clearInterval(interval)
  }, [subastaCreadaEn, subastaDuracion, subastaCerrada])

  const handlePujar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!usuario) {
      abrirModal()
      return
    }
    if (!subasta) return

    if (montoPuja <= subasta.montoActual) {
      setMensajeResultado({
        tipo: 'error',
        texto: `El monto debe superar la puja actual de $${subasta.montoActual}.`,
      })
      return
    }

    try {
      setPujando(true)
      setMensajeResultado(null)
      const res = await realizarPuja(subasta.id, montoPuja, usuario, modoIngenua)

      if (res.ok) {
        setMensajeResultado({
          tipo: 'success',
          texto: `¡Puja de $${res.montoActual} registrada exitosamente!`,
        })
      } else {
        if (res.motivo === 'superada') {
          setMensajeResultado({
            tipo: 'error',
            texto: `¡Te superaron! El monto actual ya es $${res.montoActual}.`,
          })
          setMontoPuja(res.montoActual + 10)
        } else if (res.motivo === 'cerrada') {
          setMensajeResultado({
            tipo: 'error',
            texto: 'La subasta ya cerró y no acepta nuevas pujas.',
          })
        } else {
          setMensajeResultado({
            tipo: 'error',
            texto: `No se pudo registrar la puja (${res.motivo || 'rechazada'}).`,
          })
        }
      }
    } catch (err: any) {
      setMensajeResultado({
        tipo: 'error',
        texto: err.message || 'Error al comunicarse con la API de pujas.',
      })
    } finally {
      setPujando(false)
    }
  }

  if (cargando) {
    return <div className="subastas-loading">Cargando detalle de subasta…</div>
  }

  if (error || !subasta) {
    return (
      <div className="detalle-panel">
        <p className="alert alert-error">{error || 'Subasta no encontrada'}</p>
        {onVolver && (
          <button type="button" className="user-btn-secondary" onClick={onVolver}>
            &larr; Volver al listado
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="detalle-panel">
      <div className="detalle-header">
        <div>
          {onVolver && (
            <button type="button" className="detalle-back" onClick={onVolver}>
              &larr; Volver a todas las subastas
            </button>
          )}
          <h2 className="detalle-title">{subasta.nombre}</h2>
          <span className="detalle-id">ID: {subasta.id}</span>
        </div>

        <div className="detalle-status">
          {subasta.cerrada ? (
            <span className="badge badge-cerrada">Subasta finalizada</span>
          ) : (
            <span className="badge badge-live">
              <span className="pulse-dot" /> Activa
              {segundosRestantes !== null ? ` · ${segundosRestantes}s restantes` : ''}
            </span>
          )}

          <span
            className="detalle-socket-indicator"
            style={{ color: conectado ? 'var(--success)' : 'var(--text-dim)' }}
          >
            <span
              className="detalle-socket-dot"
              style={{ background: conectado ? 'var(--success)' : 'var(--text-dim)' }}
            />
            {conectado ? 'Socket en vivo' : 'Desconectado'}
          </span>
        </div>
      </div>

      {subasta.cerrada && (
        <div className="ganador-banner">
          <h4>🏆 Ganador: {subasta.ganador ? subasta.ganador : 'Nadie pujó'}</h4>
          <p>Monto final de cierre: ${subasta.montoActual}</p>
        </div>
      )}

      <div className="detalle-grid">
        {/* Bloque de Precio Actual */}
        <div className="monto-box">
          <p className="monto-label">Monto Actual</p>
          <p className={`monto-destacado ${animarMonto ? 'monto-animado' : ''}`}>
            ${subasta.montoActual}
          </p>
          <span className="subtitle">Precio inicial: ${subasta.montoInicial}</span>
        </div>

        {/* Bloque de Formulario de Puja */}
        <div className="puja-form-box">
          <h3>Realizar una puja</h3>
          <p className="pujando-como">
            {usuario ? (
              <>Pujando como <strong>👤 {usuario}</strong></>
            ) : (
              <>⚠️ No has ingresado tu nombre aún</>
            )}
          </p>

          <form onSubmit={handlePujar}>
            <div className="puja-input-group">
              <input
                type="number"
                min={subasta.montoActual + 1}
                step="1"
                disabled={subasta.cerrada || pujando}
                className="puja-input"
                value={montoPuja}
                onChange={(e) => setMontoPuja(Number(e.target.value))}
              />
              <button
                type="submit"
                className="user-btn-primary"
                disabled={subasta.cerrada || pujando}
              >
                {pujando ? 'Enviando…' : 'Pujar'}
              </button>
            </div>

            {/* Selector de versión para la Demo (AGENTS.md) */}
            <div className="demo-toggle-container">
              <input
                type="checkbox"
                id="toggle-ingenua"
                checked={modoIngenua}
                onChange={(e) => setModoIngenua(e.target.checked)}
              />
              <label htmlFor="toggle-ingenua" style={{ cursor: 'pointer' }}>
                <strong>Demo Concurrencia:</strong> usar endpoint <code>/pujas/ingenua</code> (sin atomicidad)
              </label>
            </div>
          </form>

          {mensajeResultado && (
            <div
              className={`alert ${
                mensajeResultado.tipo === 'success' ? 'alert-success' : 'alert-error'
              }`}
            >
              <span>{mensajeResultado.texto}</span>
              <button
                type="button"
                className="alert-close"
                onClick={() => setMensajeResultado(null)}
              >
                &times;
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Historial de Pujas en Vivo */}
      <div className="historial-box">
        <h3>Historial de pujas ({subasta.historial.length})</h3>
        {subasta.historial.length === 0 ? (
          <p className="historial-vacio">
            Aún no se registraron ofertas para esta subasta. ¡Sé el primero en ofertar!
          </p>
        ) : (
          <div className="historial-lista">
            {subasta.historial.map((p, idx) => (
              <div key={`${p.timestamp}-${idx}`} className="historial-item">
                <div className="historial-usuario">
                  <span className="historial-avatar">
                    {p.usuario.slice(0, 2).toUpperCase()}
                  </span>
                  <strong>{p.usuario}</strong>
                  <span className="historial-hora">
                    {new Date(p.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="historial-monto">${p.monto}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
