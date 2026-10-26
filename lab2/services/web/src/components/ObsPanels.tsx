// Los tres paneles de observabilidad que van debajo del diagrama: trazas (Jaeger), métricas
// (Prometheus) y logs JSON. Se alimentan con datos reales (o del simulador).
import { useEffect, useState } from 'react'
import type { Story } from '../player'
import type { Backend, FlowEvent, JobState, Snapshot, Span } from '../types'

const C = {
  cyan: 'var(--obs-cyan)',
  violet: 'var(--obs-violet)',
  ok: 'var(--obs-ok)',
  err: 'var(--obs-err)',
  amber: 'var(--obs-amber)',
  orange: 'var(--obs-orange)',
}
const JOB_COLORS = ['#3bb8d6', '#9b87f5', '#e27fbf', '#5fa8f0', '#d4b23e', '#3fbfa8']
export function jobColor(key: string | null | undefined) {
  if (!key) return JOB_COLORS[0]
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return JOB_COLORS[h % JOB_COLORS.length]
}

/** Qué spans ya llegaron a Jaeger en este paso: un span se exporta recién cuando termina. */
function exportedSpans(story: Story, upto: number): Set<string> {
  const out = new Set<string>()
  for (const e of story.steps.slice(0, upto + 1)) {
    if (e.kind === 'http-res' && e.to === 'browser') ['POST /pipelines', 'POST', 'POST /validate', 'publish pipeline.jobs'].forEach((n) => out.add(n))
    if (e.kind === 'stage-end') out.add(`stage ${e.meta?.stage}`)
    if (e.kind === 'ack' || e.kind === 'span') out.add('process pipeline.jobs')
  }
  return out
}

interface LogLine {
  id: number
  level: 'info' | 'warn' | 'error'
  service: string
  msg: string
  trace?: string | null
  color: string
}
function logFor(e: FlowEvent): LogLine | null {
  const color = jobColor(e.jobId ?? e.story)
  if (e.kind === 'http-res' && e.to === 'browser')
    return e.tone === 'ok'
      ? { id: e.id, level: 'info', service: 'api', msg: 'pipeline aceptado', trace: e.traceId, color }
      : { id: e.id, level: 'warn', service: 'api', msg: `pedido rechazado (${e.short})`, trace: e.traceId, color }
  if (e.kind === 'stage-end' && !e.meta?.ok) return { id: e.id, level: 'error', service: 'worker', msg: `falló la etapa ${e.meta?.stage}`, trace: e.traceId, color }
  if (e.kind === 'ack' && e.meta?.ok) return { id: e.id, level: 'info', service: 'worker', msg: 'pipeline terminado', trace: e.traceId, color }
  if (e.kind === 'redeliver') return { id: e.id, level: 'warn', service: 'worker', msg: 'mensaje devuelto a la cola', trace: e.traceId, color }
  return null
}

function useTraces(backend: Backend, jobs: JobState[]) {
  const [traces, setTraces] = useState<Record<string, Span[]>>({})
  const key = jobs.map((j) => `${j.job_id}:${j.status}:${j.stages.map((s) => s.status).join('')}`).join('|')
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    let tries = 0
    const load = async () => {
      const found: Record<string, Span[]> = {}
      let complete = true
      for (const j of jobs) {
        const t = await backend.getTrace(j)
        if (t) found[j.job_id] = t.spans
        if (!t?.complete) complete = false
      }
      if (!alive) return
      setTraces((cur) => ({ ...cur, ...found }))
      if (!complete && ++tries < 20) timer = window.setTimeout(load, 1500)
    }
    void load()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, key])
  return traces
}

interface Props {
  mode: 'explain' | 'live'
  backend: Backend
  snapshot: Snapshot
  story: Story | null
  cursor: number
  stepStart: number
  travelMs: number
  live: FlowEvent[]
  onPanelClick: (id: 'jaeger' | 'prometheus' | 'logs') => void
}

export function ObsPanels(p: Props) {
  const explain = p.mode === 'explain'
  // reloj propio, alcanza con 4 veces por segundo
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(performance.now()), 250)
    return () => window.clearInterval(t)
  }, [])

  const story = explain ? p.story : null
  const step = story?.steps[p.cursor]
  const arrivedIdx = step ? (now - p.stepStart >= p.travelMs ? p.cursor : p.cursor - 1) : -1

  const traceJobs = explain
    ? p.snapshot.jobs.filter((j) => j.job_id === story?.jobId)
    : p.snapshot.jobs.filter((j) => j.trace_id && j.status !== 'queued').slice(0, 2)
  const traces = useTraces(p.backend, traceJobs)
  const revealed = story ? exportedSpans(story, arrivedIdx) : null
  const logs = (explain ? story?.steps.slice(0, arrivedIdx + 1) ?? [] : p.live.filter((e) => e.endsAt <= now))
    .map(logFor)
    .filter((l): l is LogLine => !!l)
    .slice(-6)
  const scraping = (Date.now() % 5000) / 1000 < 1.3

  return (
    <svg viewBox="40 590 1360 268" className="obs" role="group" aria-label="Trazas, métricas y logs">
      <ObsDefs />
      <TracesPanel jobs={traceJobs} traces={traces} revealed={revealed} single={explain} onClick={() => p.onPanelClick('jaeger')} />
      <MetricsPanel snapshot={p.snapshot} scraping={scraping} onClick={() => p.onPanelClick('prometheus')} />
      <LogsPanel lines={logs} onClick={() => p.onPanelClick('logs')} />
    </svg>
  )
}

