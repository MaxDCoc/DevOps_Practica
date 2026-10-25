import { PROMETHEUS_URL, RABBITMQ_URL } from '../api'
import type { Stats } from '../types'

interface Props {
  stats: Stats | null
  lastUpdate: Date | null
}

const CARDS = [
  { key: 'queued', label: 'En cola' },
  { key: 'running', label: 'Corriendo' },
  { key: 'succeeded', label: 'OK' },
  { key: 'failed', label: 'Fallidos' },
] as const

export function StatsPanel({ stats, lastUpdate }: Props) {
  return (
    <section className="panel stats-panel" aria-labelledby="stats-title">
      <div className="panel-head">
        <h2 id="stats-title">Estado del sistema</h2>
        <span className="muted">
          {lastUpdate ? `actualizado ${lastUpdate.toLocaleTimeString('es-AR')}` : 'consultando…'}
        </span>
      </div>

      <div className="stats-grid">
        {CARDS.map((card) => (
          <div key={card.key} className={`stat is-${card.key}`}>
            <span className="stat-value">{stats ? stats.counts[card.key] : '—'}</span>
            <span className="stat-label">{card.label}</span>
          </div>
        ))}
      </div>

      <div className="stats-extra">
        <div>
          <span className="stat-label">Cola</span>
          <strong>{stats ? stats.queue_depth : '—'}</strong> pendientes
        </div>
        <div>
          <span className="stat-label">Workers vivos</span>
          <strong>{stats ? stats.workers : '—'}</strong>
        </div>
      </div>

      <div className="links">
        <a href={PROMETHEUS_URL} target="_blank" rel="noreferrer">
          Prometheus
        </a>
        <a href={RABBITMQ_URL} target="_blank" rel="noreferrer">
          RabbitMQ
        </a>
      </div>
    </section>
  )
}
