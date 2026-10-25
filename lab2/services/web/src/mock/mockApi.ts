import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

import { STAGES } from '../types.ts'
import type { JobState, PipelineRequest, StageName, StageState } from '../types.ts'

/**
 * Servidor de mocks para `npm run dev:mock`.
 *
 * Implementa el contrato del Anexo A sin backend: valida igual que el validador,
 * responde 202, simula el avance de las etapas con `stage_seconds` y permite
 * `fail_at`. Es un plugin de Vite, así que no hay un proceso extra que levantar.
 */

const jobs = new Map<string, JobState>()
const timers = new Set<ReturnType<typeof setTimeout>>()
const PROJECT_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

function nowIso(): string {
  return new Date().toISOString()
}

function newStages(names: readonly string[]): StageState[] {
  return names.map((name) => ({
    name,
    status: 'pending',
    started_at: null,
    duration_s: null,
    error: null,
  }))
}

type Parsed = { ok: true; request: PipelineRequest } | { ok: false; errors: string[] }

function parseRequest(body: unknown): Parsed {
  if (!body || typeof body !== 'object') {
    return { ok: false, errors: ['el cuerpo tiene que ser un objeto JSON'] }
  }

  const errors: string[] = []
  const raw = body as Record<string, unknown>
  const project = typeof raw.project === 'string' ? raw.project : ''
  const branch = typeof raw.branch === 'string' && raw.branch !== '' ? raw.branch : 'main'
  const config = (typeof raw.config === 'object' && raw.config !== null ? raw.config : {}) as Record<
    string,
    unknown
  >

  if (!PROJECT_RE.test(project)) {
    errors.push('project: solo minúsculas, números y guiones (2 a 41 caracteres)')
  }

  const rawStages = Array.isArray(config.stages) ? config.stages : [...STAGES]
  const stages = rawStages.map((stage) => String(stage))
  const known = stages.every((stage) => (STAGES as readonly string[]).includes(stage))
  const inOrder = stages.every((stage, index) => stage === STAGES[index])
  if (stages.length === 0 || !known || !inOrder) {
    errors.push('config.stages: subconjunto de build, test, deploy en ese orden')
  }

  const stageSeconds = typeof config.stage_seconds === 'number' ? config.stage_seconds : 3
  if (!Number.isInteger(stageSeconds) || stageSeconds < 1 || stageSeconds > 30) {
    errors.push('config.stage_seconds: debe estar entre 1 y 30')
  }

  const rawFail = config.fail_at
  const failAt = rawFail === null || rawFail === undefined ? null : String(rawFail)
  if (failAt !== null && !stages.includes(failAt)) {
    errors.push('config.fail_at: tiene que ser nulo o una de las etapas')
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    request: {
      project,
      branch,
      config: {
        stages: stages as StageName[],
        stage_seconds: stageSeconds,
        fail_at: failAt as StageName | null,
      },
    },
  }
}

function scheduleStage(job: JobState, index: number, seconds: number, failAt: string | null): void {
  const stage = job.stages[index]
  if (!stage) return

  stage.status = 'running'
  stage.started_at = nowIso()
  job.status = 'running'
  job.current_stage = stage.name

  const timer = setTimeout(() => {
    timers.delete(timer)
    if (job.status === 'failed') return

    stage.duration_s = seconds
    if (failAt === stage.name) {
      stage.status = 'failed'
      stage.error = `falló la etapa ${stage.name} (simulado)`
      job.status = 'failed'
      job.error = stage.error
      job.finished_at = nowIso()
      return
    }

    stage.status = 'succeeded'
    const next = index + 1
    if (next < job.stages.length) {
      scheduleStage(job, next, seconds, failAt)
    } else {
      job.status = 'succeeded'
      job.finished_at = nowIso()
    }
  }, seconds * 1000)

  timers.add(timer)
}

