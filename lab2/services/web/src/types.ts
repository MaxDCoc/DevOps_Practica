/** Tipos del contrato (Anexo A). Si cambia el contrato, cambia acá. */

export const STAGES = ['build', 'test', 'deploy'] as const

export type StageName = (typeof STAGES)[number]
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type StageStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface StageState {
  name: string
  status: StageStatus
  started_at: string | null
  duration_s: number | null
  error: string | null
}

export interface JobState {
  job_id: string
  project: string
  branch: string
  status: JobStatus
  current_stage: string | null
  stages: StageState[]
  attempts: number
  trace_id: string | null
  submitted_at: string
  finished_at: string | null
  error: string | null
}

export interface PipelineList {
  items: JobState[]
}

export interface StatsCounts {
  queued: number
  running: number
  succeeded: number
  failed: number
}

export interface Stats {
  counts: StatsCounts
  queue_depth: number
  workers: number
}

export interface PipelineConfig {
  stages: StageName[]
  stage_seconds: number
  fail_at: StageName | null
}

export interface PipelineRequest {
  project: string
  branch: string
  config: PipelineConfig
}

export interface AcceptedResponse {
  job_id: string
  status: 'queued'
  trace_id: string | null
}

export interface Health {
  status: string
  hostname: string
}
