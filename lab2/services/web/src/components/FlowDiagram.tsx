import { useEffect, useState } from 'react'
import type { LiveCounters, Story } from '../player'
import type { FlowEvent, NodeId, Snapshot } from '../types'
import { fmtMs } from '../util'

// ---------- geometría ----------
interface Box {
  x: number
  y: number
  w: number
  h: number
}

const FIXED: Record<string, Box> = {
  browser: { x: 115, y: 285, w: 160, h: 86 },
  api: { x: 335, y: 285, w: 160, h: 86 },
  validator: { x: 335, y: 125, w: 160, h: 76 },
  rabbit: { x: 625, y: 205, w: 210, h: 110 },
  redis: { x: 430, y: 482, w: 210, h: 70 },
  jaeger: { x: 720, y: 482, w: 200, h: 70 },
}

function workerBoxes(slots: number[]): Map<number, Box> {
  const n = Math.max(slots.length, 1)
  const top = 110
  const bottom = 360
  const gap = n === 1 ? 0 : (bottom - top) / (n - 1)
  const h = n === 1 ? 96 : Math.max(Math.min(96, gap - 10), 30)
  const m = new Map<number, Box>()
  slots.forEach((s, i) => m.set(s, { x: 875, y: n === 1 ? 235 : top + gap * i, w: 190, h }))
  return m
}

function boxOf(id: NodeId, workers: Map<number, Box>): Box | undefined {
  if (id.startsWith('worker-')) return workers.get(Number(id.slice(7)))
  return FIXED[id]
}