function PanelFrame({ x, icon, iconColor, title, onClick, children }: { x: number; icon: string; iconColor: string; title: string; onClick: () => void; children?: React.ReactNode }) {
  return (
    <g className="obs-panel" onClick={onClick} role="button" tabIndex={0} aria-label={title}>
      <rect className="panel-box" x={x} y={600} width={400} height={245} rx={18} />
      <use href={`#o-${icon}`} x={x + 22} y={616} width={29} height={29} style={{ color: iconColor }} className="panel-icon" />
      <text x={x + 62} y={636} className="panel-title">
        {title}
      </text>
      <path d={`M${x + 24} 654h352`} className="panel-rule" />
      {children}
    </g>
  )
}

const SVC_COLOR: Record<string, string> = { api: C.cyan, validator: C.ok, worker: C.violet }

function TracesPanel({ jobs, traces, revealed, single, onClick }: { jobs: JobState[]; traces: Record<string, Span[]>; revealed: Set<string> | null; single: boolean; onClick: () => void }) {
  const blocks = jobs.map((j) => ({ job: j, spans: (traces[j.job_id] ?? []).slice().sort((a, b) => a.start - b.start) }))
  return (
    <PanelFrame x={64} icon="trace" iconColor={C.cyan} title="Jaeger · trazas" onClick={onClick}>
      {blocks.length === 0 && (
        <text x={88} y={690} className="panel-empty">
          {single ? 'Lanzá un pedido para ver su traza.' : 'Todavía no hay trazas.'}
        </text>
      )}
      {blocks.map(({ job, spans }, bi) => {
        const top = single ? 672 : 668 + bi * 90
        const rowH = single ? 19 : 9
        const t0 = Math.min(...spans.map((s) => s.start))
        const t1 = Math.max(...spans.map((s) => s.start + s.duration))
        const x0 = single ? 250 : 128
        const x1 = 440
        const scale = (x1 - x0) / Math.max(t1 - t0, 1)
        const c = jobColor(job.job_id)
        return (
          <g key={job.job_id}>
            <circle cx={94} cy={top - 6} r={3} fill={c} />
            <text x={104} y={top - 1} className="panel-small">
              {job.project} · {job.trace_id?.slice(0, 8)}
            </text>
            {spans.length === 0 && (
              <text x={88} y={top + 22} className="panel-empty">
                esperando spans…
              </text>
            )}
            {spans.slice(0, 8).map((s, i) => {
              const visible = !revealed || revealed.has(s.name)
              const y = top + 6 + i * rowH
              return (
                <g key={s.spanId} opacity={visible ? 1 : 0.12}>
                  {single && (
                    <text x={88} y={y + 9} className={`span-name ${s.error ? 'err' : ''}`}>
                      {s.name}
                    </text>
                  )}
                  <rect x={x0 + (s.start - t0) * scale} y={y + (single ? 2 : 0)} width={Math.max(4, s.duration * scale)} height={single ? 9 : 5} rx={2} fill={s.error ? C.err : single ? SVC_COLOR[s.service] ?? c : c}>
                    <title>
                      {s.service} · {s.name} · {(s.duration / 1000).toFixed(0)} ms
                    </title>
                  </rect>
                </g>
              )
            })}
          </g>
        )
      })}
    </PanelFrame>
  )
}

