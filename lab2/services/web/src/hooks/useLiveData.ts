import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, getHealth, getStats, listPipelines } from '../api'
import type { Health, JobState, Stats } from '../types'

const POLL_MS = 2000

function describe(reason: unknown): string {
  if (reason instanceof ApiError) return reason.message
  if (reason instanceof TypeError) return 'No se pudo conectar con la API'
  if (reason instanceof Error) return reason.message
  return 'Error inesperado consultando la API'
}

export interface LiveData {
  pipelines: JobState[]
  stats: Stats | null
  health: Health | null
  error: string | null
  lastUpdate: Date | null
  loading: boolean
  refresh: () => void
}

/**
 * Refresca lista + stats + health cada 2 s, como pide el contrato del dashboard.
 * Con la pestaña oculta no consulta: al volver, refresca una vez.
 */
export function useLiveData(): LiveData {
  const [pipelines, setPipelines] = useState<JobState[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      // allSettled y no all: si /stats falla (cola caída) la lista sigue sirviendo.
      const [list, statsResult, healthResult] = await Promise.allSettled([
        listPipelines(),
        getStats(),
        getHealth(),
      ])

      if (list.status === 'fulfilled') {
        setPipelines(list.value)
        setError(null)
      } else {
        setError(describe(list.reason))
      }

      setStats(statsResult.status === 'fulfilled' ? statsResult.value : null)
      setHealth(healthResult.status === 'fulfilled' ? healthResult.value : null)
      setLastUpdate(new Date())
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      if (!document.hidden) void refresh()
    }, POLL_MS)
    const onVisible = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const reload = useCallback(() => {
    void refresh()
  }, [refresh])

  return { pipelines, stats, health, error, lastUpdate, loading, refresh: reload }
}
