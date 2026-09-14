import { useState, type FormEvent } from 'react'
import { useUser } from '../../context'
import './user.css'

interface ModalFormProps {
  initialName: string
  usuarioExistente: boolean
  onGuardar: (nombre: string) => void
  onCancelar: () => void
}

function IdentificarUsuarioForm({
  initialName,
  usuarioExistente,
  onGuardar,
  onCancelar,
}: ModalFormProps) {
  const [nombre, setNombre] = useState(initialName)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const nombreLimpio = nombre.trim()

    if (!nombreLimpio) {
      setError('Por favor, ingresa tu nombre.')
      return
    }

    if (nombreLimpio.length < 2) {
      setError('El nombre debe tener al menos 2 caracteres.')
      return
    }

    onGuardar(nombreLimpio)
  }

  return (
    <form onSubmit={handleSubmit} className="user-modal-form">
      <div className="user-modal-field">
        <label htmlFor="input-nombre-usuario" className="user-modal-label">
          Nombre de usuario
        </label>
        <input
          id="input-nombre-usuario"
          type="text"
          className="user-modal-input"
          placeholder="Ej. Lucas, Valentina..."
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value)
            if (error) setError(null)
          }}
          autoFocus
        />
        {error && <span className="user-modal-error">{error}</span>}
      </div>

      <div className="user-modal-actions">
        {usuarioExistente && (
          <button
            type="button"
            className="user-btn-secondary"
            onClick={onCancelar}
          >
            Cancelar
          </button>
        )}
        <button type="submit" className="user-btn-primary">
          {usuarioExistente ? 'Guardar Cambios' : 'Ingresar'}
        </button>
      </div>
    </form>
  )
}

export function IdentificarUsuarioModal() {
  const { usuario, identificar, isModalOpen, cerrarModal } = useUser()

  if (!isModalOpen) return null

  return (
    <div className="user-modal-overlay" role="dialog" aria-modal="true">
      <div className="user-modal-card">
        <div className="user-modal-header">
          <div>
            <h2 className="user-modal-title">
              {usuario ? 'Cambiar Identificación' : 'Identifícate para participar'}
            </h2>
            <p className="user-modal-description">
              Ingresa un nombre o apodo para pujar en las subastas en tiempo real.
            </p>
          </div>
          {usuario && (
            <button
              type="button"
              className="user-modal-close-btn"
              onClick={cerrarModal}
              title="Cerrar modal"
            >
              ✕
            </button>
          )}
        </div>

        <IdentificarUsuarioForm
          key={usuario ?? 'invitado'}
          initialName={usuario ?? ''}
          usuarioExistente={Boolean(usuario)}
          onGuardar={identificar}
          onCancelar={cerrarModal}
        />
      </div>
    </div>
  )
}
