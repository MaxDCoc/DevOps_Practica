import type { StageState, StageStatus } from '../types'

const ICONS: Record<StageStatus, string> = {
  pending: '○',
  running: '◐',
  succeeded: '✓',
  failed: '✕',
}

interface Props {
  stages: StageState[]
}

/** Las tres (o N) etapas del pipeline como chips, con su estado. */
export function StageTrack({ stages }: Props) {
  return (
    <ul className="stage-track" aria-label="Etapas del pipeline">
      {stages.map((stage) => (
        <li key={stage.name} className={`stage-chip is-${stage.status}`} title={stage.error ?? undefined}>
          <span className="stage-icon" aria-hidden="true">
            {ICONS[stage.status]}
          </span>
          <span>{stage.name}</span>
          {stage.duration_s !== null && <span className="stage-time">{stage.duration_s.toFixed(1)}s</span>}
        </li>
      ))}
    </ul>
  )
}
