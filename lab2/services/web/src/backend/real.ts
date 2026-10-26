// Modo real: habla con la API de DeployFlow (por /api) y con Jaeger (por /jaeger).
// La API no avisa cuando cambia un job, así que el front consulta cada ~600 ms y cada
// diferencia que ve (queued → running → etapa → fin) la convierte en un paso animado.
import { say } from '../narrate'
import type { Backend, FlowEventInput, HistoryPoint, JobState, PipelineRequest, Snapshot, Span, Stats, SubmitResult, Trace } from '../types'

const POLL_MS = 600
const FINISHED = new Set(['succeeded', 'failed'])

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return (await r.json()) as T
}

export class RealBackend implements Backend {
  readonly mode = 'real' as const
  private eventCb: (e: FlowEventInput) => void = () => {}
  private snapCb: (s: Snapshot) => void = () => {}
  private jobs = new Map<string, JobState>()
  private slotOf = new Map<string, number>()
  private stats: Stats | null = null
  private history: HistoryPoint[] = []
  private timer: number | undefined
  private seeded = false
  private inflight = 0
  private tick = 0
  private connected = false
  private error: string | null = null

  onEvent(cb: (e: FlowEventInput) => void) {
    this.eventCb = cb
  }
  onSnapshot(cb: (s: Snapshot) => void) {
    this.snapCb = cb
  }

  private generation = 0

  start() {
    const gen = ++this.generation
    const loop = async () => {
      await this.poll()
      if (gen === this.generation) this.timer = window.setTimeout(loop, POLL_MS)
    }
    void loop()
  }

  stop() {
    this.generation++
    window.clearTimeout(this.timer)
    this.timer = undefined
    this.eventCb = () => {}
    this.snapCb = () => {}
  }

  private emit(e: FlowEventInput) {
    this.eventCb(e)
  }

  private workerSlots(): number[] {
    const n = Math.max(this.stats?.workers ?? 1, 1)
    const set = new Set<number>(Array.from({ length: n }, (_, i) => i))
    for (const s of this.slotOf.values()) set.add(s)
    return [...set].sort((a, b) => a - b)
  }

  private takeSlot(jobId: string): number {
    const existing = this.slotOf.get(jobId)
    if (existing !== undefined) return existing
    const used = new Set(this.slotOf.values())
    let s = 0
    while (used.has(s)) s++
    this.slotOf.set(jobId, s)
    return s
  }

  private async poll() {
    this.tick++
    try {
      const list = await getJson<{ items: JobState[] }>('/api/pipelines?limit=100')
      if (this.tick % 2 === 1 || !this.stats) {
        // /stats consulta RabbitMQ y a veces responde 503: no es motivo para dar la API por caída.
        this.stats = await getJson<Stats>('/api/stats').catch(() => this.stats)
      }
      if (this.stats && (this.tick % 2 === 1 || this.history.length === 0)) {
        this.history = [
          ...this.history.slice(-179),
          { t: Date.now(), queue: this.stats.queue_depth, running: this.stats.counts.running, workers: this.stats.workers, succeeded: this.stats.counts.succeeded, failed: this.stats.counts.failed },
        ]
      }
      this.connected = true
      this.error = null
      // Del más viejo al más nuevo, así los pasos salen en orden.
      for (const job of [...list.items].reverse()) this.diff(job)
      this.seeded = true
    } catch (err) {
      this.connected = false
      this.error = err instanceof Error ? err.message : String(err)
    }
    this.publishSnapshot()
  }

