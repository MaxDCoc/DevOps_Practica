import { useState } from 'react'

import { STAGES } from '../types'
import type { PipelineRequest, StageName } from '../types'

interface Props {
  busy: boolean
  onRun: (request: PipelineRequest) => Promise<void>
  onBurst: (request: PipelineRequest, count: number) => Promise<void>
}

const MAX_BURST = 10

export function PipelineForm({ busy, onRun, onBurst }: Props) {
  const [project, setProject] = useState('shop-frontend')
  const [branch, setBranch] = useState('main')
  const [stageSeconds, setStageSeconds] = useState(3)
  const [error, setError] = useState<string | null>(null)

  function buildRequest(failAt: StageName | null): PipelineRequest {
    return {
      project: project.trim(),
      branch: branch.trim() || 'main',
      config: { stages: [...STAGES], stage_seconds: stageSeconds, fail_at: failAt },
    }
  }

  function validate(): boolean {
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(project.trim())) {
      setError('El proyecto va en minúsculas, números y guiones (2 a 41 caracteres).')
      return false
    }
    if (stageSeconds < 1 || stageSeconds > 30) {
      setError('Los segundos por etapa van entre 1 y 30.')
      return false
    }
    setError(null)
    return true
  }

  async function run(failAt: StageName | null) {
    if (!validate()) return
    await onRun(buildRequest(failAt))
  }

  async function burst() {
    if (!validate()) return
    await onBurst(buildRequest(null), MAX_BURST)
  }

  return (
    <section className="panel form-panel" aria-labelledby="form-title">
      <h2 id="form-title">Nuevo pipeline</h2>
      <p className="panel-hint">
        La API responde <code>202</code> al instante. El avance aparece en la lista cuando el worker lo toma.
      </p>

      <div className="field">
        <label htmlFor="project">Proyecto</label>
        <input
          id="project"
          value={project}
          onChange={(event) => setProject(event.target.value)}
          placeholder="shop-frontend"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="branch">Rama</label>
          <input
            id="branch"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label htmlFor="seconds">Segundos por etapa</label>
          <input
            id="seconds"
            type="number"
            min={1}
            max={30}
            value={stageSeconds}
            onChange={(event) => setStageSeconds(Number(event.target.value))}
          />
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(null)}>
          Ejecutar OK
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run('test')}>
          Forzar fallo en test
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void burst()}>
          Lanzar {MAX_BURST}
        </button>
      </div>

      <dl className="form-meta">
        <div>
          <dt>Etapas</dt>
          <dd>{STAGES.join(' → ')}</dd>
        </div>
        <div>
          <dt>Mensajería</dt>
          <dd>RabbitMQ · ack manual</dd>
        </div>
      </dl>
    </section>
  )
}
