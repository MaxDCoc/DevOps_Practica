import type {
  AcceptedResponse,
  Health,
  JobState,
  PipelineList,
  PipelineRequest,
  Stats,
} from './types'

/** En el contenedor nginx reenvía /api/ a la API; en Vite lo hace el proxy. */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

export class ApiError extends Error {
  readonly status: number
  readonly errors: string[]

  constructor(status: number, message: string, errors: string[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
  }
}

function extractErrors(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail === 'string') return [detail]
  if (detail && typeof detail === 'object') {
    const errors = (detail as { errors?: unknown }).errors
    if (Array.isArray(errors)) return errors.map((e) => String(e))
  }
  return []
}

function fallbackMessage(status: number): string {
  if (status === 422) return 'El validador rechazó el pedido'
  if (status === 503) return 'La cola o el validador no responden'
  if (status === 404) return 'El pipeline no existe (o venció a las 24 h)'
  return `La API respondió ${status}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null)
    const errors = extractErrors(body)
    throw new ApiError(res.status, errors[0] ?? fallbackMessage(res.status), errors)
  }
  return (await res.json()) as T
}

export async function listPipelines(limit = 20): Promise<JobState[]> {
  const data = await request<PipelineList>(`/pipelines?limit=${limit}`)
  return data.items
}

export function getStats(): Promise<Stats> {
  return request<Stats>('/stats')
}

export function getHealth(): Promise<Health> {
  return request<Health>('/health')
}

export function createPipeline(payload: PipelineRequest): Promise<AcceptedResponse> {
  return request<AcceptedResponse>('/pipelines', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/* Enlaces externos. Se pueden pisar en build con VITE_*_URL. */

export const JAEGER_URL =
  (import.meta.env.VITE_JAEGER_URL as string | undefined) ?? 'http://localhost:16686'
export const PROMETHEUS_URL =
  (import.meta.env.VITE_PROMETHEUS_URL as string | undefined) ?? 'http://localhost:9090'
export const RABBITMQ_URL =
  (import.meta.env.VITE_RABBITMQ_URL as string | undefined) ?? 'http://localhost:15672'
export const API_DOCS_URL =
  (import.meta.env.VITE_API_DOCS_URL as string | undefined) ?? 'http://localhost:8000/docs'

export function traceUrl(traceId: string): string {
  return `${JAEGER_URL}/trace/${traceId}`
}