  private publishSnapshot() {
    const jobs = [...this.jobs.values()].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)).slice(0, 100)
    this.snapCb({ connected: this.connected, error: this.error, stats: this.stats, workerSlots: this.workerSlots(), jobs, history: this.history })
  }

  /** Compara el estado nuevo de un job con el último visto y emite los pasos que pasaron en el medio. */
  private diff(cur: JobState) {
    let prev = this.jobs.get(cur.job_id)
    if (!prev) {
      // Un job que no conocemos. Si hay un POST nuestro en vuelo puede ser ese: esperamos a su 202.
      if (this.inflight > 0) return
      this.jobs.set(cur.job_id, cur)
      if (FINISHED.has(cur.status)) return // terminó antes de que abriéramos la página
      const req: PipelineRequest = { project: cur.project, branch: cur.branch, config: { stages: cur.stages.map((s) => s.name), stage_seconds: 0, fail_at: null } }
      this.emit(say.publish(cur.job_id, req, cur.trace_id, cur.submitted_at, true))
      prev = { ...cur, status: 'queued', attempts: 0, stages: cur.stages.map((s) => ({ ...s, status: 'pending' })) }
      if (!this.seeded && cur.status === 'running') {
        // Al abrir la página no sabemos qué etapas ya pasaron: mostramos solo dónde está.
        prev = { ...cur, status: 'queued', attempts: cur.attempts - 1 }
      }
    }
    this.emitTransitions(prev, cur)
    this.jobs.set(cur.job_id, cur)
  }

  private emitTransitions(prev: JobState, cur: JobState) {
    if (prev.status === cur.status && prev.attempts === cur.attempts && JSON.stringify(prev.stages) === JSON.stringify(cur.stages)) return
    // Una re-entrega: el intento cambió mientras ya estaba corriendo.
    if (prev.status === 'running' && cur.attempts > prev.attempts) {
      const slot = this.takeSlot(cur.job_id)
      this.emit(say.redeliver(cur, slot))
      this.slotOf.delete(cur.job_id)
      prev = { ...prev, status: 'queued', stages: prev.stages.map((s) => ({ ...s, status: 'pending' })) }
    }

    if (prev.status === 'queued' && cur.status !== 'queued') {
      const slot = this.takeSlot(cur.job_id)
      this.emit(say.deliver(cur, slot, Math.max(cur.attempts, 1), cur.attempts > 1))
    }
    if (cur.status === 'queued') return
    const slot = this.takeSlot(cur.job_id)

    cur.stages.forEach((stage, i) => {
      const before = prev.stages[i]?.status ?? 'pending'
      if (before === stage.status) return
      if (stage.status === 'succeeded' || stage.status === 'failed') {
        this.emit(say.stageEnd(cur, slot, stage.name, stage.status === 'succeeded', stage.duration_s))
      }
    })

    if (FINISHED.has(cur.status) && !FINISHED.has(prev.status)) {
      this.emit(say.ack(cur, slot, cur.status === 'succeeded'))
      this.emit(say.traceDone(cur, slot))
      this.slotOf.delete(cur.job_id)
    }
  }

  private flowSeq = 0

  async submit(req: PipelineRequest): Promise<SubmitResult> {
    this.inflight++
    const flow = `flow-${++this.flowSeq}`
    const outer = this.eventCb
    const emit = (e: FlowEventInput) => outer({ ...e, flow })
    const t0 = performance.now()
    try {
      const r = await fetch('/api/pipelines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
      const ms = performance.now() - t0
      const body = await r.json().catch(() => ({}))
      if (r.status === 202) {
        const jobId: string = body.job_id
        const traceId: string | null = body.trace_id ?? null
        const now = new Date().toISOString()
        // Los pasos del POST pasan en ~200 ms dentro de la API: se cuentan juntos al volver la respuesta.
        emit(say.httpRequest(req))
        emit(say.validateCall(req))
        emit(say.validateResult(true, [], req.project))
        emit(say.redisCreate(jobId, req, traceId, now))
        emit(say.publish(jobId, req, traceId, now))
        emit(say.accepted(jobId, traceId, ms, req.project))
        // Lo registramos como "queued": el próximo poll emite lo que haya pasado desde entonces.
        this.jobs.set(jobId, {
          job_id: jobId,
          project: req.project,
          branch: req.branch,
          status: 'queued',
          current_stage: null,
          stages: req.config.stages.map((name) => ({ name, status: 'pending', started_at: null, duration_s: null, error: null })),
          attempts: 0,
          trace_id: traceId,
          submitted_at: now,
          finished_at: null,
          error: null,
        })
        this.publishSnapshot()
        return { ok: true, status: 202, jobId, traceId, ms }
      }
      if (r.status === 422) {
        const errors: string[] = body?.detail?.errors ?? ['pedido inválido']
        emit(say.httpRequest(req))
        emit(say.validateCall(req))
        emit(say.validateResult(false, errors, req.project))
        emit(say.rejected(errors, ms, req.project))
        return { ok: false, status: 422, errors, ms }
      }
      const detail = typeof body?.detail === 'string' ? body.detail : `error ${r.status}`
      emit(say.httpRequest(req))
      emit(say.unavailable(r.status, detail, ms, req.project))
      return { ok: false, status: r.status, errors: [detail], ms }
    } catch (err) {
      const ms = performance.now() - t0
      const detail = 'no se pudo conectar con la API'
      emit(say.httpRequest(req))
      emit(say.unavailable(0, detail, ms, req.project))
      return { ok: false, status: 0, errors: [String(err)], ms }
    } finally {
      this.inflight--
    }
  }

  async getTrace(job: JobState): Promise<Trace | null> {
    if (!job.trace_id) return null
    try {
      const data = await getJson<{ data: JaegerTrace[] }>(`/jaeger/api/traces/${job.trace_id}`)
      const t = data.data?.[0]
      if (!t) return null
      const spans: Span[] = t.spans.map((s) => {
        const tags: Record<string, string | number | boolean> = {}
        for (const tag of s.tags) tags[tag.key] = tag.value
        const parent = s.references.find((r) => r.refType === 'CHILD_OF') ?? s.references[0]
        return {
          spanId: s.spanID,
          parentId: parent?.spanID ?? null,
          service: t.processes[s.processID]?.serviceName ?? '?',
          name: s.operationName,
          kind: String(tags['span.kind'] ?? ''),
          start: s.startTime,
          duration: s.duration,
          error: tags['error'] === true || tags['otel.status_code'] === 'ERROR',
          tags,
        }
      })
      const names = new Set(spans.map((s) => s.name))
      const stagesDone = job.stages.filter((s) => s.status !== 'pending').length
      const stageSpans = spans.filter((s) => s.name.startsWith('stage ')).length
      const complete = FINISHED.has(job.status) && names.has('process pipeline.jobs') && names.has('POST /validate') && stageSpans >= stagesDone
      return { traceId: job.trace_id, spans, complete, source: 'jaeger' }
    } catch {
      return null
    }
  }
}

interface JaegerTrace {
  traceID: string
  spans: {
    spanID: string
    operationName: string
    processID: string
    startTime: number
    duration: number
    references: { refType: string; spanID: string }[]
    tags: { key: string; value: string | number | boolean }[]
  }[]
  processes: Record<string, { serviceName: string }>
}
