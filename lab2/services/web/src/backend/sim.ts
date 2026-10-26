// Modo simulado: el mismo flujo que el stack real, pero dentro del navegador.
// Sirve de plan B si no hay Docker, y permite escalar workers y matar uno a mitad de un job.
// Corre en tiempo real; el ritmo de la explicación lo pone el reproductor (player.ts), no esto.
import { say } from '../narrate'
import type { Backend, FlowEventInput, HistoryPoint, JobState, PipelineRequest, Snapshot, Span, SubmitResult, Trace } from '../types'

const STAGES = ['build', 'test', 'deploy']

/** Las mismas reglas que services/validator/app/rules.py. */
export function validate(req: PipelineRequest): string[] {
  const errors: string[] = []
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(req.project)) errors.push('project: solo minúsculas, números y guiones (2 a 41 caracteres)')
  const st = req.config.stages
  if (st.length === 0) errors.push('config.stages: no puede estar vacío')
  else {
    const unknown = st.filter((s) => !STAGES.includes(s))
    if (unknown.length) errors.push(`config.stages: etapas desconocidas ${JSON.stringify(unknown)} (válidas: build, test, deploy)`)
    else if (new Set(st).size !== st.length || st.some((s, i) => i > 0 && STAGES.indexOf(s) < STAGES.indexOf(st[i - 1])))
      errors.push('config.stages: deben ir en el orden build, test, deploy y sin repetir')
  }
  const secs = req.config.stage_seconds
  if (!Number.isInteger(secs) || secs < 1 || secs > 30) errors.push('config.stage_seconds: debe estar entre 1 y 30')
  if (req.config.fail_at != null && !st.includes(req.config.fail_at)) errors.push('config.fail_at: debe ser una de las etapas del pipeline o null')
  return errors
}

