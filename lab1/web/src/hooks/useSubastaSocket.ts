import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

interface NuevaPujaPayload {
  montoActual: number
  usuario: string
}

interface SubastaCerradaPayload {
  ganador: string | null
}

interface UseSubastaSocketOptions {
  subastaId: string | null
  onNuevaPuja?: (payload: NuevaPujaPayload) => void
  onSubastaCerrada?: (payload: SubastaCerradaPayload) => void
}

export function useSubastaSocket({
  subastaId,
  onNuevaPuja,
  onSubastaCerrada,
}: UseSubastaSocketOptions) {
  const [conectado, setConectado] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  const onNuevaPujaRef = useRef(onNuevaPuja)
  const onSubastaCerradaRef = useRef(onSubastaCerrada)

  useEffect(() => {
    onNuevaPujaRef.current = onNuevaPuja
    onSubastaCerradaRef.current = onSubastaCerrada
  }, [onNuevaPuja, onSubastaCerrada])

  useEffect(() => {
    // El path configurado en AGENTS.md y realtime.gateway.ts es /api/socket.io/
    const socket = io({
      path: '/api/socket.io/',
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConectado(true)
    })

    socket.on('disconnect', () => {
      setConectado(false)
    })

    socket.on('nuevaPuja', (payload: NuevaPujaPayload) => {
      if (onNuevaPujaRef.current) {
        onNuevaPujaRef.current(payload)
      }
    })

    socket.on('subastaCerrada', (payload: SubastaCerradaPayload) => {
      if (onSubastaCerradaRef.current) {
        onSubastaCerradaRef.current(payload)
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  // Cuando cambia subastaId, suscribirse en el socket ya existente
  useEffect(() => {
    if (socketRef.current && socketRef.current.connected && subastaId) {
      socketRef.current.emit('suscribirseASubasta', subastaId)
    }
  }, [subastaId])

  return { conectado }
}
