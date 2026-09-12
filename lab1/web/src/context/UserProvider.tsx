import { useState, type ReactNode } from 'react'
import { UserContext } from './UserContext'

const STORAGE_KEY = 'subastas_usuario'

function getInitialUser(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<string | null>(getInitialUser)
  const [isModalOpen, setIsModalOpen] = useState<boolean>(() => !usuario)

  const identificar = (nombre: string) => {
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio) return
    setUsuario(nombreLimpio)
    try {
      localStorage.setItem(STORAGE_KEY, nombreLimpio)
    } catch (e) {
      console.error('No se pudo guardar el usuario en localStorage', e)
    }
    setIsModalOpen(false)
  }

  const cerrarSesion = () => {
    setUsuario(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      console.error('No se pudo borrar el usuario de localStorage', e)
    }
    setIsModalOpen(true)
  }

  const abrirModal = () => setIsModalOpen(true)
  const cerrarModal = () => setIsModalOpen(false)

  return (
    <UserContext.Provider
      value={{
        usuario,
        identificar,
        cerrarSesion,
        isModalOpen,
        abrirModal,
        cerrarModal,
      }}
    >
      {children}
    </UserContext.Provider>
  )
}