const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
const uuid = () => crypto.randomUUID?.() ?? `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
const jitter = (ms: number) => ms * (0.85 + Math.random() * 0.3)

interface SimWorker {
  slot: number
  jobId: string | null
  token: number // cambia cuando el worker suelta un job o muere: invalida lo que tenía programado
  stopping: boolean
}

export class SimBackend implements Backend {
  readonly mode = 'sim' as const
  private eventCb: (e: FlowEventInput) => void = () => {}
  private snapCb: (s: Snapshot) => void = () => {}
  private timers = new Set<number>()
  private sampler: number | undefined
  private jobs = new Map<string, JobState>()
  private requests = new Map<string, PipelineRequest>()
  private spans = new Map<string, Span[]>()
  private publishSpan = new Map<string, string>()
  private queue: { jobId: string; redelivered: boolean }[] = []
  private workers: SimWorker[] = [{ slot: 0, jobId: null, token: 0, stopping: false }]
  private history: HistoryPoint[] = []
  private flowSeq = 0

  onEvent(cb: (e: FlowEventInput) => void) {
    this.eventCb = cb
  }
  onSnapshot(cb: (s: Snapshot) => void) {
    this.snapCb = cb
  }

  start() {
    this.sampler = window.setInterval(() => {
      const all = [...this.jobs.values()]
      const n = (st: string) => all.filter((j) => j.status === st).length
      this.history = [...this.history.slice(-179), { t: Date.now(), queue: this.queue.length, running: n('running'), workers: this.workers.length, succeeded: n('succeeded'), failed: n('failed') }]
      this.publishSnapshot()
    }, 500)
    this.publishSnapshot()
  }
  stop() {
    window.clearInterval(this.sampler)
    this.timers.forEach((t) => window.clearTimeout(t))
    this.timers.clear()
    this.eventCb = () => {}
    this.snapCb = () => {}
  }

  private later(ms: number, fn: () => void) {
    const t = window.setTimeout(() => {
      this.timers.delete(t)
      fn()
      this.publishSnapshot()
    }, ms)
    this.timers.add(t)
  }

  // ---------- controles ----------
  get workerCount() {
    return this.workers.filter((w) => !w.stopping).length
  }

  slotOfJob(jobId: string): number | null {
    return this.workers.find((w) => w.jobId === jobId)?.slot ?? null
  }

  setWorkers(n: number) {
    const alive = this.workers.filter((w) => !w.stopping)
    if (n > alive.length) {
      for (let i = alive.length; i < n; i++) {
        const used = new Set(this.workers.map((w) => w.slot))
        let slot = 0
        while (used.has(slot)) slot++
        this.workers.push({ slot, jobId: null, token: 0, stopping: false })
      }
    } else if (n < alive.length && n >= 1) {
      // Se apagan primero los libres; uno ocupado termina su job antes de irse (como con docker stop).
      const victims = [...alive].sort((a, b) => Number(a.jobId !== null) - Number(b.jobId !== null) || b.slot - a.slot).slice(0, alive.length - n)
      for (const w of victims) {
        if (w.jobId) w.stopping = true
        else this.workers = this.workers.filter((x) => x !== w)
      }
    }
    this.dispatch()
    this.publishSnapshot()
  }

  /** Como docker kill: el worker muere sin confirmar y RabbitMQ devuelve el mensaje a la cola. */
  killWorker(slot: number) {
    const w = this.workers.find((x) => x.slot === slot)
    if (!w) return
    w.token++
    this.workers = this.workers.filter((x) => x !== w)
    if (w.jobId) {
      this.eventCb(say.redeliver(this.jobs.get(w.jobId)!, slot))
      this.queue.unshift({ jobId: w.jobId, redelivered: true })
    }
    // restart: unless-stopped: si no queda ninguno, Docker lo vuelve a levantar
    if (this.workers.length === 0) this.workers.push({ slot, jobId: null, token: 0, stopping: false })
    this.later(400, () => this.dispatch())
    this.publishSnapshot()
  }

  private publishSnapshot() {
    const jobs = [...this.jobs.values()].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
    const counts = { queued: 0, running: 0, succeeded: 0, failed: 0 }
    for (const j of jobs) counts[j.status]++
    this.snapCb({
      connected: true,
      error: null,
      stats: { counts, queue_depth: this.queue.length, workers: this.workers.length },
      workerSlots: this.workers.map((w) => w.slot).sort((a, b) => a - b),
      jobs: jobs.map((j) => ({ ...j, stages: j.stages.map((s) => ({ ...s })) })),
      history: this.history,
    })
  }

  private span(jobId: string, s: Omit<Span, 'start' | 'duration' | 'spanId'> & { spanId?: string }, startMs: number, endMs: number) {
    const full: Span = { spanId: s.spanId ?? hex(16), ...s, start: startMs * 1000, duration: Math.max(endMs - startMs, 0.05) * 1000 }
    this.spans.set(jobId, [...(this.spans.get(jobId) ?? []), full])
    return full.spanId
  }

  // ---------- POST /pipelines ----------
  submit(req: PipelineRequest): Promise<SubmitResult> {
    const flow = `sim-${++this.flowSeq}`
    const emit = (e: FlowEventInput) => this.eventCb({ ...e, flow })
    const t0 = Date.now()
    emit(say.httpRequest(req))
    emit(say.validateCall(req))
    const tValid = jitter(155)
    return new Promise((resolve) => {
      this.later(tValid, () => {
        const errors = validate(req)
        emit(say.validateResult(errors.length === 0, errors, req.project))
        if (errors.length) {
          const ms = Date.now() - t0 + 3
          emit(say.rejected(errors, ms, req.project))
          resolve({ ok: false, status: 422, errors, ms })
          return
        }
        const jobId = uuid()
        const traceId = hex(32)
        const rootId = hex(16)
        const clientId = hex(16)
        const submittedAt = new Date().toISOString()
        this.requests.set(jobId, req)
        this.span(jobId, { spanId: clientId, parentId: rootId, service: 'api', name: 'POST', kind: 'client', error: false, tags: { 'http.method': 'POST', 'server.address': 'validator' } }, t0 + 4, t0 + tValid)
        this.span(jobId, { parentId: clientId, service: 'validator', name: 'POST /validate', kind: 'server', error: false, tags: { 'http.route': '/validate', 'http.status_code': 200 } }, t0 + 6, t0 + tValid - 2)
        this.jobs.set(jobId, {
          job_id: jobId,
          project: req.project,
          branch: req.branch,
          status: 'queued',
          current_stage: null,
          stages: req.config.stages.map((name) => ({ name, status: 'pending', started_at: null, duration_s: null, error: null })),
          attempts: 0,
          trace_id: traceId,
          submitted_at: submittedAt,
          finished_at: null,
          error: null,
        })
        emit(say.redisCreate(jobId, req, traceId, submittedAt))
        const tPub = Date.now()
        emit(say.publish(jobId, req, traceId, submittedAt))
        this.later(jitter(35), () => {
          const now = Date.now()
          const pubId = this.span(
            jobId,
            { parentId: rootId, service: 'api', name: 'publish pipeline.jobs', kind: 'producer', error: false, tags: { 'messaging.system': 'rabbitmq', 'messaging.destination.name': 'pipelines' } },
            tPub,
            now,
          )
          this.publishSpan.set(jobId, pubId)
          const ms = now - t0 + 2
          this.span(jobId, { spanId: rootId, parentId: null, service: 'api', name: 'POST /pipelines', kind: 'server', error: false, tags: { 'http.route': '/pipelines', 'http.status_code': 202 } }, t0, t0 + ms)
          emit(say.accepted(jobId, traceId, ms, req.project))
          resolve({ ok: true, status: 202, jobId, traceId, ms })
          this.queue.push({ jobId, redelivered: false })
          this.dispatch()
        })
      })
    })
  }

  // ---------- la cola y los workers ----------
  private dispatch() {
    for (const w of this.workers) {
      if (w.jobId || w.stopping || this.queue.length === 0) continue
      const msg = this.queue.shift()!
      w.jobId = msg.jobId
      const token = ++w.token
      this.later(jitter(15), () => {
        if (w.token !== token) return
        const job = this.jobs.get(msg.jobId)!
        job.attempts++
        job.status = 'running'
        job.stages = job.stages.map((s) => ({ ...s, status: 'pending', started_at: null, duration_s: null, error: null }))
        this.eventCb(say.deliver(job, w.slot, job.attempts, msg.redelivered))
        this.runStage(w, token, job, 0, hex(16), Date.now())
      })
    }
  }

  private runStage(w: SimWorker, token: number, job: JobState, i: number, processId: string, processStart: number) {
    const req = this.requests.get(job.job_id)!
    const stage = job.stages[i]
    stage.status = 'running'
    stage.started_at = new Date().toISOString()
    job.current_stage = stage.name
    const start = Date.now()
    this.later(req.config.stage_seconds * 1000 + jitter(15), () => {
      if (w.token !== token) return
      const fails = req.config.fail_at === stage.name
      stage.status = fails ? 'failed' : 'succeeded'
      stage.duration_s = (Date.now() - start) / 1000
      this.span(
        job.job_id,
        {
          parentId: processId,
          service: 'worker',
          name: `stage ${stage.name}`,
          kind: 'internal',
          error: fails,
          tags: fails ? { 'pipeline.stage': stage.name, 'otel.status_code': 'ERROR', 'otel.status_description': `falló la etapa ${stage.name} (simulado)` } : { 'pipeline.stage': stage.name },
        },
        start,
        Date.now(),
      )
      if (fails) {
        stage.error = `falló la etapa ${stage.name} (simulado)`
        job.status = 'failed'
        job.error = stage.error
      }
      this.eventCb(say.stageEnd(job, w.slot, stage.name, !fails, stage.duration_s))
      if (!fails && i < job.stages.length - 1) {
        this.runStage(w, token, job, i + 1, processId, processStart)
        return
      }
      this.later(5, () => {
        if (w.token !== token) return
        if (!fails) job.status = 'succeeded'
        job.finished_at = new Date().toISOString()
        this.span(
          job.job_id,
          {
            spanId: processId,
            parentId: this.publishSpan.get(job.job_id) ?? null,
            service: 'worker',
            name: 'process pipeline.jobs',
            kind: 'consumer',
            error: false,
            tags: { 'messaging.system': 'rabbitmq', 'messaging.operation': 'process', 'messaging.message.id': job.job_id, 'pipeline.attempt': job.attempts },
          },
          processStart,
          Date.now(),
        )
        this.eventCb(say.ack(job, w.slot, !fails))
        this.eventCb(say.traceDone(job, w.slot))
        w.jobId = null
        w.token++
        if (w.stopping) this.workers = this.workers.filter((x) => x !== w)
        this.dispatch()
      })
    })
  }

  async getTrace(job: JobState): Promise<Trace | null> {
    const spans = this.spans.get(job.job_id)
    if (!spans || !job.trace_id) return null
    return { traceId: job.trace_id, spans: [...spans], complete: job.status === 'succeeded' || job.status === 'failed', source: 'sim' }
  }
}
