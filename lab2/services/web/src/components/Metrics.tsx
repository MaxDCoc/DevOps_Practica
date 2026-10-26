import type { HistoryPoint, Stats } from '../types'
import { links } from '../util'

const QUERIES: { label: string; expr: string; why: string }[] = [
  { label: 'Mensajes esperando en la cola', expr: 'sum(rabbitmq_detailed_queue_messages_ready{job="rabbitmq-queues",queue="pipeline.jobs",vhost="/"})', why: 'Crece con la ráfaga y baja más rápido con 3 workers.' },
  { label: 'Workers sanos', expr: 'sum(up{job="worker"}) or vector(0)', why: 'Prometheus descubre las réplicas por DNS: cada una es un target.' },
  { label: 'Jobs en curso', expr: 'sum(worker_jobs_in_progress)', why: 'Con prefetch=1, nunca más que la cantidad de workers.' },
  { label: 'Jobs terminados por resultado', expr: 'sum by (status) (rate(pipeline_jobs_total[1m]))', why: 'El fallo controlado aparece como status="failed".' },
  { label: 'p95 de POST /pipelines', expr: 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="api",method="POST",route="/pipelines"}[1m])))', why: 'Unos 0,2 s aunque el pipeline tarde 9 s: eso es la asincronía.' },
  { label: 'p95 del pipeline completo', expr: 'histogram_quantile(0.95, sum by (le) (rate(pipeline_job_duration_seconds_bucket[1m])))', why: 'Incluye la espera en la cola.' },
  { label: 'Fallos por etapa', expr: 'sum by (stage) (pipeline_stage_failures_total)', why: 'Sube «test» con cada fail_at: test.' },
]

function Spark({ history }: { history: HistoryPoint[] }) {
  const W = 640
  const H = 150
  if (history.length < 2) return <div className="empty-state small">Juntando datos…</div>
  const maxY = Math.max(4, ...history.map((p) => Math.max(p.queue, p.running, p.workers)))
  const x = (i: number) => (i / (history.length - 1)) * (W - 30) + 25
  const y = (v: number) => H - 18 - (v / maxY) * (H - 30)
  const path = (k: keyof HistoryPoint) => history.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k] as number).toFixed(1)}`).join(' ')
  const last = history[history.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="Cola, jobs en curso y workers en el tiempo">
      {[0, Math.round(maxY / 2), maxY].map((v) => (
        <g key={v}>
          <line x1={25} x2={W - 5} y1={y(v)} y2={y(v)} className="grid" />
          <text x={20} y={y(v) + 4} className="tiny" textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <path d={path('workers')} className="ln workers" />
      <path d={path('running')} className="ln running" />
      <path d={path('queue')} className="ln queue" />
      <text x={W - 6} y={y(last.queue) - 6} className="tiny" textAnchor="end" fill="var(--msg)">
        cola {last.queue}
      </text>
      <text x={25} y={H - 2} className="tiny">
        últimos {Math.round((last.t - history[0].t) / 1000)} s
      </text>
    </svg>
  )
}

export function Metrics({ stats, history, isReal }: { stats: Stats | null; history: HistoryPoint[]; isReal: boolean }) {
  const c = stats?.counts
  return (
    <div className="metrics">
      <div className="tiles">
        <div className="tile">
          <span className="tile-n amqp">{stats?.queue_depth ?? '—'}</span>
          <span>en la cola</span>
        </div>
        <div className="tile">
          <span className="tile-n worker">{stats?.workers ?? '—'}</span>
          <span>workers vivos</span>
        </div>
        <div className="tile">
          <span className="tile-n">{c?.running ?? '—'}</span>
          <span>corriendo</span>
        </div>
        <div className="tile">
          <span className="tile-n ok">{c?.succeeded ?? '—'}</span>
          <span>terminaron bien</span>
        </div>
        <div className="tile">
          <span className="tile-n err">{c?.failed ?? '—'}</span>
          <span>fallaron</span>
        </div>
      </div>
      <div className="spark-wrap">
        <div className="legend">
          <span>
            <i className="sw queue" /> mensajes en la cola
          </span>
          <span>
            <i className="sw running" /> jobs corriendo
          </span>
          <span>
            <i className="sw workers" /> workers
          </span>
        </div>
        <Spark history={history} />
        <p className="muted small">
          {isReal ? 'Datos de GET /stats (cuenta en Redis + profundidad de la cola en RabbitMQ + latidos de los workers).' : 'Datos del simulador.'} Prometheus no recibe nada: cada 5 s{' '}
          <b>va a buscar</b> /metrics a cada servicio (pull). Las trazas, en cambio, los servicios las <b>empujan</b> a Jaeger (push).
        </p>
      </div>
      <div className="queries">
        <h3>Consultas para mostrar en Prometheus</h3>
        <ul>
          {QUERIES.map((q) => (
            <li key={q.label}>
              <a href={links.promQuery(q.expr)} target="_blank" rel="noreferrer">
                {q.label}
              </a>
              <code>{q.expr}</code>
              <span className="muted small">{q.why}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
