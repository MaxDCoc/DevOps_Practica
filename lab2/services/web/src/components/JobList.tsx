import type { JobState } from '../types'
import { fmtMs, links, shortId } from '../util'

const STATUS_LABEL: Record<string, string> = { queued: 'en cola', running: 'corriendo', succeeded: 'ok', failed: 'falló' }

function totalMs(j: JobState) {
  const end = j.finished_at ? Date.parse(j.finished_at) : Date.now()
  return end - Date.parse(j.submitted_at)
}

interface Props {
  jobs: JobState[]
  apiMs: Record<string, number>
  selectedJob: string | null
  onSelect: (id: string) => void
  isReal: boolean
}

export function JobList({ jobs, apiMs, selectedJob, onSelect, isReal }: Props) {
  if (jobs.length === 0) return <div className="empty-state">Todavía no hay pipelines. Usá los botones del guion.</div>
  const maxTotal = Math.max(...jobs.slice(0, 30).map(totalMs), 1)
  return (
    <div className="jobs">
      <div className="jobs-legend">
        <span>
          <i className="sw api" /> lo que esperó el cliente (202)
        </span>
        <span>
          <i className="sw total" /> lo que tardó el pipeline de verdad
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Pipeline</th>
            <th>Estado</th>
            <th>Etapas</th>
            <th>Intentos</th>
            <th className="wide">Lo que esperó el cliente vs. lo que tardó el pipeline</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.slice(0, 30).map((j) => {
            const api = apiMs[j.job_id]
            const tot = totalMs(j)
            return (
              <tr key={j.job_id} className={j.job_id === selectedJob ? 'selected' : ''} onClick={() => onSelect(j.job_id)}>
                <td>
                  <b>{j.project}</b>
                  <div className="muted mono">{shortId(j.job_id)}</div>
                </td>
                <td>
                  <span className={`status s-${j.status}`}>{STATUS_LABEL[j.status]}</span>
                </td>
                <td>
                  <div className="pills">
                    {j.stages.map((s) => (
                      <span key={s.name} className={`pill p-${s.status}`} title={s.error ?? s.status}>
                        {s.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="center">{j.attempts}</td>
                <td>
                  <div className="cmp">
                    <div className="cmp-total" style={{ width: `${(tot / maxTotal) * 100}%` }}>
                      <span>{fmtMs(tot)}</span>
                    </div>
                    {api != null && <div className="cmp-api" style={{ width: `max(3px, ${(api / maxTotal) * 100}%)` }} title={`La API respondió en ${fmtMs(api)}`} />}
                    {api != null && <span className="cmp-api-label">202 en {fmtMs(api)}</span>}
                  </div>
                </td>
                <td>
                  {isReal && j.trace_id && (
                    <a href={links.jaegerTrace(j.trace_id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="link">
                      Jaeger
                    </a>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
