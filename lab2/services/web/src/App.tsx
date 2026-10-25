import { useCallback, useEffect, useState } from 'react'

import { API_DOCS_URL, ApiError, JAEGER_URL, createPipeline } from './api'
import { PipelineForm } from './components/PipelineForm'
import { PipelineList } from './components/PipelineList'
import { StatsPanel } from './components/StatsPanel'
import { useLiveData } from './hooks/useLiveData'
import type { PipelineRequest } from './types'
import './App.css'

export default function App() {
  const { pipelines, stats, health, error, lastUpdate, loading, refresh } = useLiveData()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failures, setFailures] = useState<string[]>([])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const reportFailure = useCallback((reason: unknown) => {
    if (reason instanceof ApiError) {
      setFailures(reason.errors.length > 0 ? reason.errors : [reason.message])
    } else if (reason instanceof Error) {
      setFailures([reason.message])
    } else {
      setFailures(['Error inesperado al crear el pipeline'])
    }
  }, [])

  const run = useCallback(
    async (request: PipelineRequest) => {
      setBusy(true)
      setFailures([])
      try {
        const accepted = await createPipeline(request)
        const trace = accepted.trace_id
          ? ` · traza ${accepted.trace_id.slice(0, 8)}…`
          : ' · trace_id pendiente (TELEMETRY=off)'
        setNotice(`202 · job ${accepted.job_id.slice(0, 8)}${trace}`)
        refresh()
      } catch (reason) {
        reportFailure(reason)
      } finally {
        setBusy(false)
      }
    },
    [refresh, reportFailure],
  )

  const burst = useCallback(
    async (request: PipelineRequest, count: number) => {
      setBusy(true)
      setFailures([])
      let accepted = 0
      for (let index = 0; index < count; index += 1) {
        try {
          await createPipeline(request)
          accepted += 1
        } catch (reason) {
          reportFailure(reason)
          break
        }
      }
      setNotice(`${accepted} de ${count} pedidos aceptados (202)`)
      setBusy(false)
      refresh()
    },
    [refresh, reportFailure],
  )

  const healthState = health ? 'is-ok' : error ? 'is-error' : 'is-idle'

  return (
    <div className="app">
      <div className="container">
        <header className="app-header">
          <div className="brand">
            <span className="logo" aria-hidden="true">
              ▦
            </span>
            <div>
              <h1>DeployFlow</h1>
              <p>pipelines asíncronos · trazas y métricas en vivo</p>
            </div>
          </div>

          <div className="header-side">
            <span className={`pill ${healthState}`}>
              <span className="dot" aria-hidden="true" />
              {health ? `API ${health.status}` : error ? 'API sin conexión' : 'conectando…'}
            </span>
            <nav className="header-links">
              <a href={API_DOCS_URL} target="_blank" rel="noreferrer">
                Swagger
              </a>
              <a href={JAEGER_URL} target="_blank" rel="noreferrer">
                Jaeger
              </a>
            </nav>
          </div>
        </header>

        {notice && (
          <p className="banner is-ok" role="status">
            {notice}
          </p>
        )}
        {failures.length > 0 && (
          <div className="banner is-error" role="alert">
            {failures.length === 1 ? failures[0] : (
              <ul>
                {failures.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <main className="layout">
          <div className="col-left">
            <PipelineForm busy={busy} onRun={run} onBurst={burst} />
            <StatsPanel stats={stats} lastUpdate={lastUpdate} />
          </div>
          <div className="col-right">
            <PipelineList pipelines={pipelines} loading={loading} error={error} onRefresh={refresh} />
          </div>
        </main>

        <footer className="app-footer">
          Se actualiza cada 2 s · el estado sale de Redis a través de la API · el trabajo lo hace el worker
        </footer>
      </div>
    </div>
  )
}
