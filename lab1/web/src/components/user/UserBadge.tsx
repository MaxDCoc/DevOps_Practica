import { useUser } from '../../context'
import './user.css'

export function UserBadge() {
  const { usuario, abrirModal, cerrarSesion } = useUser()

  if (!usuario) {
    return (
      <div className="user-badge-container">
        <span className="user-badge-info">👤 Invitado</span>
        <button
          type="button"
          className="user-btn-primary"
          onClick={abrirModal}
        >
          Identificarse
        </button>
      </div>
    )
  }

  return (
    <div className="user-badge-container">
      <span className="user-badge-info">
        👤 <span className="user-badge-name">{usuario}</span>
      </span>
      <button
        type="button"
        className="user-btn-secondary"
        onClick={abrirModal}
        title="Cambiar nombre de usuario"
      >
        Cambiar
      </button>
      <button
        type="button"
        className="user-btn-secondary"
        onClick={cerrarSesion}
        title="Cerrar sesión"
      >
        Salir
      </button>
    </div>
  )
}
