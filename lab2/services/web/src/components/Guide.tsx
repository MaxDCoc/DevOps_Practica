import { useState } from 'react'
import type { PipelineRequest } from '../types'
import { links } from '../util'

export type ActionKey = 'ok' | 'three' | 'trace' | 'fail' | 'burst' | 'invalid' | 'kill'
export type View = 'explain' | 'live'

export interface GuideStep {
  id: string
  n: string
  title: string
  view: View
  goal: string
  look: string[]
  say?: string
}

export const STEPS: GuideStep[] = [
  {
    id: 'ok',
    n: '1',
    title: 'Responder sin esperar',
    view: 'explain',
    goal: 'La API recibe el pedido, lo deja en la cola y responde enseguida. El trabajo lento lo hace un worker después.',
    look: ['El navegador recibe el 202 antes de que el worker empiece.', 'La API queda libre otra vez en milisegundos; el worker tarda segundos.'],
    say: 'La API respondió en unos 200 ms; el pipeline tarda 9 segundos. El cliente no espera la parte lenta.',
  },
  {
    id: 'three',
    n: '2',
    title: 'La API no se bloquea',
    view: 'live',
    goal: 'Mientras los workers trabajan, la API sigue aceptando pedidos igual de rápido.',
    look: ['Las respuestas de la API llegan todas en milisegundos.', 'Los pipelines se reparten entre los workers o esperan en la cola.'],
    say: 'Si la API ejecutara el pipeline, el segundo pedido tendría que esperar al primero.',
  },
  {
    id: 'trace',
    n: '3',
    title: 'Seguir el pedido con la traza',
    view: 'explain',
    goal: 'Un mismo trace_id une lo que hicieron la API, el validador y el worker, aunque en el medio haya una cola.',
    look: ['La cascada: API, validador, publicación, worker y sus etapas.', 'El tramo entre «publish» y «process» es el tiempo que el mensaje esperó en la cola.'],
    say: 'El trace_id viaja dentro del mensaje. Sin eso, el trabajo del worker aparecería como una traza aparte.',
  },
  {
    id: 'fail',
    n: '4',
    title: 'Fallo controlado',
    view: 'explain',
    goal: 'Un pipeline que falla en la etapa test: se ve en rojo en la traza, deja un log de error y queda «failed».',
    look: ['La etapa test falla y deploy no se ejecuta.', 'El worker igual confirma el mensaje: un fallo de negocio no se reintenta.'],
    say: 'Con el trace_id del span rojo encuentro el log exacto del error. Eso es correlación.',
  },
  {
    id: 'burst',
    n: '5',
    title: 'Escalar workers',
    view: 'live',
    goal: '30 pedidos llenan la cola. Con más workers, la cola se vacía más rápido.',
    look: ['El número de mensajes en la cola sube de golpe.', 'Con 3 workers baja unas tres veces más rápido (gráfico en Métricas).'],
    say: 'Escalar es levantar más consumidores de la misma cola. La API no se entera.',
  },
  {
    id: 'invalid',
    n: '6',
    title: 'Pedido inválido',
    view: 'explain',
    goal: 'Un pedido que no cumple las reglas se rechaza en el momento. No llega ningún mensaje a la cola.',
    look: ['El validador lo rechaza y la API responde 422.', 'Redis y la cola no se enteran.'],
  },
  {
    id: 'kill',
    n: '7',
    title: 'Un worker se cae',
    view: 'explain',
    goal: 'Si un worker se cae a mitad de un pipeline, el mensaje vuelve a la cola y lo termina otro. No se pierde nada.',
    look: ['El worker se cae durante la etapa test.', 'El mismo mensaje lo toma otro worker y el pipeline empieza de nuevo.'],
    say: 'El ack va al final a propósito: un mensaje sin confirmar nunca se pierde.',
  },
  {
    id: 'custom',
    n: '8',
    title: 'Pedido a medida',
    view: 'explain',
    goal: 'Armá un pedido propio y mirá qué hace el sistema.',
    look: [],
  },
]