function createJob(request: PipelineRequest): JobState {
  const job: JobState = {
    job_id: randomUUID(),
    project: request.project,
    branch: request.branch,
    status: 'queued',
    current_stage: null,
    stages: newStages(request.config.stages),
    attempts: 0,
    trace_id: randomBytes(16).toString('hex'),
    submitted_at: nowIso(),
    finished_at: null,
    error: null,
  }
  jobs.set(job.job_id, job)
  return job
}

function finishedJob(status: 'succeeded' | 'failed'): void {
  const submitted = new Date(Date.now() - 90_000).toISOString()
  const job: JobState = {
    job_id: randomUUID(),
    project: 'shop-frontend',
    branch: 'main',
    status: 'queued',
    current_stage: null,
    stages: newStages(STAGES),
    attempts: 1,
    trace_id: randomBytes(16).toString('hex'),
    submitted_at: submitted,
    finished_at: null,
    error: null,
  }

  let cursor = new Date(submitted).getTime()
  for (const stage of job.stages) {
    stage.started_at = new Date(cursor).toISOString()
    if (status === 'failed' && stage.name === 'test') {
      stage.status = 'failed'
      stage.duration_s = 3
      stage.error = 'falló la etapa test (simulado)'
      job.status = 'failed'
      job.error = stage.error
      job.current_stage = 'test'
      break
    }
    stage.status = 'succeeded'
    stage.duration_s = 3
    job.current_stage = stage.name
    cursor += 3000
  }
  job.finished_at = new Date(cursor).toISOString()
  jobs.set(job.job_id, job)
}

function seed(): void {
  if (jobs.size > 0) return
  finishedJob('succeeded')
  finishedJob('failed')

  const queued = createJob({
    project: 'shop-payments',
    branch: 'main',
    config: { stages: [...STAGES], stage_seconds: 2, fail_at: null },
  })
  const timer = setTimeout(() => {
    timers.delete(timer)
    scheduleStage(queued, 0, 2, null)
  }, 1200)
  timers.add(timer)
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function stats() {
  const counts = { queued: 0, running: 0, succeeded: 0, failed: 0 }
  for (const job of jobs.values()) counts[job.status] += 1
  return { counts, queue_depth: counts.queued, workers: 1 }
}

export function deployflowMockPlugin(): Plugin {
  return {
    name: 'deployflow-mock',
    apply: 'serve',
    configureServer(server) {
      seed()

      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) {
          next()
          return
        }

        const path = url.pathname.slice('/api'.length)
        const method = req.method ?? 'GET'

        if (method === 'GET' && path === '/health') {
          json(res, 200, { status: 'ok', hostname: 'mock' })
          return
        }

        if (method === 'GET' && path === '/stats') {
          json(res, 200, stats())
          return
        }

        if (method === 'GET' && path === '/pipelines') {
          const limit = Number(url.searchParams.get('limit') ?? '20')
          const items = [...jobs.values()]
            .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
            .slice(0, Number.isFinite(limit) ? limit : 20)
          json(res, 200, { items })
          return
        }

        if (method === 'POST' && path === '/pipelines') {
          void readBody(req).then((body) => {
            const parsed = parseRequest(body)
            if (!parsed.ok) {
              json(res, 422, { detail: { errors: parsed.errors } })
              return
            }
            const job = createJob(parsed.request)
            setTimeout(() => scheduleStage(job, 0, parsed.request.config.stage_seconds, parsed.request.config.fail_at), 150)
            json(
              res,
              202,
              { job_id: job.job_id, status: 'queued', trace_id: job.trace_id },
              { Location: `/pipelines/${job.job_id}` },
            )
          })
          return
        }

        const match = /^\/pipelines\/([^/]+)$/.exec(path)
        if (method === 'GET' && match) {
          const job = jobs.get(decodeURIComponent(match[1]))
          if (!job) {
            json(res, 404, { detail: 'pipeline no encontrado' })
            return
          }
          json(res, 200, job)
          return
        }

        json(res, 404, { detail: 'not found' })
      })
    },
  }
}
