import { useRef } from 'react'
import type { Speed, Story } from '../player'
import type { FlowEvent, Phase } from '../types'

export const PHASE_LABEL: Record<Phase, string> = {
  pedido: 'Pedido HTTP',
  cola: 'Cola de mensajes',
  worker: 'Worker',
  traza: 'Observabilidad',
}

interface CaptionProps {
  story: Story | null
  cursor: number
  playing: boolean
  speed: Speed
  waiting: boolean
  onPrev: () => void
  onNext: () => void
  onTogglePlay: () => void
  onSpeed: (s: Speed) => void
  onReplay: () => void
  onShowDetail: () => void
}

export function Caption(p: CaptionProps) {
  if (!p.story)
    return (
      <div className="caption empty">
        <p className="caption-title">Elegí un paso del guion y apretá su botón.</p>
        <p className="caption-text">Vas a ver un pedido recorrer el sistema, un paso por vez, con la explicación de cada uno acá abajo.</p>
      </div>
    )
  const step = p.story.steps[p.cursor]
  const total = p.story.steps.length
  const atEnd = p.cursor >= total - 1
  return (
    <div className="caption">
      <div className="caption-meta">
        {step.phase && <span className={`phase ph-${step.phase}`}>{PHASE_LABEL[step.phase]}</span>}
        <span className="muted">
          Paso {p.cursor + 1} de {p.story.final ? total : `${total}…`}
        </span>
      </div>
      <p className={`caption-title t-${step.tone ?? 'neutral'}`}>{step.title}</p>
      <p className="caption-text">{step.explain}</p>
      {step.why && (
        <p className="caption-why">
          <b>Por qué importa:</b> {step.why}
        </p>
      )}
      {atEnd && p.waiting && <p className="caption-waiting">Esperando el próximo paso: el sistema todavía está trabajando…</p>}
      {atEnd && p.story.final && <p className="caption-end">Fin del recorrido de este pedido.</p>}

      <div className="caption-controls">
        <div className="btn-group">
          <button className="btn" onClick={p.onPrev} disabled={p.cursor === 0} title="Paso anterior (flecha izquierda)">
            Anterior
          </button>
          <button className="btn" onClick={p.onTogglePlay} title="Reproducir o pausar (barra espaciadora)">
            {p.playing ? 'Pausar' : 'Reproducir'}
          </button>
          <button className="btn primary" onClick={p.onNext} disabled={atEnd} title="Paso siguiente (flecha derecha)">
            Siguiente
          </button>
        </div>
        <div className="seg small" role="group" aria-label="Velocidad">
          {(['lento', 'normal', 'rapido'] as Speed[]).map((s) => (
            <button key={s} className={p.speed === s ? 'on' : ''} onClick={() => p.onSpeed(s)}>
              {s === 'rapido' ? 'Rápido' : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {step.payloads?.length ? (
          <button className="btn link" onClick={p.onShowDetail}>
            Ver qué viaja en este paso
          </button>
        ) : null}
        {p.story.final && atEnd && (
          <button className="btn link" onClick={p.onReplay}>
            Repetir desde el principio
          </button>
        )}
      </div>
    </div>
  )
}

interface StepListProps {
  story: Story | null
  cursor: number
  onPick: (i: number) => void
}

export function StepList({ story, cursor, onPick }: StepListProps) {
  // Se listan los pasos ya vistos (no los que todavía no se explicaron), aunque se vuelva atrás.
  const seen = useRef({ key: '', max: 0 })
  if (story && seen.current.key !== story.key) seen.current = { key: story.key, max: 0 }
  seen.current.max = Math.max(seen.current.max, cursor)
  const visible = story ? story.steps.slice(0, seen.current.max + 1) : []
  const more = story ? story.steps.length > visible.length || !story.final : false
  return (
    <section className="panel steps-panel">
      <header className="panel-head">
        <h2>Pasos de este pedido</h2>
        {story && <span className="muted small">{story.project}</span>}
      </header>
      {!story ? (
        <p className="muted small pad">Acá va a aparecer la lista de pasos del pedido que se está explicando. Se puede hacer clic en cualquiera para volver a verlo.</p>
      ) : (
        <ol className="step-list">
          {visible.map((s, i) => (
            <li key={s.id} className={`${i === cursor ? 'current' : ''} ${i > cursor ? 'future' : ''} t-${s.tone ?? 'neutral'}`} onClick={() => onPick(i)}>
              <span className="step-num">{i + 1}</span>
              <span className="step-text">
                {s.phase && <span className={`phase-dot ph-${s.phase}`} title={PHASE_LABEL[s.phase]} />}
                {s.title}
              </span>
            </li>
          ))}
          {more && <li className="pending-step">…</li>}
        </ol>
      )}
    </section>
  )
}

interface LiveProps {
  queue: number
  running: number
  workers: number
  responses: { project: string; ms: number; status: number }[]
}

export function LivePanel({ queue, running, workers, responses }: LiveProps) {
  return (
    <div className="caption live">
      <div className="caption-meta">
        <span className="phase ph-cola">En vivo</span>
        <span className="muted">Estado real del sistema, actualizado cada medio segundo</span>
      </div>
      <div className="live-numbers">
        <div>
          <b>{queue}</b>
          <span>mensajes esperando en la cola</span>
        </div>
        <div>
          <b>{running}</b>
          <span>pipelines ejecutándose</span>
        </div>
        <div>
          <b>{workers}</b>
          <span>{workers === 1 ? 'worker' : 'workers'}</span>
        </div>
      </div>
      <div className="responses">
        <span className="muted small">Últimas respuestas de la API a este navegador:</span>
        {responses.length === 0 ? (
          <span className="muted small"> todavía ninguna.</span>
        ) : (
          <ul>
            {responses.map((r, i) => (
              <li key={i} className={r.status === 202 ? 'ok' : 'err'}>
                {r.status} en {Math.round(r.ms)} ms <span className="muted">· {r.project}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function ActivityFeed({ events }: { events: FlowEvent[] }) {
  const shown = events.filter((e) => e.kind !== 'info').slice(-40).reverse()
  return (
    <section className="panel steps-panel">
      <header className="panel-head">
        <h2>Actividad</h2>
        <span className="muted small">lo último arriba</span>
      </header>
      {shown.length === 0 ? (
        <p className="muted small pad">Acá aparece cada cosa que pasa en el sistema, de todos los pipelines a la vez.</p>
      ) : (
        <ol className="step-list feed">
          {shown.map((e) => (
            <li key={e.id} className={`t-${e.tone ?? 'neutral'}`}>
              <span className="feed-time">{new Date(e.wallTime).toLocaleTimeString('es-AR', { hour12: false })}</span>
              <span className="step-text">
                {e.phase && <span className={`phase-dot ph-${e.phase}`} title={PHASE_LABEL[e.phase]} />}
                <span>
                  {e.project && <b>{e.project}: </b>}
                  {e.title}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
