import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import type { Subasta } from '../types/subasta'

interface NuevaPujaGlobalPayload {
  id: string
  montoActual: number
  usuario: string
}

interface SubastaCerradaGlobalPayload {
  id: string
  ganador: string | null
}

interface UseListadoSocketOptions {
  onNuevaPuja?: (payload: NuevaPujaGlobalPayload) => void
  onSubastaCerrada?: (payload: SubastaCerradaGlobalPayload) => void
  onSubastaCreada?: (subasta: Subasta) => void
}

// Hermano de useSubastaSocket, pero para el listado: en vez de suscribirse a
// la sala de UNA subasta, escucha los broadcasts globales (a todos los
// conectados) para que las cards se actualicen solas sin entrar al detalle.
// Va en un archivo separado a propósito, para no arriesgar el hook del
// detalle (que ya está probado) al tocar esto.
export function useListadoSocket({
  onNuevaPuja,
  onSubastaCerrada,
  onSubastaCreada,
}: UseListadoSocketOptions) {
  const onNuevaPujaRef = useRef(onNuevaPuja)
  const onSubastaCerradaRef = useRef(onSubastaCerrada)
  const onSubastaCreadaRef = useRef(onSubastaCreada)

  useEffect(() => {
    onNuevaPujaRef.current = onNuevaPuja
    onSubastaCerradaRef.current = onSubastaCerrada
    onSubastaCreadaRef.current = onSubastaCreada
  }, [onNuevaPuja, onSubastaCerrada, onSubastaCreada])

  useEffect(() => {
    const socket: Socket = io({
      path: '/api/socket.io/',
      transports: ['websocket', 'polling'],
    })

    socket.on('nuevaPujaGlobal', (payload: NuevaPujaGlobalPayload) => {
      onNuevaPujaRef.current?.(payload)
    })

    socket.on('subastaCerradaGlobal', (payload: SubastaCerradaGlobalPayload) => {
      onSubastaCerradaRef.current?.(payload)
    })

    socket.on('subastaCreada', (subasta: Subasta) => {
      onSubastaCreadaRef.current?.(subasta)
    })

    return () => {
      socket.disconnect()
    }
  }, [])
}
