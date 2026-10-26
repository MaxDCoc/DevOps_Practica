import { useEffect, useState } from 'react'
import type { Backend, JobState, Span, Trace } from '../types'
import { fmtMs, links } from '../util'
import { Traceparent } from './Inspector'

const SERVICE_COLOR: Record<string, string> = { api: 'var(--svc-api)', validator: 'var(--svc-validator)', worker: 'var(--svc-worker)' }

function order(spans: Span[]): { span: Span; depth: number }[] {
  const ids = new Set(spans.map((s) => s.spanId))
  const children = new Map<string | null, Span[]>()
  for (const s of spans) {
    const p = s.parentId && ids.has(s.parentId) ? s.parentId : null
    children.set(p, [...(children.get(p) ?? []), s])
  }
  const out: { span: Span; depth: number }[] = []
  const walk = (p: string | null, d: number) => {
    for (const s of (children.get(p) ?? []).sort((a, b) => a.start - b.start)) {
      out.push({ span: s, depth: d })
      walk(s.spanId, d + 1)
    }
  }
  walk(null, 0)
  return out
}

export function TraceView({ backend, job }: { backend: Backend; job: JobState | null }) {
  const [trace, setTrace] = useState<Trace | null>(null)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<Span | null>(null)
  const jobKey = job ? `${job.job_id}:${job.status}:${job.stages.map((s) => s.status).join()}` : ''

  useEffect(() => {
    setPicked(null)
    if (!job) {
      setTrace(null)
      return
    }
    let alive = true
    let tries = 0
    let timer: number | undefined
    setLoading(true)
    const load = async () => {
      const t = await backend.getTrace(job)
      if (!alive) return
      if (t) setTrace(t)
      tries++
      // Jaeger recibe los spans en lotes: reintentamos hasta que estén todos.
      if ((!t || !t.complete) && tries < 30) timer = window.setTimeout(load, 1500)
      else setLoading(false)
    }
    void load()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, jobKey])

  if (!job) return <div className="empty-state">Lanzá un pipeline desde el guion (o elegí uno en la pestaña Pipelines) para ver su traza.</div>
  if (!job.trace_id) return <div className="empty-state">Este pipeline no tiene trace_id (¿el stack corre con TELEMETRY=off?).</div>
  if (!trace || trace.spans.length === 0)
    return <div className="empty-state">{loading ? 'Buscando la traza en Jaeger… (los spans llegan en lotes, puede tardar unos segundos)' : 'Jaeger todavía no tiene esta traza.'}</div>

  const rows = order(trace.spans)
  const t0 = Math.min(...trace.spans.map((s) => s.start))
  const t1 = Math.max(...trace.spans.map((s) => s.start + s.duration))
  const total = Math.max(t1 - t0, 1)
  const root = trace.spans.find((s) => s.name === 'POST /pipelines')
  const publish = trace.spans.find((s) => s.name === 'publish pipeline.jobs')
  const process = trace.spans.find((s) => s.name === 'process pipeline.jobs')
  const firstStage = trace.spans.filter((s) => s.name.startsWith('stage ')).sort((a, b) => a.start - b.start)[0]
  const workerStart = process?.start ?? firstStage?.start
  const inQueue = publish && workerStart ? workerStart - (publish.start + publish.duration) : null
  const services = [...new Set(trace.spans.map((s) => s.service))]

  return (
    <div className="trace">
      <div className="trace-head">
        <div>
          <b>trace_id</b> <code>{trace.traceId}</code>
          <span className="muted"> · {trace.spans.length} spans · servicios: {services.join(', ')}</span>
          {!trace.complete && <span className="badge warn">incompleta, esperando más spans…</span>}
        </div>
        {trace.source === 'jaeger' ? (
          <a href={links.jaegerTrace(trace.traceId)} target="_blank" rel="noreferrer" className="btn small">
            Abrir en Jaeger
          </a>
        ) : (
          <span className="badge">traza simulada</span>
        )}
      </div>

      <div className="trace-facts">
        {root && (
          <div className="fact">
            <span className="fact-n">{fmtMs(root.duration / 1000)}</span>
            <span>tardó la API en responder 202</span>
          </div>
        )}
        <div className="fact">
          <span className="fact-n">{fmtMs(total / 1000)}</span>
          <span>dura la traza completa</span>
        </div>
        {inQueue != null && (
          <div className="fact">
            <span className="fact-n">{fmtMs(Math.max(inQueue, 0) / 1000)}</span>
            <span>esperó el mensaje en la cola</span>
          </div>
        )}
        {root && (
          <div className="fact">
            <span className="fact-n">{Math.max(1, Math.round(total / root.duration))} veces</span>
            <span>más de lo que esperó el cliente</span>
          </div>
        )}
      </div>

      <div className="waterfall">
        <div className="wf-axis">
          <span>0</span>
          <span>{fmtMs(total / 2000)}</span>
          <span>{fmtMs(total / 1000)}</span>
        </div>
        {rows.map(({ span, depth }) => {
          const left = ((span.start - t0) / total) * 100
          const width = Math.max((span.duration / total) * 100, 0.4)
          const crossesQueue = span === process || (!process && span === firstStage)
          return (
            <div key={span.spanId} className={`wf-row ${picked?.spanId === span.spanId ? 'picked' : ''}`} onClick={() => setPicked(span)}>
              <div className="wf-name" style={{ paddingLeft: depth * 14 }}>
                <span className="svc" style={{ background: SERVICE_COLOR[span.service] ?? 'var(--edge)' }}>
                  {span.service}
                </span>
                <span className={span.error ? 'error' : ''}>
                  {span.name}
                </span>
                {span.kind && <span className="kind">{span.kind}</span>}
                {crossesQueue && <span className="badge amqp" title="Este span es hijo del span «publish» de la API: el contexto cruzó RabbitMQ en el header traceparent">cruzó la cola</span>}
              </div>
              <div className="wf-track">
                <div
                  className={`wf-bar ${span.error ? 'err' : ''}`}
                  style={{ left: `${left}%`, width: `${width}%`, background: span.error ? 'var(--err)' : SERVICE_COLOR[span.service] ?? 'var(--edge)' }}
                />
                <span className={`wf-dur ${left + width > 85 ? 'inside' : ''}`} style={left + width > 85 ? { right: `calc(${100 - left - width}% + 6px)` } : { left: `calc(${left + width}% + 4px)` }}>
                  {fmtMs(span.duration / 1000)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {picked ? (
        <div className="span-detail">
          <h4>
            {picked.service} · {picked.name}
          </h4>
          <p className="muted">
            span_id <code>{picked.spanId}</code> · padre <code>{picked.parentId ?? '— (raíz)'}</code>
          </p>
          {picked.name === 'publish pipeline.jobs' && (
            <>
              <p>Este es el traceparent que viajó en los headers del mensaje AMQP:</p>
              <Traceparent value={`00-${trace.traceId}-${picked.spanId}-01`} />
            </>
          )}
          <table className="tags">
            <tbody>
              {Object.entries(picked.tags)
                .filter(([k]) => !k.startsWith('otel.scope') && k !== 'internal.span.format')
                .map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{String(v)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">
          Hacé clic en un span para ver sus atributos. Fijate que <b>process pipeline.jobs</b> (worker) es hijo de <b>publish pipeline.jobs</b> (API) aunque son procesos distintos y los separa una cola: el
          contexto viajó en el header <code>traceparent</code> del mensaje.
        </p>
      )}
    </div>
  )
}
