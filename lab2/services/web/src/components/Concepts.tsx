import { useState } from 'react'

interface Concept {
  id: string
  topic: 'Mensajería' | 'Observabilidad'
  title: string
  short: string
  body: string
  where: string
}

export const CONCEPTS: Concept[] = [
  {
    id: 'async',
    topic: 'Mensajería',
    title: '202 Accepted: responder sin esperar',
    short: 'La API dice «lo recibí» y el trabajo lento sigue en otro lado.',
    body: 'Un pipeline tarda segundos o minutos. Si la API lo ejecutara dentro del pedido HTTP, el cliente quedaría esperando y cada pedido ocuparía un hilo del servidor. Con una cola, la API solo valida, guarda el estado y publica el mensaje: responde en ~200 ms con 202 y un job_id para consultar el avance.',
    where: 'Paso 1 de la demo: comparar «202 en X ms» contra la duración total en la pestaña Pipelines.',
  },
  {
    id: 'exchange',
    topic: 'Mensajería',
    title: 'Exchange, routing key y cola',
    short: 'El productor publica en un exchange; el exchange decide a qué cola va.',
    body: 'La API no publica directo en la cola: publica en el exchange directo «pipelines» con la routing key «pipeline.run», y un binding lo enruta a la cola durable «pipeline.jobs». Así el productor no necesita saber cuántas colas o consumidores hay.',
    where: 'La caja de RabbitMQ en el diagrama: el mensaje entra a la cola pipeline.jobs.',
  },
  {
    id: 'ack',
    topic: 'Mensajería',
    title: 'Ack manual',
    short: 'El mensaje se borra recién cuando el worker confirma que terminó.',
    body: 'El worker confirma (basic.ack) al final del pipeline, no al recibirlo. Si se muere a la mitad, RabbitMQ ve que la conexión se cortó con un mensaje sin confirmar y lo vuelve a poner en la cola (redelivered=true) para otro worker. Garantía: al menos una vez.',
    where: 'Paso 7 del guion: un worker se cae.',
  },
  {
    id: 'prefetch',
    topic: 'Mensajería',
    title: 'prefetch_count = 1',
    short: 'Cada worker tiene como máximo un mensaje sin confirmar.',
    body: 'Sin prefetch, RabbitMQ le empujaría muchos mensajes al primer worker que se conecte. Con prefetch=1 cada worker toma uno, lo termina, lo confirma y recién ahí recibe el siguiente: la carga se reparte de forma justa entre las réplicas.',
    where: 'Paso 5: con 3 workers, cada uno muestra un solo job a la vez.',
  },
  {
    id: 'scale',
    topic: 'Mensajería',
    title: 'Competing consumers (escalar)',
    short: 'Más workers en la misma cola = más trabajos en paralelo.',
    body: 'docker compose up -d --scale worker=3 levanta tres réplicas que consumen de la misma cola. No hay que tocar la API ni configurar nada: la cola reparte. Por eso el worker no publica puertos en el host (si no, las réplicas chocarían).',
    where: 'Paso 5: ráfaga de 30 y mirar la curva de la cola en Métricas.',
  },
  {
    id: 'failures',
    topic: 'Mensajería',
    title: 'Fallo de negocio vs. fallo inesperado',
    short: 'Un test que falla no se reintenta; Redis caído sí.',
    body: 'fail_at: "test" es un fallo de negocio: el job termina failed y el mensaje se confirma. Un error inesperado (una excepción, Redis caído) se reintenta: el mensaje pasa por pipeline.jobs.retry (espera 5 s) hasta MAX_ATTEMPTS=3 y, si sigue fallando, termina en la cola de muertos pipeline.jobs.dead (DLQ).',
    where: 'Paso 4: el ack aparece aunque el pipeline falló.',
  },
  {
    id: 'trace',
    topic: 'Observabilidad',
    title: 'Traza, span y trace_id',
    short: 'Una traza es el árbol de todo lo que pasó por un pedido.',
    body: 'Cada operación (atender el POST, llamar al validador, publicar, procesar, cada etapa) es un span con inicio, duración, atributos y estado. Todos los spans de un pedido comparten el mismo trace_id de 32 hex y cada uno conoce a su padre: así Jaeger arma la cascada.',
    where: 'Pestaña «Traza» o el botón «Abrir en Jaeger».',
  },
  {
    id: 'traceparent',
    topic: 'Observabilidad',
    title: 'traceparent (W3C)',
    short: 'La cabecera que lleva el contexto de un servicio al otro.',
    body: 'Formato: 00-<trace_id>-<span padre>-01. OpenTelemetry la agrega sola a las llamadas HTTP (API → validador). En la cola no hay HTTP: la API la inyecta en los headers del mensaje AMQP y el worker la extrae. Por eso el span del worker queda como hijo del span «publish» de la API, aunque los separen segundos y una cola.',
    where: 'Botón «Ver qué viaja en este paso» en el paso en que la API publica el mensaje.',
  },
  {
    id: 'pushpull',
    topic: 'Observabilidad',
    title: 'Trazas push, métricas pull',
    short: 'Los servicios mandan spans a Jaeger; Prometheus va a buscar las métricas.',
    body: 'Las trazas se exportan en lotes por OTLP hacia Jaeger (push). Las métricas, en cambio, cada servicio las expone en /metrics y Prometheus las lee cada 5 s (pull, «scrape»). A los workers los encuentra por DNS: cada réplica nueva aparece sola como target.',
    where: 'Pestaña Métricas (Prometheus) y pestaña Traza (Jaeger).',
  },
  {
    id: 'logs',
    topic: 'Observabilidad',
    title: 'Logs JSON correlacionados',
    short: 'Cada línea de log lleva el trace_id y el span_id.',
    body: 'Los logs son una línea JSON con ts, level, service, msg, trace_id, span_id y, si aplica, job_id y stage. Con el trace_id de un span rojo en Jaeger se encuentra el log de error exacto: docker compose logs worker | grep <trace_id>.',
    where: 'Paso 4 del guion: el log de error aparece en el paso en que falla la etapa test.',
  },
  {
    id: 'cardinality',
    topic: 'Observabilidad',
    title: 'Métricas: plantillas, no IDs',
    short: 'route="/pipelines/{job_id}", nunca el UUID.',
    body: 'Cada combinación de labels es una serie distinta en Prometheus. Si se usara el job_id o el trace_id como label habría una serie por pedido (cardinalidad ilimitada). Para un pedido puntual están las trazas; las métricas son para agregados (tasas, p95, conteos).',
    where: 'Pestaña «Métricas», consulta del p95.',
  },
]

export function Concepts() {
  const [open, setOpen] = useState<string | null>('async')
  return (
    <div className="concepts">
      {(['Mensajería', 'Observabilidad'] as const).map((topic) => (
        <div key={topic} className="concept-col">
          <h3>{topic}</h3>
          {CONCEPTS.filter((c) => c.topic === topic).map((c) => (
            <article key={c.id} className={`concept ${open === c.id ? 'open' : ''}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
              <h4>{c.title}</h4>
              <p className="concept-short">{c.short}</p>
              {open === c.id && (
                <>
                  <p>{c.body}</p>
                  <p className="where">Dónde verlo: {c.where}</p>
                </>
              )}
            </article>
          ))}
        </div>
      ))}
    </div>
  )
}