function Cmd({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="cmd">
      <code>{text}</code>
      <button
        className="btn tiny"
        onClick={() => {
          void navigator.clipboard?.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

function Composer({ submit, busy }: { submit: (r: PipelineRequest) => void; busy: boolean }) {
  const [project, setProject] = useState('mi-proyecto')
  const [stages, setStages] = useState(['build', 'test', 'deploy'])
  const [secs, setSecs] = useState(3)
  const [failAt, setFailAt] = useState('')
  const toggle = (s: string) => setStages((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : ['build', 'test', 'deploy'].filter((x) => x === s || cur.includes(x))))
  return (
    <div className="form">
      <label>
        Proyecto
        <input value={project} onChange={(e) => setProject(e.target.value)} spellCheck={false} />
      </label>
      <div className="field">
        <span>Etapas</span>
        <div className="checks">
          {['build', 'test', 'deploy'].map((s) => (
            <label key={s} className="check">
              <input type="checkbox" checked={stages.includes(s)} onChange={() => toggle(s)} /> {s}
            </label>
          ))}
        </div>
      </div>
      <label>
        Segundos por etapa: {secs}
        <input type="range" min={0} max={35} value={secs} onChange={(e) => setSecs(Number(e.target.value))} />
      </label>
      <label>
        Fallar en
        <select value={failAt} onChange={(e) => setFailAt(e.target.value)}>
          <option value="">ninguna etapa</option>
          {['build', 'test', 'deploy'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <button className="btn primary" disabled={busy} onClick={() => submit({ project, branch: 'main', config: { stages, stage_seconds: secs, fail_at: failAt || null } })}>
        Enviar pedido
      </button>
      <p className="muted small">Para ver un rechazo: mayúsculas en el proyecto, 0 o más de 30 segundos, o ninguna etapa.</p>
    </div>
  )
}

interface Props {
  active: string
  onActive: (id: string) => void
  isReal: boolean
  busy: boolean
  workers: number
  run: (key: ActionKey) => void
  submit: (req: PipelineRequest) => void
  setWorkers?: (n: number) => void
}

export function Guide({ active, onActive, isReal, busy, workers, run, submit, setWorkers }: Props) {
  const actions: Record<string, React.ReactNode> = {
    ok: (
      <button className="btn primary" disabled={busy} onClick={() => run('ok')}>
        Lanzar un pipeline
      </button>
    ),
    three: (
      <button className="btn primary" disabled={busy} onClick={() => run('three')}>
        Lanzar 3 pipelines seguidos
      </button>
    ),
    trace: (
      <>
        <button className="btn primary" disabled={busy} onClick={() => run('trace')}>
          Lanzar uno y ver su traza
        </button>
        {isReal && (
          <a className="btn" href={links.jaeger} target="_blank" rel="noreferrer">
            Abrir Jaeger
          </a>
        )}
      </>
    ),
    fail: (
      <button className="btn danger" disabled={busy} onClick={() => run('fail')}>
        Lanzar uno que falla en test
      </button>
    ),
    burst: (
      <>
        <button className="btn primary" disabled={busy} onClick={() => run('burst')}>
          Lanzar 30 pipelines
        </button>
        {setWorkers ? (
          <div className="field">
            <span>Workers</span>
            <div className="seg small">
              {[1, 2, 3, 5].map((n) => (
                <button key={n} className={workers === n ? 'on' : ''} onClick={() => setWorkers(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <span>Para escalar, en una terminal dentro de lab2:</span>
            <Cmd text="docker compose up -d --scale worker=3" />
            <Cmd text="docker compose up -d --scale worker=1" />
          </div>
        )}
      </>
    ),
    invalid: (
      <button className="btn primary" disabled={busy} onClick={() => run('invalid')}>
        Enviar un pedido inválido
      </button>
    ),
    kill: isReal ? (
      <>
        <button className="btn primary" disabled={busy} onClick={() => run('ok')}>
          Lanzar un pipeline
        </button>
        <div className="field">
          <span>Mientras corre, en una terminal (usá el nombre que muestre docker compose ps):</span>
          <Cmd text="docker kill deployflow-worker-1" />
        </div>
      </>
    ) : (
      <button className="btn danger" disabled={busy} onClick={() => run('kill')}>
        Lanzar uno y tirar su worker
      </button>
    ),
    custom: <Composer submit={submit} busy={busy} />,
  }

  return (
    <nav className="panel guide" aria-label="Guion de la demo">
      <header className="panel-head">
        <h2>Guion de la demo</h2>
      </header>
      <ol className="guide-list">
        {STEPS.map((s) => {
          const open = s.id === active
          return (
            <li key={s.id} className={open ? 'open' : ''}>
              <button className="guide-item" onClick={() => onActive(s.id)} aria-expanded={open}>
                <span className="guide-n">{s.n}</span>
                <span className="guide-t">{s.title}</span>
                {Number(s.n) > 5 && <span className="tag">extra</span>}
              </button>
              {open && (
                <div className="guide-body">
                  <p>{s.goal}</p>
                  <div className="actions">{actions[s.id]}</div>
                  {s.look.length > 0 && (
                    <>
                      <h4>Qué mirar</h4>
                      <ul>
                        {s.look.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {s.say && <p className="say">«{s.say}»</p>}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
