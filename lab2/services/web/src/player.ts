// Reproductor de "historias": cada pedido se guarda como una lista de pasos y se muestra de a uno,
// al ritmo de quien presenta. El sistema real puede ir más rápido o más lento: la explicación
// nunca se apura ni se saltea pasos; si el siguiente paso todavía no ocurrió, espera.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Backend, FlowEvent, FlowEventInput } from './types'

export type Speed = 'lento' | 'normal' | 'rapido'
export const TRAVEL_MS: Record<Speed, number> = { lento: 2200, normal: 1400, rapido: 700 }
/** Tiempo para leer el texto, después de que llegó el paquete (solo en reproducción automática). */
export const READ_MS: Record<Speed, number> = { lento: 7000, normal: 4500, rapido: 1800 }

export interface Story {
  key: string
  jobId?: string
  project: string
  steps: FlowEvent[]
  final: boolean
}

const MAX_STORIES = 200

// Vista en vivo: todos los pedidos a la vez. Los pasos de un mismo pedido salen en orden,
// de a uno por vez, pero rápido; los pedidos distintos se mueven en paralelo.
export const LIVE_HOP_MS = 500
const MAX_LIVE = 300

export interface LiveCounters {
  requests: number
  valid: number
  rejected: number
  responses: number
  published: number
  delivered: number
  acked: number
  redelivered: number
  failedStages: number
  traces: number
}
const ZERO: LiveCounters = { requests: 0, valid: 0, rejected: 0, responses: 0, published: 0, delivered: 0, acked: 0, redelivered: 0, failedStages: 0, traces: 0 }

function count(c: LiveCounters, e: FlowEventInput): LiveCounters {
  const n = { ...c }
  if (e.kind === 'http-req' && e.from === 'browser') n.requests++
  if (e.kind === 'http-res' && e.from === 'validator') e.tone === 'ok' ? n.valid++ : n.rejected++
  if (e.kind === 'http-res' && e.to === 'browser') n.responses++
  if (e.kind === 'publish') n.published++
  if (e.kind === 'deliver') n.delivered++
  if (e.kind === 'ack') n.acked++
  if (e.kind === 'redeliver') n.redelivered++
  if (e.kind === 'stage-end' && !e.meta?.ok) n.failedStages++
  if (e.kind === 'span') n.traces++
  return n
}

export function useStoryPlayer(backend: Backend) {
  const stories = useRef(new Map<string, Story>())
  const byJob = useRef(new Map<string, string>())
  const wantFocus = useRef(false)
  const [, setVersion] = useState(0)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [stepStart, setStepStart] = useState(() => performance.now())
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<Speed>('normal')
  const [live, setLive] = useState<FlowEvent[]>([])
  const [counters, setCounters] = useState<LiveCounters>(ZERO)

  useEffect(() => {
    stories.current = new Map()
    byJob.current = new Map()
    setFocusKey(null)
    setLive([])
    setCounters(ZERO)
    const liveChain = new Map<string, number>()
    let id = 0
    backend.onEvent((input: FlowEventInput) => {
      const key = (input.jobId && byJob.current.get(input.jobId)) ?? input.flow ?? input.jobId
      if (!key) return
      if (input.jobId) byJob.current.set(input.jobId, key)
      let story = stories.current.get(key)
      const isNew = !story
      if (!story) {
        story = { key, project: input.project ?? '', steps: [], final: false }
        stories.current.set(key, story)
        if (stories.current.size > MAX_STORIES) stories.current.delete(stories.current.keys().next().value!)
      }
      if (input.jobId) story.jobId = input.jobId
      const now = performance.now()
      const start = Math.max(now, liveChain.get(key) ?? 0)
      const hop = input.from && input.to ? LIVE_HOP_MS : 0
      liveChain.set(key, start + hop)
      const ev: FlowEvent = { ...input, id: ++id, story: key, startsAt: start, endsAt: start + hop, wallTime: Date.now() }
      story.steps = [...story.steps, ev]
      setLive((list) => (list.length >= MAX_LIVE ? [...list.slice(-MAX_LIVE + 1), ev] : [...list, ev]))
      setCounters((c) => count(c, input))
      if (input.final) story.final = true
      if (isNew && input.flow && wantFocus.current) {
        wantFocus.current = false
        setFocusKey(key)
        setCursor(0)
        setStepStart(performance.now())
        setPlaying(true)
      }
      setVersion((v) => v + 1)
    })
    backend.start()
    return () => backend.stop()
  }, [backend])

  const story = focusKey ? stories.current.get(focusKey) ?? null : null
  const total = story?.steps.length ?? 0
  const waiting = !!story && cursor >= total - 1 && !story.final

  const goTo = useCallback((i: number) => {
    setCursor(Math.max(0, i))
    setStepStart(performance.now())
  }, [])

  // Avance automático: después de que el paquete llega y hubo tiempo de leer.
  useEffect(() => {
    if (!playing || !story || cursor >= total - 1) return
    const due = stepStart + TRAVEL_MS[speed] + READ_MS[speed] - performance.now()
    const t = window.setTimeout(() => goTo(cursor + 1), Math.max(due, 0))
    return () => window.clearTimeout(t)
  }, [playing, story, cursor, total, stepStart, speed, goTo])

  return {
    story,
    live,
    counters,
    cursor: Math.min(cursor, Math.max(total - 1, 0)),
    stepStart,
    playing,
    speed,
    waiting,
    travelMs: TRAVEL_MS[speed],
    /** Al reanudar, el paso actual se vuelve a mostrar entero antes de pasar al siguiente. */
    setPlaying: (p: boolean) => {
      if (p) setStepStart(performance.now())
      setPlaying(p)
    },
    setSpeed,
    next: () => cursor < total - 1 && goTo(cursor + 1),
    prev: () => cursor > 0 && goTo(cursor - 1),
    goTo,
    replay: () => {
      goTo(0)
      setPlaying(true)
    },
    /** El próximo pedido que salga de este navegador pasa a ser el que se explica. */
    focusNext: () => {
      wantFocus.current = true
    },
    focusJob: (jobId: string) => {
      const key = byJob.current.get(jobId)
      if (!key) return false
      setFocusKey(key)
      goTo(0)
      setPlaying(true)
      return true
    },
    clear: () => setFocusKey(null),
  }
}
