import { createContext } from 'react'

export interface UserContextType {
  usuario: string | null
  identificar: (nombre: string) => void
  cerrarSesion: () => void
  isModalOpen: boolean
  abrirModal: () => void
  cerrarModal: () => void
}

export const UserContext = createContext<UserContextType | undefined>(undefined)
