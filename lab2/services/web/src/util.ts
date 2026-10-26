import type { PipelineRequest } from './types'

/** Un color estable por trace_id: el mismo pedido se ve del mismo color en todo el dashboard. */
export function traceColor(traceId: string | null | undefined): string {
  if (!traceId) return 'transparent'
  let h = 0
  for (let i = 0; i < traceId.length; i++) h = (h * 31 + traceId.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 75% 52%)`
}

export const shortId = (id: string | null | undefined, n = 8) => (id ? id.slice(0, n) : '—')

export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`)

/** Las UIs de la infraestructura, en el mismo host desde el que se abrió el dashboard. */
const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
export const links = {
  jaeger: `http://${host}:16686`,
  jaegerTrace: (traceId: string) => `http://${host}:16686/trace/${traceId}`,
  prometheus: `http://${host}:9090`,
  promQuery: (expr: string) => `http://${host}:9090/query?g0.expr=${encodeURIComponent(expr)}&g0.tab=graph&g0.range_input=5m`,
  rabbit: `http://${host}:15672/#/queues`,
  swagger: `http://${host}:8000/docs`,
}

export function request(project: string, failAt: string | null = null, stageSeconds = 3, stages = ['build', 'test', 'deploy']): PipelineRequest {
  return { project, branch: 'main', config: { stages, stage_seconds: stageSeconds, fail_at: failAt } }
}

const NAMES = ['shop-frontend', 'payments-api', 'auth-service', 'search', 'mobile-app', 'billing', 'catalog', 'notifier']
export const randomProject = () => NAMES[Math.floor(Math.random() * NAMES.length)]

const NODE_NAMES: Record<string, string> = { browser: 'Navegador', api: 'API', validator: 'Validador', rabbit: 'RabbitMQ', redis: 'Redis', jaeger: 'Jaeger', prometheus: 'Prometheus' }
export const nodeName = (id: string) => (id.startsWith('worker-') ? `Worker ${Number(id.slice(7)) + 1}` : NODE_NAMES[id] ?? id)
