import { traceUrl } from '../api'
import type { JobState, JobStatus } from '../types'
import { StageTrack } from './StageTrack'

interface Props {
  pipelines: JobState[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'En cola',
  running: 'Corriendo',
  succeeded: 'OK',
  failed: 'Fallido',
}

function elapsed(job: JobState): string {
  const start = new Date(job.submitted_at).getTime()
  const end = job.finished_at ? new Date(job.finished_at).getTime() : Date.now()
  if (job.status === 'queued') return '—'
  const seconds = Math.max(0, (end - start) / 1000)
  return `${seconds.toFixed(1)}s`
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function PipelineList({ pipelines, loading, error, onRefresh }: Props) {
  return (
    <section className="panel list-panel" aria-labelledby="list-title">
      <div className="panel-head">
        <h2 id="list-title">
          Pipelines <span className="muted">({pipelines.length})</span>
        </h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={onRefresh} disabled={loading}>
          Actualizar
        </button>
      </div>

      {error && <p className="banner is-error" role="alert">{error}</p>}

      {!error && pipelines.length === 0 && (
        <p className="empty">
          Todavía no hay pedidos. Ejecutá uno con el formulario o volvé a Swagger para ver el mismo flujo.
        </p>
      )}

      <div className="pipeline-list">
        {pipelines.map((job) => (
          <article key={job.job_id} className={`pipeline is-${job.status}`}>
            <div className="pipeline-main">
              <div className="pipeline-title">
                <span className={`badge is-${job.status}`}>{STATUS_LABEL[job.status]}</span>
                <strong>{job.project}</strong>
                <span className="muted mono">#{job.job_id.slice(0, 8)}</span>
                <span className="muted">· {job.branch}</span>
                {job.attempts > 1 && <span className="muted">· intento {job.attempts}</span>}
              </div>

              <StageTrack stages={job.stages} />

              {job.error && <p className="pipeline-error">{job.error}</p>}
            </div>

            <div className="pipeline-side">
              <span className="duration">{elapsed(job)}</span>
              <span className="muted">{time(job.submitted_at)}</span>
              {job.trace_id ? (
                <a className="trace-link" href={traceUrl(job.trace_id)} target="_blank" rel="noreferrer">
                  Ver traza ↗
                </a>
              ) : (
                <span className="muted" title="Sin TELEMETRY=on no hay trace_id">
                  sin traza
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
