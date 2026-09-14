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
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Cargando detalle de subasta...</div>
  }

  if (error || !subasta) {
    return (
      <div className="detalle-panel">
        <p style={{ color: '#dc2626' }}>{error || 'Subasta no encontrada'}</p>
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
            <button
              type="button"
              className="user-btn-secondary"
              onClick={onVolver}
              style={{ marginBottom: '0.5rem', paddingLeft: 0 }}
            >
              &larr; Volver a todas las subastas
            </button>
          )}
          <h2 className="detalle-title">{subasta.nombre}</h2>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>ID: {subasta.id}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
          {subasta.cerrada ? (
            <span className="badge badge-cerrada">Subasta Finalizada</span>
          ) : (
            <span className="badge badge-activa">
              Activa {segundosRestantes !== null ? `(${segundosRestantes}s restantes)` : ''}
            </span>
          )}

          <span
            style={{
              fontSize: '0.75rem',
              color: conectado ? '#16a34a' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: conectado ? '#16a34a' : '#94a3b8',
              }}
            />
            {conectado ? 'Socket en vivo' : 'Desconectado'}
          </span>
        </div>
      </div>

      {subasta.cerrada && (
        <div
          style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.25rem',
          }}
        >
          <h4 style={{ margin: 0, color: '#1e40af', fontSize: '1.1rem' }}>
            🏆 Ganador: <strong>{subasta.ganador ? subasta.ganador : 'Nadie pujó'}</strong>
          </h4>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem', color: '#3b82f6' }}>
            Monto final de cierre: ${subasta.montoActual}
          </p>
        </div>
      )}

      <div className="detalle-grid">
        {/* Bloque de Precio Actual */}
        <div className="monto-box">
          <p className="monto-label">Monto Actual</p>
          <p className={`monto-destacado ${animarMonto ? 'monto-animado' : ''}`}>
            ${subasta.montoActual}
          </p>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Precio inicial: ${subasta.montoInicial}
          </span>
        </div>

        {/* Bloque de Formulario de Puja */}
        <div className="puja-form-box">
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', color: '#0f172a' }}>
            Realizar una Puja
          </h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
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
                style={{ padding: '0.6rem 1.25rem' }}
              >
                {pujando ? 'Enviando...' : 'Pujar'}
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
                onClick={() => setMensajeResultado(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                &times;
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Historial de Pujas en Vivo */}
      <div className="historial-box">
        <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1.05rem', color: '#1e293b' }}>
          Historial de Pujas ({subasta.historial.length})
        </h3>
        {subasta.historial.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: 0 }}>
            Aún no se registraron ofertas para esta subasta. ¡Sé el primero en ofertar!
          </p>
        ) : (
          <div className="historial-lista">
            {subasta.historial.map((p, idx) => (
              <div key={`${p.timestamp}-${idx}`} className="historial-item">
                <div>
                  <strong>👤 {p.usuario}</strong>
                  <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: '0.5rem' }}>
                    {new Date(p.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ fontWeight: 700, color: '#15803d' }}>
                  ${p.monto}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
