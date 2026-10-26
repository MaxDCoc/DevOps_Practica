import { links } from '../util'

const INFO: Record<string, { title: string; what: string; detail: string; link?: { href: string; label: string } }> = {
  browser: {
    title: 'Navegador (este dashboard)',
    what: 'El cliente. Manda POST /pipelines y después consulta el estado del pipeline cada medio segundo.',
    detail: 'En la versión con Docker, nginx sirve este front y hace de proxy de /api hacia la API y de /jaeger hacia Jaeger.',
  },
  api: {
    title: 'API principal (FastAPI)',
    what: 'Recibe el pedido, lo valida contra el validador, guarda el estado en Redis, publica en RabbitMQ y responde 202.',
    detail: 'Endpoints def (no async) porque pika es bloqueante. Crea los spans SERVER, CLIENT y PRODUCER, y expone /metrics.',
    link: { href: links.swagger, label: 'Abrir Swagger' },
  },
  validator: {
    title: 'Validador (FastAPI)',
    what: 'Aplica las reglas de negocio: project, orden de las etapas, stage_seconds entre 1 y 30, fail_at.',
    detail: 'Siempre responde 200 con valid true/false. Tiene ~150 ms de latencia artificial para que su span se vea en Jaeger.',
  },
  rabbit: {
    title: 'RabbitMQ',
    what: 'El broker. Exchange directo «pipelines» → cola durable «pipeline.jobs». Además: pipeline.jobs.retry (espera 5 s) y pipeline.jobs.dead (DLQ).',
    detail: 'Guarda los mensajes hasta que un worker los confirma. Si un consumidor se cae sin ack, re-entrega el mensaje.',
    link: { href: links.rabbit, label: 'Abrir la consola (deployflow / deployflow)' },
  },
  redis: {
    title: 'Redis',
    what: 'El estado de cada job: job:{id} en JSON con TTL de 24 h, jobs:recent (ZSET) y el latido de cada worker.',
    detail: 'La API escribe «queued» antes de publicar; el worker actualiza etapa por etapa. GET /pipelines/{id} lee de acá.',
  },
  jaeger: {
    title: 'Jaeger',
    what: 'Recibe los spans por OTLP (push) y los arma en trazas por trace_id.',
    detail: 'Buscar por servicio «worker», operación «stage test» y tag error=true para encontrar los fallos.',
    link: { href: links.jaeger, label: 'Abrir Jaeger' },
  },
  prometheus: {
    title: 'Prometheus',
    what: 'Lee /metrics de api, validator, cada worker y RabbitMQ cada 5 s (pull).',
    detail: 'A los workers los descubre por DNS: con --scale worker=3 aparecen 3 targets solos.',
    link: { href: `${links.prometheus}/targets`, label: 'Ver targets' },
  },
  logs: {
    title: 'Logs JSON',
    what: 'Cada servicio escribe una línea JSON por evento, con el trace_id y el span_id del momento.',
    detail: 'Con el trace_id de un span rojo en Jaeger se encuentra el log exacto del error: docker compose logs worker | grep <trace_id>. Este panel muestra los eventos principales de cada pedido.',
  },
  stage: {
    title: 'Etapa del pipeline',
    what: 'build, test y deploy corren dentro del worker, una después de la otra. No son servicios aparte.',
    detail: 'Cada etapa es un span INTERNAL hijo de «process pipeline.jobs». Si una falla, las siguientes no se ejecutan (quedan tachadas).',
  },
  worker: {
    title: 'Worker (Pika)',
    what: 'Consume de pipeline.jobs con ack manual y prefetch_count=1. Simula build → test → deploy con demoras.',
    detail: 'Extrae el traceparent del mensaje, abre el span CONSUMER y uno por etapa. Duerme con connection.sleep() para no perder los heartbeats. Con SIGTERM termina el job en curso antes de salir.',
  },
}

interface Props {
  node: string
  onKill?: () => void
  onClose: () => void
}

export function NodeInfo({ node, onKill, onClose }: Props) {
  const key = node.startsWith('worker-') ? 'worker' : node.startsWith('stage-') ? 'stage' : node
  const info = INFO[key]
  return (
    <div className="node-info">
      <button className="close" onClick={onClose} aria-label="Cerrar">
        Cerrar
      </button>
      <h3>
        {info.title}
      </h3>
      <p>{info.what}</p>
      <p className="muted">{info.detail}</p>
      <div className="actions">
        {info.link && (
          <a className="btn small" href={info.link.href} target="_blank" rel="noreferrer">
            {info.link.label}
          </a>
        )}
        {onKill && (
          <button className="btn small danger" onClick={onKill}>
            Tirar este worker (como docker kill)
          </button>
        )}
      </div>
    </div>
  )
}
