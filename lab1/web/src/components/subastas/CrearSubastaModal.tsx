import React, { useState } from 'react'
import { crearSubasta } from '../../api/subastas'
import type { Subasta } from '../../types/subasta'

interface CrearSubastaModalProps {
  abierto: boolean
  onCerrar: () => void
  onSubastaCreada: (subasta: Subasta) => void
}

export function CrearSubastaModal({
  abierto,
  onCerrar,
  onSubastaCreada,
}: CrearSubastaModalProps) {
  const [nombre, setNombre] = useState('')
  const [montoInicial, setMontoInicial] = useState<number>(100)
  const [duracionSegundos, setDuracionSegundos] = useState<number>(60)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!abierto) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nombre.trim()) {
      setError('El nombre del ítem es requerido.')
      return
    }
    if (montoInicial <= 0) {
      setError('El monto inicial debe ser mayor a 0.')
      return
    }
    if (duracionSegundos <= 0) {
      setError('La duración debe ser mayor a 0 segundos.')
      return
    }

    try {
      setCargando(true)
      setError(null)
      const nueva = await crearSubasta({
        nombre: nombre.trim(),
        montoInicial: Number(montoInicial),
        duracionSegundos: Number(duracionSegundos),
      })
      onSubastaCreada(nueva)
      onCerrar()
      setNombre('')
      setMontoInicial(100)
      setDuracionSegundos(60)
    } catch (err: any) {
      setError(err.message || 'Error al crear la subasta')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="user-modal-overlay" role="dialog" aria-modal="true">
      <div className="user-modal-card">
        <div className="user-modal-header">
          <div>
            <h2 className="user-modal-title">Nueva Subasta</h2>
            <p className="user-modal-description">
              Publica un ítem con precio base y tiempo límite.
            </p>
          </div>
          <button
            type="button"
            className="user-modal-close-btn"
            onClick={onCerrar}
            aria-label="Cerrar modal"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="user-modal-form">
          <div className="user-modal-field">
            <label htmlFor="subasta-nombre" className="user-modal-label">
              Nombre del artículo o ítem
            </label>
            <input
              id="subasta-nombre"
              type="text"
              className="user-modal-input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. MacBook Pro M3, Play 5, Cuadro..."
              autoFocus
            />
          </div>

          <div className="user-modal-field">
            <label htmlFor="subasta-monto" className="user-modal-label">
              Monto inicial ($)
            </label>
            <input
              id="subasta-monto"
              type="number"
              min="1"
              className="user-modal-input"
              value={montoInicial}
              onChange={(e) => setMontoInicial(Number(e.target.value))}
            />
          </div>

          <div className="user-modal-field">
            <label htmlFor="subasta-duracion" className="user-modal-label">
              Duración en segundos (TTL en Redis)
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem' }}>
              <button
                type="button"
                className="user-btn-secondary"
                onClick={() => setDuracionSegundos(20)}
              >
                Rápida (20s)
              </button>
              <button
                type="button"
                className="user-btn-secondary"
                onClick={() => setDuracionSegundos(60)}
              >
                Normal (60s)
              </button>
              <button
                type="button"
                className="user-btn-secondary"
                onClick={() => setDuracionSegundos(180)}
              >
                3 minutos
              </button>
            </div>
            <input
              id="subasta-duracion"
              type="number"
              min="5"
              className="user-modal-input"
              value={duracionSegundos}
              onChange={(e) => setDuracionSegundos(Number(e.target.value))}
            />
          </div>

          {error && <span className="user-modal-error">{error}</span>}

          <div className="user-modal-actions">
            <button
              type="button"
              className="user-btn-secondary"
              onClick={onCerrar}
              disabled={cargando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="user-btn-primary"
              disabled={cargando}
            >
              {cargando ? 'Publicando...' : 'Crear Subasta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
