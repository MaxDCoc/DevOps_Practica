# Consultas de la demo — P3

Prometheus: <http://localhost:9090/query> · Jaeger: <http://localhost:16686>.
Ventanas de 1 minuto: esperar al menos dos scrapes (cada 5 s). Sin muestras o sin
tráfico es normal que `rate`/p95 no tengan resultado. Los contadores se reinician
cuando se recrea un contenedor; `rate` contempla esos reinicios.

## Servicios y escalado

```promql
# Un resultado por instancia; 1 = responde al scrape, 0 = no responde.
up{job=~"api|validator|worker|rabbitmq|rabbitmq-queues"}

# Workers realmente sanos. count(up) también cuenta los que están DOWN.
sum(up{job="worker"}) or vector(0)

# Targets descubiertos, sanos o no (comparar con la consulta anterior).
count(up{job="worker"}) or vector(0)

# Jobs ejecutándose ahora entre todas las réplicas.
sum(worker_jobs_in_progress)
```

La consulta cuenta endpoints scrapeables, no consumidores conectados. Para ver
consumidores efectivos de RabbitMQ:

```promql
sum(rabbitmq_detailed_queue_consumers{job="rabbitmq-queues",queue="pipeline.jobs",vhost="/"})
```

## Cola y throughput

```promql
# Pendientes de entregar (no incluye los que el worker ya tomó).
sum(rabbitmq_detailed_queue_messages_ready{job="rabbitmq-queues",queue="pipeline.jobs",vhost="/"})

# En curso sin ack.
sum(rabbitmq_detailed_queue_messages_unacked{job="rabbitmq-queues",queue="pipeline.jobs",vhost="/"})

# Jobs terminados por segundo, separados por resultado.
sum by (status) (rate(pipeline_jobs_total[1m]))

# Mensajes redelivered por caída de un consumidor.
sum(worker_messages_redelivered_total)
```

El prefijo `rabbitmq_detailed_` pertenece a `/metrics/detailed`, configurado en el
job `rabbitmq-queues`; `/metrics` por defecto no ofrece el detalle por cola.

## Fallos de pipelines

```promql
# Contador visible al provocar fail_at: test.
sum(pipeline_jobs_total{status="failed"})

# Fallos de etapas, por etapa.
sum by (stage) (pipeline_stage_failures_total)

# Porcentaje de ejecuciones fallidas (negocio o inesperadas).
100 *
(sum(rate(pipeline_jobs_total{status=~"failed|errored"}[1m])) or vector(0))
/
clamp_min(sum(rate(pipeline_jobs_total{status=~"succeeded|failed|errored"}[1m])), 0.000001)
```

Si nunca ocurrió un fallo, la serie con ese label puede no existir todavía. El
worker no cuenta duplicados/jobs vencidos como ejecuciones. Un fallo controlado
termina con ack; no es un fallo de entrega del mensaje.

## HTTP y latencias

```promql
# Peticiones de la API por segundo, por plantilla y status.
sum by (method, route, status) (rate(http_requests_total{job="api"}[1m]))

# Porcentaje de respuestas HTTP 5xx de la API.
100 *
(sum(rate(http_requests_total{job="api",status=~"5.."}[1m])) or vector(0))
/
clamp_min(sum(rate(http_requests_total{job="api"}[1m])), 0.000001)

# p95 HTTP de POST /pipelines, en segundos.
histogram_quantile(0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket{job="api",method="POST",route="/pipelines"}[1m]))
)

# p95 de pipeline completo, incluyendo espera en la cola.
histogram_quantile(0.95,
  sum by (le) (rate(pipeline_job_duration_seconds_bucket[1m]))
)

# p95 por etapa de ejecución.
histogram_quantile(0.95,
  sum by (le, stage) (rate(pipeline_stage_duration_seconds_bucket[1m]))
)

# Pedidos aceptados, rechazados o con error al enviar.
sum by (result) (pipelines_submitted_total{job="api"})
```

`route` es la plantilla (`/pipelines/{job_id}`), nunca el UUID. Las rutas que no
existen usan `__unmatched__`. `/health` y `/metrics` no generan métricas HTTP ni
spans de servidor, para que los scrapes no contaminen la demo. Un `202` no indica
que el pipeline terminó bien: los fallos posteriores aparecen en las métricas
del worker, no como 5xx del POST original.

## Jaeger: seguir un pedido

1. Ejecutar `POST /pipelines` desde <http://localhost:8000/docs>.
2. Copiar el `trace_id` de la respuesta y abrir:
   `http://localhost:16686/trace/<trace_id>`.
3. Una sola traza debe incluir:
   - `api`: `POST /pipelines` (SERVER), `POST` al validador (CLIENT),
     `publish pipeline.jobs` (PRODUCER).
   - `validator`: `POST /validate` (SERVER).
   - `worker`: `process pipeline.jobs` (CONSUMER) y `stage build`, `stage test`,
     `stage deploy` (INTERNAL).
4. Con `fail_at: "test"`, `stage test` aparece con status ERROR y evento
   `exception`. `stage deploy` no se ejecuta.

También se puede buscar por **Service** `api`, **Operation** `POST /pipelines`;
o por **Service** `worker`, **Operation** `stage test` y **Tags** `error=true`.
Para un job particular: servicio `worker`, tag `job.id=<job_id>`.
El enlace usa la URL de Jaeger accesible desde el navegador, no `http://jaeger`.
La API de consulta permite validar automáticamente:
`GET http://localhost:16686/api/traces/<trace_id>`.

## Correlación con logs

Con el compose complementario local (desde `lab2/`):

```bash
docker compose -f docker-compose.yml -f observability/compose.local.yml logs --no-log-prefix worker
```

Buscar el `trace_id` del POST. El fallo produce una línea JSON con `level=error`,
`service=worker`, `job_id`, `stage=test`, `error`, `trace_id` y `span_id` de la
etapa fallida. Fuera de una traza, los identificadores son `null`. No se agregan
trace_id/job_id como labels de Prometheus: tendrían cardinalidad ilimitada.