function MetricsPanel({ snapshot, scraping, onClick }: { snapshot: Snapshot; scraping: boolean; onClick: () => void }) {
  const h = snapshot.history.slice(-60)
  const X0 = 548
  const X1 = 892
  const Y0 = 675
  const Y1 = 753
  const base = h[0]
  const series = (k: 'succeeded' | 'failed' | 'queue') => h.map((pt) => (k === 'queue' ? pt.queue : (pt[k] ?? 0) - (base?.[k] ?? 0)))
  const ok = series('succeeded')
  const bad = series('failed')
  const q = series('queue')
  const max = Math.max(3, ...ok, ...bad, ...q)
  const line = (v: number[]) => v.map((y, i) => `${i ? 'L' : 'M'}${(X0 + (i / Math.max(v.length - 1, 1)) * (X1 - X0)).toFixed(1)} ${(Y1 - (y / max) * (Y1 - Y0 - 4)).toFixed(1)}`).join(' ')
  const durations = snapshot.jobs.filter((j) => j.finished_at).map((j) => (Date.parse(j.finished_at!) - Date.parse(j.submitted_at)) / 1000)
  const BUCKETS = [2, 5, 10, 20, 30, 60, Infinity]
  const counts = BUCKETS.map((le) => durations.filter((d) => d <= le).length)
  const maxCount = Math.max(1, ...counts)
  const c = snapshot.stats?.counts
  return (
    <PanelFrame x={520} icon="prometheus" iconColor={C.orange} title="Prometheus · métricas" onClick={onClick}>
      <circle cx={888} cy={667} r={4} fill={scraping ? C.violet : 'var(--edge)'} />
      <text x={878} y={671} textAnchor="end" className="panel-small">
        {scraping ? 'scrape en curso' : 'scrape cada 5 s'}
      </text>
      <path d={`M${X0} ${Y0 + 8}v70h344M${X0} 714h344`} fill="none" className="panel-grid" />
      {h.length > 1 && (
        <>
          <path d={line(q)} fill="none" stroke={C.amber} strokeWidth={1.6} strokeDasharray="4 3" />
          <path d={line(ok)} fill="none" stroke={C.ok} strokeWidth={2} strokeLinejoin="round" />
          <path d={line(bad)} fill="none" stroke={C.err} strokeWidth={2} strokeLinejoin="round" />
        </>
      )}
      <text x={X0} y={772} className="panel-small">
        <tspan fill={C.ok}>ok</tspan> · <tspan fill={C.err}>fallidos</tspan> · <tspan fill={C.amber}>en cola</tspan>
      </text>
      {counts.map((n, i) => {
        const hh = 2 + (n / maxCount) * 40
        return <rect key={i} x={X0 + i * 16} y={830 - hh} width={11} height={hh} rx={2} fill={i > 4 ? C.violet : C.cyan} opacity={0.7} />
      })}
      <text x={X0} y={842} className="panel-tiny">
        duración
      </text>
      <use href="#o-check" x={742} y={792} width={16} height={16} style={{ color: C.ok }} className="sign" />
      <text x={764} y={807} className="metric-num" fill={C.ok}>
        {c?.succeeded ?? 0}
      </text>
      <use href="#o-cross" x={824} y={792} width={16} height={16} style={{ color: C.err }} className="sign" />
      <text x={846} y={807} className="metric-num" fill={C.err}>
        {c?.failed ?? 0}
      </text>
      <text x={742} y={830} className="panel-tiny">
        terminados
      </text>
    </PanelFrame>
  )
}

function LogsPanel({ lines, onClick }: { lines: LogLine[]; onClick: () => void }) {
  return (
    <PanelFrame x={976} icon="logs" iconColor={C.amber} title="Logs JSON" onClick={onClick}>
      {lines.length === 0 && (
        <text x={1000} y={690} className="panel-empty">
          Sin eventos todavía.
        </text>
      )}
      {lines.map((l, i) => {
        const y = 677 + i * 28
        return (
          <g key={l.id} className={`log-row ${l.level}`}>
            <rect x={994} y={y - 12} width={364} height={24} rx={5} className="log-bg" />
            <circle cx={1007} cy={y} r={3.5} fill={l.color} />
            {l.level === 'error' && <circle cx={1007} cy={y} r={7} fill="none" stroke={C.err} strokeWidth={1.2} />}
            <text x={1020} y={y + 4} className="log-text">
              <tspan className={`lvl ${l.level}`}>{l.level}</tspan> {l.service} {l.msg}
              {l.trace && <tspan className="log-trace"> {l.trace.slice(0, 8)}</tspan>}
            </text>
          </g>
        )
      })}
    </PanelFrame>
  )
}

function ObsDefs() {
  return (
    <defs>
      <symbol id="o-trace" viewBox="-24 -24 48 48">
        <path d="M-18-17h26m-26 0v34m0-23h16m-16 11h29m-29 12h20" />
        <circle cx="12" cy="-17" r="4" />
        <circle cx="3" cy="-6" r="4" />
        <circle cx="16" cy="5" r="4" />
        <circle cx="6" cy="17" r="4" />
      </symbol>
      <symbol id="o-prometheus" viewBox="-24 -24 48 48">
        <path d="M-16 9c-12-15 8-19 4-30 11 7 5 13 10 17 9-7 1-12 11-18-2 12 17 18 9 31Z" fill="currentColor" stroke="none" />
        <path d="M-18 14h36M-11 20h22" strokeWidth="3" />
      </symbol>
      <symbol id="o-logs" viewBox="-24 -24 48 48">
        <rect x="-22" y="-20" width="44" height="40" rx="5" />
        <path d="m-13-8 5 4-5 4m12 0h12M-13 9h24" />
      </symbol>
      <symbol id="o-check" viewBox="-12 -12 24 24">
        <path d="m-7 0 5 5 10-11" />
      </symbol>
      <symbol id="o-cross" viewBox="-12 -12 24 24">
        <path d="m-6-6 12 12M6-6-6 6" />
      </symbol>
    </defs>
  )
}
