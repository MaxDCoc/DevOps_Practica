// Tipos del contrato (ver lab2/AGENTS.md y common/deployflow_common/contract.py).

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type StageStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface StageState {
  name: string
  status: StageStatus
  started_at: string | null
  duration_s: number | null
  error: string | null
}

export interface JobState {
  job_id: string
  project: string
  branch: string
  status: JobStatus
  current_stage: string | null
  stages: StageState[]
  attempts: number
  trace_id: string | null
  submitted_at: string
  finished_at: string | null
  error: string | null
}

export interface PipelineRequest {
  project: string
  branch: string
  config: { stages: string[]; stage_seconds: number; fail_at: string | null }
}

export interface Stats {
  counts: { queued: number; running: number; succeeded: number; failed: number }
  queue_depth: number
  workers: number
}

export type SubmitResult =
  | { ok: true; status: 202; jobId: string; traceId: string | null; ms: number }
  | { ok: false; status: number; errors: string[]; ms: number }

// ---- Lo que agrega el front: eventos para animar y explicar ----

export type NodeId =
  | 'browser'
  | 'api'
  | 'validator'
  | 'redis'
  | 'rabbit'
  | 'jaeger'
  | 'prometheus'
  | `worker-${number}`

export type EventKind =
  | 'http-req'
  | 'http-res'
  | 'redis'
  | 'publish'
  | 'deliver'
  | 'stage-start'
  | 'stage-end'
  | 'ack'
  | 'redeliver'
  | 'span'
  | 'info'

export type Topic = 'mensajeria' | 'observabilidad' | 'http' | 'estado'
export type Phase = 'pedido' | 'cola' | 'worker' | 'traza'
export type Tone = 'ok' | 'error' | 'warn' | 'neutral'

export interface Payload {
  label: string
  data: unknown
}

export interface FlowEventInput {
  kind: EventKind
  title: string
  explain: string
  why?: string // por qué importa (opcional)
  phase?: Phase
  final?: boolean // último paso de la historia de un pedido
  topic: Topic
  short?: string // etiqueta corta que viaja en el paquete animado
  tone?: Tone
  from?: NodeId
  to?: NodeId
  flow?: string // agrupa los pasos de un mismo pedido antes de conocer su job_id
  jobId?: string
  traceId?: string | null
  project?: string
  payloads?: Payload[]
  meta?: {
    stage?: string
    stageSeconds?: number
    slot?: number
    attempt?: number
    redelivered?: boolean
    ok?: boolean
    ms?: number
  }
}

export interface FlowEvent extends FlowEventInput {
  id: number
  story?: string // historia (pedido) a la que pertenece: define su color
  startsAt: number // cuándo arranca la animación (performance.now)
  endsAt: number
  wallTime: number // Date.now() al mostrarse
}

export interface Span {
  spanId: string
  parentId: string | null
  service: string
  name: string
  kind: string
  start: number // microsegundos
  duration: number // microsegundos
  error: boolean
  tags: Record<string, string | number | boolean>
}

export interface Trace {
  traceId: string
  spans: Span[]
  complete: boolean
  source: 'jaeger' | 'sim'
}

export interface HistoryPoint {
  t: number
  queue: number
  running: number
  workers: number
  succeeded: number
  failed: number
}

export interface Snapshot {
  connected: boolean
  error: string | null
  stats: Stats | null
  workerSlots: number[]
  jobs: JobState[]
  history: HistoryPoint[]
}

export interface Backend {
  readonly mode: 'real' | 'sim'
  start(): void
  stop(): void
  submit(req: PipelineRequest): Promise<SubmitResult>
  getTrace(job: JobState): Promise<Trace | null>
  onEvent(cb: (e: FlowEventInput) => void): void
  onSnapshot(cb: (s: Snapshot) => void): void
}
