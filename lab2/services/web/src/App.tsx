import { useEffect, useMemo, useRef, useState } from 'react'
import { RealBackend } from './backend/real'
import { SimBackend } from './backend/sim'
import { Concepts } from './components/Concepts'
import { ActivityFeed, Caption, LivePanel, StepList } from './components/Explainer'
import { Guide, STEPS, type ActionKey, type View } from './components/Guide'
import { Inspector } from './components/Inspector'
import { JobList } from './components/JobList'
import { Metrics } from './components/Metrics'
import { NodeInfo } from './components/NodeInfo'
import { FlowDiagram } from './components/FlowDiagram'
import { ObsPanels } from './components/ObsPanels'
import { TraceView } from './components/TraceView'
import { useStoryPlayer } from './player'
import type { Backend, NodeId, PipelineRequest, Snapshot } from './types'
import { links, randomProject, request } from './util'

type Mode = 'real' | 'sim'
type Tab = 'detalle' | 'traza' | 'pipelines' | 'metricas' | 'conceptos'

const EMPTY_SNAPSHOT: Snapshot = { connected: false, error: null, stats: null, workerSlots: [0], jobs: [], history: [] }

async function apiIsUp(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const r = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

export default function App() {
  const [mode, setMode] = useState<Mode | null>(null)
  const [apiDown, setApiDown] = useState(false)
  useEffect(() => {
    void apiIsUp().then((up) => {
      setApiDown(!up)
      setMode(up ? 'real' : 'sim')
    })
  }, [])
  if (!mode) return <div className="boot">Buscando la API de DeployFlow…</div>
  return <Demo key={mode} mode={mode} setMode={setMode} apiDown={apiDown} />
}

function Demo({ mode, setMode, apiDown }: { mode: Mode; setMode: (m: Mode) => void; apiDown: boolean }) {
  const backend: Backend = useMemo(() => (mode === 'real' ? new RealBackend() : new SimBackend()), [mode])
  const sim = backend instanceof SimBackend ? backend : null

  const [snap, setSnap] = useState<Snapshot>(EMPTY_SNAPSHOT)
  useEffect(() => backend.onSnapshot(setSnap), [backend])
  const player = useStoryPlayer(backend)
  const { story, cursor } = player

  const [guideStep, setGuideStep] = useState('ok')
  const [view, setView] = useState<View>('explain')
  const [tab, setTab] = useState<Tab>('detalle')
  const [selectedJob, setSelectedJob] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null)
  const [apiMs, setApiMs] = useState<Record<string, number>>({})
  const [responses, setResponses] = useState<{ project: string; ms: number; status: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const killTarget = useRef<string | null>(null)

  const workers = snap.stats?.workers ?? 1

  // El pipeline que se explica es también el que se muestra en Traza.
  useEffect(() => {
    if (story?.jobId) setSelectedJob(story.jobId)
  }, [story?.jobId])

  const submit = async (req: PipelineRequest, explainIt: boolean) => {
    if (explainIt) player.focusNext()
    const r = await backend.submit(req)
    setResponses((list) => [{ project: req.project, ms: r.ms, status: r.status }, ...list].slice(0, 8))
    if (r.ok) setApiMs((m) => ({ ...m, [r.jobId]: r.ms }))
    else if (r.status !== 422) setNotice(`La API respondió ${r.status || 'sin conexión'}: ${r.errors.join(', ')}`)
    return r
  }

  const pickGuide = (id: string) => {
    setGuideStep(id)
    const step = STEPS.find((s) => s.id === id)
    if (step) setView(step.view)
  }

  const run = async (key: ActionKey) => {
    setNotice(null)
    setSelectedNode(null)
    switch (key) {
      case 'ok':
        setTab('detalle')
        await submit(request(randomProject()), true)
        break
      case 'trace':
        setTab('traza')
        await submit(request('shop-frontend'), true)
        break
      case 'fail':
        setTab('detalle')
        await submit(request('shop-frontend', 'test'), true)
        break
      case 'invalid':
        setTab('detalle')
        await submit({ project: 'Shop Frontend', branch: 'main', config: { stages: ['deploy', 'build'], stage_seconds: 99, fail_at: null } }, true)
        break
      case 'kill': {
        setTab('detalle')
        if (sim && sim.workerCount < 2) sim.setWorkers(2) // con dos se ve que lo termina OTRO worker
        const r = await submit(request('payments-api', null, 3), true)
        if (r.ok) killTarget.current = r.jobId
        break
      }
      case 'three':
        setBusy(true)
        for (let i = 0; i < 3; i++) await submit(request(randomProject(), null, 3), false)
        setBusy(false)
        break
      case 'burst': {
        setTab('metricas')
        setBusy(true)
        const reqs = Array.from({ length: 30 }, () => request(randomProject(), null, 1))
        for (let i = 0; i < reqs.length; i += 5) await Promise.all(reqs.slice(i, i + 5).map((r) => submit(r, false)))
        setBusy(false)
        break
      }
    }
  }

  // Lanzar un pipeline no cambia la vista. Mientras se mira "en vivo", la explicación queda en pausa
  // (para no perderse pasos) y sigue desde donde estaba al volver a "Explicar un pedido".
  useEffect(() => {
    player.setPlaying(view === 'explain')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, story?.key])

  // Simulado, "un worker se cae": cuando el pipeline llega a la etapa test, se tira su worker.
  useEffect(() => {
    if (!sim || !killTarget.current) return
    const job = snap.jobs.find((j) => j.job_id === killTarget.current)
    if (job?.status === 'running' && job.current_stage === 'test') {
      const slot = sim.slotOfJob(job.job_id)
      killTarget.current = null
      if (slot !== null) window.setTimeout(() => sim.killWorker(slot), 700)
    }
  }, [snap, sim])

  // Teclado: flechas para avanzar o volver, espacio para pausar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || view !== 'explain') return
      if (e.key === 'ArrowRight') player.next()
      else if (e.key === 'ArrowLeft') player.prev()
      else if (e.key === ' ' && el.tagName !== 'BUTTON') {
        e.preventDefault()
        player.setPlaying(!player.playing)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player, view])

  const job = snap.jobs.find((j) => j.job_id === selectedJob) ?? null
  const currentStep = story?.steps[cursor] ?? null

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>DeployFlow</h1>
          <p>Demo de mensajería asíncrona y observabilidad distribuida</p>
        </div>
        <div className="top-right">
          <span className={`conn ${mode === 'real' ? (snap.connected ? 'ok' : 'err') : ''}`}>
            {mode === 'real' ? (snap.connected ? 'Conectado al stack' : 'Sin conexión con la API') : apiDown ? 'Sin Docker: simulación en el navegador' : 'Simulación en el navegador'}
          </span>
          <div className="seg" role="group" aria-label="Origen de los datos">
            <button className={mode === 'real' ? 'on' : ''} onClick={() => setMode('real')}>
              Stack real
            </button>
            <button className={mode === 'sim' ? 'on' : ''} onClick={() => setMode('sim')}>
              Simulado
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div className="notice" role="alert">
          {notice}
          <button className="btn tiny" onClick={() => setNotice(null)}>
            Cerrar
          </button>
        </div>
      )}

      <div className="layout">
        <Guide
          active={guideStep}
          onActive={pickGuide}
          isReal={mode === 'real'}
          busy={busy}
          workers={workers}
          run={(k) => void run(k)}
          submit={(r) => {
            setTab('detalle')
            void submit(r, true)
          }}
          setWorkers={sim ? (n) => sim.setWorkers(n) : undefined}
        />

        <main className="main-col">
          <section className="panel stage-panel">
            <header className="panel-head">
              <div className="seg" role="group" aria-label="Vista">
                <button className={view === 'explain' ? 'on' : ''} onClick={() => setView('explain')}>
                  Explicar un pedido
                </button>
                <button className={view === 'live' ? 'on' : ''} onClick={() => setView('live')}>
                  Ver todo en vivo
                </button>
              </div>
              <span className="muted small">Clic en un servicio o panel para ver qué hace</span>
            </header>
            <div className="diagram-wrap">
              {view === 'explain' ? (
                <FlowDiagram
                  mode="explain"
                  story={story}
                  cursor={cursor}
                  stepStart={player.stepStart}
                  travelMs={player.travelMs}
                  snapshot={snap}
                  selectedNode={selectedNode}
                  onNodeClick={(id) => setSelectedNode((c) => (c === id ? null : id))}
                  onJobClick={(id) => setSelectedJob(id)}
                />
              ) : (
                <FlowDiagram
                  mode="live"
                  live={player.live}
                  counters={player.counters}
                  snapshot={snap}
                  selectedNode={selectedNode}
                  onNodeClick={(id) => setSelectedNode((c) => (c === id ? null : id))}
                  onJobClick={(id) => setSelectedJob(id)}
                />
              )}
              {selectedNode && (
                <NodeInfo
                  node={selectedNode}
                  onKill={
                    sim && selectedNode.startsWith('worker-')
                      ? () => {
                          sim.killWorker(Number(selectedNode.slice(7)))
                          setSelectedNode(null)
                        }
                      : undefined
                  }
                  onClose={() => setSelectedNode(null)}
                />
              )}
            </div>
            <ObsPanels
              mode={view}
              backend={backend}
              snapshot={snap}
              story={story}
              cursor={cursor}
              stepStart={player.stepStart}
              travelMs={player.travelMs}
              live={player.live}
              onPanelClick={(id) => setSelectedNode((c) => (c === id ? null : (id as NodeId)))}
            />
            {view === 'explain' ? (
              <Caption
                story={story}
                cursor={cursor}
                playing={player.playing}
                speed={player.speed}
                waiting={player.waiting}
                onPrev={player.prev}
                onNext={player.next}
                onTogglePlay={() => player.setPlaying(!player.playing)}
                onSpeed={player.setSpeed}
                onReplay={player.replay}
                onShowDetail={() => {
                  setTab('detalle')
                  document.getElementById('tabs')?.scrollIntoView({ behavior: 'smooth' })
                }}
              />
            ) : (
              <LivePanel queue={snap.stats?.queue_depth ?? 0} running={snap.stats?.counts.running ?? 0} workers={workers} responses={responses} />
            )}
          </section>

          <section className="panel bottom" id="tabs">
            <nav className="tabs" role="tablist">
              {(
                [
                  ['detalle', 'Qué viaja'],
                  ['traza', 'Traza'],
                  ['pipelines', `Pipelines (${snap.jobs.length})`],
                  ['metricas', 'Métricas'],
                  ['conceptos', 'Conceptos'],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </nav>
            <div className="tab-body">
              {tab === 'detalle' && <Inspector event={view === 'explain' ? currentStep : null} />}
              {tab === 'traza' && <TraceView backend={backend} job={job} />}
              {tab === 'pipelines' && (
                <JobList
                  jobs={snap.jobs}
                  apiMs={apiMs}
                  selectedJob={selectedJob}
                  isReal={mode === 'real'}
                  onSelect={(id) => {
                    setSelectedJob(id)
                    if (player.focusJob(id)) setView('explain')
                    setTab('traza')
                  }}
                />
              )}
              {tab === 'metricas' && <Metrics stats={snap.stats} history={snap.history} isReal={mode === 'real'} />}
              {tab === 'conceptos' && <Concepts />}
            </div>
          </section>
        </main>

        {view === 'explain' ? <StepList story={story} cursor={cursor} onPick={(i) => player.goTo(i)} /> : <ActivityFeed events={player.live} />}
      </div>

      <footer className="foot">
        DeployFlow · TP2 DevOps UTN FRRe 2026 · Grupo 4 ·{' '}
        <a href={links.swagger} target="_blank" rel="noreferrer">
          Swagger
        </a>{' '}
        ·{' '}
        <a href={links.jaeger} target="_blank" rel="noreferrer">
          Jaeger
        </a>{' '}
        ·{' '}
        <a href={links.prometheus} target="_blank" rel="noreferrer">
          Prometheus
        </a>{' '}
        ·{' '}
        <a href={links.rabbit} target="_blank" rel="noreferrer">
          RabbitMQ
        </a>
      </footer>
    </div>
  )
}