/** Punto donde la recta hacia `toward` sale del borde de la caja. */
function border(b: Box, toward: { x: number; y: number }) {
  const dx = toward.x - b.x
  const dy = toward.y - b.y
  if (dx === 0 && dy === 0) return { x: b.x, y: b.y }
  const s = Math.min(dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity)
  return { x: b.x + dx * s, y: b.y + dy * s }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

// ---------- estado de la escena en un paso de la historia ----------
type StageMark = 'pending' | 'running' | 'succeeded' | 'failed'

interface Scene {
  client: 'idle' | 'waiting' | 'ok' | 'rejected' | 'error'
  apiMs: number | null
  apiBusy: boolean
  inQueue: boolean
  redelivered: boolean
  worker: { slot: number; attempt: number; stages: { name: string; status: StageMark }[] } | null
  crashed: number[]
  redis: string | null
  traced: boolean
  done: 'ok' | 'failed' | null
}

function stageNames(story: Story): string[] {
  const first = story.steps[0]?.payloads?.[0]?.data as { config?: { stages?: string[] } } | undefined
  return first?.config?.stages ?? ['build', 'test', 'deploy']
}

/** Cómo está todo después de aplicar los pasos 0..upto (inclusive). */
export function sceneAt(story: Story, upto: number): Scene {
  const names = stageNames(story)
  const sc: Scene = { client: 'idle', apiMs: null, apiBusy: false, inQueue: false, redelivered: false, worker: null, crashed: [], redis: null, traced: false, done: null }
  story.steps.slice(0, upto + 1).forEach((e) => {
    switch (e.kind) {
      case 'http-req':
        if (e.from === 'browser') {
          sc.client = 'waiting'
          sc.apiBusy = true
        }
        break
      case 'http-res':
        if (e.to === 'browser') {
          sc.client = e.tone === 'ok' ? 'ok' : e.short === '422' ? 'rejected' : 'error'
          sc.apiMs = e.meta?.ms ?? null
          sc.apiBusy = false
        }
        break
      case 'redis':
        sc.redis = 'en cola'
        break
      case 'publish':
        sc.inQueue = true
        break
      case 'deliver':
        sc.inQueue = false
        sc.worker = { slot: e.meta?.slot ?? 0, attempt: e.meta?.attempt ?? 1, stages: names.map((name, i) => ({ name, status: i === 0 ? 'running' : 'pending' })) }
        sc.redis = 'corriendo'
        break
      case 'stage-end':
        if (sc.worker) {
          const stages = sc.worker.stages
          const i = stages.findIndex((s) => s.name === e.meta?.stage)
          if (i >= 0) {
            stages[i] = { ...stages[i], status: e.meta?.ok ? 'succeeded' : 'failed' }
            if (e.meta?.ok && stages[i + 1]) stages[i + 1] = { ...stages[i + 1], status: 'running' }
          }
          sc.redis = e.meta?.ok ? `${e.meta?.stage}: ok` : 'falló'
          if (!e.meta?.ok) sc.done = 'failed'
        }
        break
      case 'redeliver':
        if (sc.worker) sc.crashed = [...sc.crashed, sc.worker.slot]
        sc.worker = null
        sc.inQueue = true
        sc.redelivered = true
        break
      case 'ack':
        if (sc.done !== 'failed') sc.done = 'ok'
        sc.redis = sc.done === 'ok' ? 'terminado: ok' : 'terminado: falló'
        break
      case 'span':
        sc.traced = true
        break
    }
  })
  return sc
}

// ---------- componente ----------
interface ExplainProps {
  mode: 'explain'
  story: Story | null
  cursor: number
  stepStart: number
  travelMs: number
}
interface LiveProps {
  mode: 'live'
  live: FlowEvent[]
  counters: LiveCounters
}
type Props = (ExplainProps | LiveProps) & {
  snapshot: Snapshot
  selectedNode: NodeId | null
  onNodeClick: (id: NodeId) => void
  onJobClick: (jobId: string) => void
}

export function FlowDiagram(props: Props) {
  const { snapshot, selectedNode, onNodeClick, onJobClick } = props
  const explain = props.mode === 'explain' ? props : null
  const liveMode = props.mode === 'live' ? props : null
  const story = explain?.story ?? null
  const step: FlowEvent | null = story && explain ? story.steps[explain.cursor] ?? null : null

  // animación del paquete del paso actual
  const [now, setNow] = useState(() => performance.now())
  const travelEnd = explain ? explain.stepStart + explain.travelMs : 0
  useEffect(() => {
    if (!explain || !step) return
    let raf = 0
    const loop = () => {
      const t = performance.now()
      setNow(t)
      if (t < travelEnd + 50) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explain?.stepStart, step?.id, travelEnd])

  // en vivo: el reloj corre siempre (hay paquetes entrando todo el tiempo)
  useEffect(() => {
    if (!liveMode) return
    let raf = 0
    const loop = () => {
      setNow(performance.now())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!liveMode])
  const inFlight = liveMode ? liveMode.live.filter((e) => e.from && e.to && e.startsAt <= now && now <= e.endsAt) : []
  const recentlyHit = new Set<string>(liveMode ? liveMode.live.filter((e) => e.to && now >= e.endsAt && now - e.endsAt < 450).map((e) => e.to!) : [])
  const busyEdges = new Set(inFlight.map((e) => [e.from, e.to].sort().join('|')))
  const c = liveMode?.counters

  const progress = explain && step ? Math.min(Math.max((now - explain.stepStart) / explain.travelMs, 0), 1) : 1
  const arrived = progress >= 1

  // estado de la escena: un paso "cuenta" cuando su paquete llegó
  const scene = story && explain ? sceneAt(story, arrived ? explain.cursor : explain.cursor - 1) : null

  // En vivo, cada worker muestra el último mensaje que le llegó y todavía no confirmó.
  const liveSlots = new Map<string, number>()
  if (liveMode) {
    const bySlot = new Map<number, string>()
    for (const e of liveMode.live) {
      if (e.endsAt > now) continue
      const slot = e.meta?.slot
      if (slot === undefined || !e.jobId) continue
      if (e.kind === 'deliver') bySlot.set(slot, e.jobId)
      if ((e.kind === 'ack' || e.kind === 'redeliver') && bySlot.get(slot) === e.jobId) bySlot.delete(slot)
    }
    for (const [slot, jobId] of bySlot) liveSlots.set(jobId, slot)
  }

  // workers que se dibujan
  const nWorkers = Math.max(snapshot.stats?.workers ?? 1, 1)
  let slots: number[]
  if (explain) {
    const used = story?.steps.map((s) => s.meta?.slot ?? -1) ?? []
    slots = Array.from({ length: Math.max(nWorkers, Math.max(-1, ...used) + 1) }, (_, i) => i)
  } else {
    slots = Array.from({ length: Math.max(nWorkers, Math.max(-1, ...liveSlots.values()) + 1) }, (_, i) => i)
  }
  const wb = workerBoxes(slots)

  const activeFrom = step?.from
  const activeTo = step?.to
  const isActive = (id: NodeId) => !explain || !step || id === activeFrom || id === activeTo
  const dimmed = (id: NodeId) => !!explain && !!step && !isActive(id)

  // ----- piezas -----
  const nodeShell = (id: NodeId, title: string, sub: string, body?: React.ReactNode, extraClass = '') => {
    const b = boxOf(id, wb)
    if (!b) return null
    const active = (!!explain && !!step && (id === activeFrom || id === activeTo)) || recentlyHit.has(id)
    return (
      <g
        key={id}
        className={`node ${active ? 'active' : ''} ${dimmed(id) ? 'dim' : ''} ${selectedNode === id ? 'selected' : ''} ${extraClass}`}
        onClick={() => onNodeClick(id)}
        role="button"
        tabIndex={0}
        aria-label={title}
      >
        <rect x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx={10} className="node-box" />
        <text x={b.x - b.w / 2 + 14} y={b.y - b.h / 2 + 24} className="node-title">
          {title}
        </text>
        {sub && b.h >= 50 && (
          <text x={b.x - b.w / 2 + 14} y={b.y - b.h / 2 + 41} className="node-sub">
            {sub}
          </text>
        )}
        {body}
      </g>
    )
  }

  const statusLine = (id: NodeId, text: string, cls = '') => {
    const b = boxOf(id, wb)!
    return (
      <text x={b.x - b.w / 2 + 14} y={b.y + b.h / 2 - 13} className={`node-status ${cls}`}>
        {text}
      </text>
    )
  }

  // navegador
  let browserBody: React.ReactNode = null
  if (scene) {
    if (scene.client === 'waiting') browserBody = statusLine('browser', 'esperando respuesta…', 'wait')
    if (scene.client === 'ok') browserBody = statusLine('browser', `recibió 202 en ${fmtMs(scene.apiMs ?? 0)}`, 'ok')
    if (scene.client === 'rejected') browserBody = statusLine('browser', 'recibió 422', 'err')
    if (scene.client === 'error') browserBody = statusLine('browser', 'recibió un error', 'err')
  }
  if (c) browserBody = statusLine('browser', `respuestas recibidas: ${c.responses}`, 'muted')

  // api
  let apiBody: React.ReactNode = null
  if (scene) apiBody = statusLine('api', scene.apiBusy ? 'atendiendo el pedido' : scene.client === 'idle' ? '' : 'libre otra vez', scene.apiBusy ? 'wait' : 'muted')
  if (c) apiBody = statusLine('api', `pedidos atendidos: ${c.requests}`, 'muted')
  const validatorBody = c ? statusLine('validator', `válidos ${c.valid} · rechazados ${c.rejected}`, 'muted') : null

  // rabbit + cola
  const R = FIXED.rabbit
  const qx0 = R.x - R.w / 2 + 16
  const qx1 = R.x + R.w / 2 - 16
  const qy = R.y + 14
  const MAX_ENV = 8
  const envW = (qx1 - qx0 - 10) / MAX_ENV
  const queueCount = scene ? (scene.inQueue ? 1 : 0) : snapshot.stats?.queue_depth ?? 0
  const rabbitBody = (
    <g>
      <rect x={qx0} y={qy - 15} width={qx1 - qx0} height={30} rx={6} className="queue" />
      {Array.from({ length: Math.min(queueCount, MAX_ENV) }, (_, i) => {
        const x = qx1 - 5 - (i + 1) * envW
        return (
          <g key={i} transform={`translate(${x + 2},${qy - 9})`}>
            <rect width={envW - 4} height={18} rx={2} className="envelope" />
            <polyline points={`1,1 ${(envW - 4) / 2},10 ${envW - 5},1`} className="envelope-flap" />
          </g>
        )
      })}
      {c && (
        <text x={R.x + R.w / 2 - 12} y={R.y - R.h / 2 + 24} className="node-sub" textAnchor="end">
          entraron {c.published} · ack {c.acked}
        </text>
      )}
      <text x={qx0} y={qy + 34} className="node-status muted">
        cola pipeline.jobs: {queueCount === 0 ? 'vacía' : queueCount === 1 ? '1 mensaje' : `${queueCount} mensajes`}
        {scene?.redelivered && scene.inQueue ? ' (devuelto)' : ''}
      </text>
    </g>
  )

  // workers
  const workerBody = (slot: number) => {
    const b = wb.get(slot)!
    const left = b.x - b.w / 2 + 14
    let project: string | null = null
    let stages: { name: string; status: StageMark }[] | null = null
    let jobId: string | null = null
    let crashed = false
    if (scene) {
      if (scene.worker?.slot === slot) {
        project = story!.project
        stages = scene.worker.stages
        jobId = story!.jobId ?? null
      }
      crashed = scene.crashed.includes(slot) && scene.worker?.slot !== slot
    } else {
      const job = [...liveSlots.entries()].find(([, s]) => s === slot)?.[0]
      const j = job ? snapshot.jobs.find((x) => x.job_id === job) : undefined
      if (j) {
        project = j.project
        stages = j.stages.map((s) => ({ name: s.name, status: s.status }))
        jobId = j.job_id
      }
    }
    if (crashed) return statusLine(`worker-${slot}`, 'se cayó', 'err')
    if (!stages) return b.h >= 50 ? statusLine(`worker-${slot}`, 'libre, esperando mensajes', 'muted') : null
    const small = b.h < 70
    const pillW = (b.w - 28 - 8) / stages.length
    return (
      <g onClick={(ev) => (ev.stopPropagation(), jobId && onJobClick(jobId))}>
        {!small && (
          <text x={b.x + b.w / 2 - 12} y={b.y - b.h / 2 + 24} className="node-sub" textAnchor="end">
            {project}
          </text>
        )}
        {stages.map((s, i) => (
          <g key={s.name} transform={`translate(${left + i * (pillW + 4)},${b.y + b.h / 2 - (small ? 22 : 28)})`}>
            <rect width={pillW} height={18} rx={4} className={`stage s-${s.status}`} />
            <text x={pillW / 2} y={13} textAnchor="middle" className={`stage-label s-${s.status}`}>
              {s.name}
            </text>
          </g>
        ))}
      </g>
    )
  }

  // redis
  let redisBody: React.ReactNode
  if (scene) redisBody = scene.redis ? statusLine('redis', `estado: ${scene.redis}`) : null
  else {
    const cc = snapshot.stats?.counts
    redisBody = cc ? statusLine('redis', `${cc.succeeded} ok · ${cc.failed} fallidos · ${cc.running} corriendo`, 'muted') : null
  }
  let jaegerBody = scene?.traced ? statusLine('jaeger', 'traza completa', 'ok') : null
  if (c) jaegerBody = statusLine('jaeger', `trazas completas: ${c.traces}`, 'muted')

  // aristas de fondo
  const baseEdges: [NodeId, NodeId][] = [
    ['browser', 'api'],
    ['api', 'validator'],
    ['api', 'rabbit'],
    ['api', 'redis'],
    ...slots.map((s) => ['rabbit', `worker-${s}`] as [NodeId, NodeId]),
  ]
  const line = (a: NodeId, b: NodeId, cls: string, key: string) => {
    const A = boxOf(a, wb)
    const B = boxOf(b, wb)
    if (!A || !B) return null
    const p = border(A, B)
    const q = border(B, A)
    return <line key={key} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={cls} markerEnd={cls.includes('active') ? 'url(#arrow)' : undefined} />
  }

  // paquete del paso actual
  let packet: React.ReactNode = null
  if (step?.from && step.to) {
    const A = boxOf(step.from, wb)
    const B = boxOf(step.to, wb)
    if (A && B) {
      const p = border(A, B)
      const q = border(B, A)
      const t = ease(progress) * 0.86 + 0.07
      const x = p.x + (q.x - p.x) * t
      const y = p.y + (q.y - p.y) * t
      const label = step.short ?? ''
      const w = Math.max(44, label.length * 7.6 + 24)
      packet = (
        <g transform={`translate(${x},${y})`} className={`packet k-${step.kind} t-${step.tone ?? 'neutral'}`}>
          <rect x={-w / 2} y={-14} width={w} height={28} rx={14} />
          <text y={5} textAnchor="middle">
            {label}
          </text>
        </g>
      )
    }
  }

  return (
    <svg viewBox="0 0 1000 540" className="diagram" role="img" aria-label="Servicios de DeployFlow y el mensaje que viaja entre ellos">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head" />
        </marker>
      </defs>

      <rect x={16} y={36} width={430} height={384} rx={14} className="zone" />
      <text x={32} y={60} className="zone-title">
        Mientras el cliente espera
      </text>
      <text x={32} y={77} className="zone-sub">
        pedido HTTP · tarda milisegundos
      </text>
      <rect x={470} y={36} width={514} height={384} rx={14} className="zone" />
      <text x={486} y={60} className="zone-title">
        Después, en segundo plano
      </text>
      <text x={486} y={77} className="zone-sub">
        cola y workers · tarda segundos
      </text>

      {baseEdges.map(([a, b]) => line(a, b, busyEdges.has([a, b].sort().join('|')) ? 'edge busy' : 'edge', `${a}-${b}`))}
      {step?.from && step.to && line(step.from, step.to, 'edge active', 'active')}

      {nodeShell('browser', 'Navegador', 'el cliente', browserBody)}
      {nodeShell('api', 'API', 'recibe los pedidos', apiBody)}
      {nodeShell('validator', 'Validador', 'revisa las reglas', validatorBody)}
      {nodeShell('rabbit', 'RabbitMQ', '', rabbitBody)}
      {nodeShell('redis', 'Redis', 'estado de cada pipeline', redisBody)}
      {nodeShell('jaeger', 'Jaeger', 'arma las trazas', jaegerBody)}
      {slots.map((s) => nodeShell(`worker-${s}`, `Worker ${s + 1}`, 'ejecuta las etapas', workerBody(s)))}

      {packet}
      {inFlight.map((e) => {
        const A = boxOf(e.from!, wb)
        const B = boxOf(e.to!, wb)
        if (!A || !B) return null
        const p = border(A, B)
        const q = border(B, A)
        const t = ease(Math.min(Math.max((now - e.startsAt) / (e.endsAt - e.startsAt), 0), 1))
        const label = e.short ?? ''
        const w = Math.max(36, label.length * 6.6 + 18)
        return (
          <g key={e.id} transform={`translate(${p.x + (q.x - p.x) * t},${p.y + (q.y - p.y) * t})`} className={`packet small k-${e.kind} t-${e.tone ?? 'neutral'}`}>
            <rect x={-w / 2} y={-11} width={w} height={22} rx={11} />
            <text y={4} textAnchor="middle">
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
