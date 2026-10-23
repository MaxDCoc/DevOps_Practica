# Proyecto: DeployFlow — mini plataforma CI/CD simulada

TP2 de DevOps — UTN FRRe 2026. Grupo 4: temas **4 (Observabilidad)** y **10 (Mensajería)**.
Entrega: ⚠ **fecha pendiente** (ver más abajo).

Este archivo es la fuente única del **contrato** entre las 4 partes. El backlog con casillas está
en [`PLAN.md`](PLAN.md) y la guía en palabras simples en
[`docs/DeployFlow_guia_del_equipo.pdf`](docs/DeployFlow_guia_del_equipo.pdf).

## Qué estamos construyendo

Una API recibe "ejecutá este pipeline", otra API lo valida, el trabajo se encola en RabbitMQ y un
worker simula build → test → deploy con demoras. La plataforma CI/CD es el vehículo, no el objetivo:
el TP existe para demostrar **mensajería asíncrona** y **observabilidad distribuida**. Ante cualquier
duda de prioridades, gana lo que se ve en la demo de 5 pasos (Fase 5 de `PLAN.md`).

## ⚠ Consigna oficial: pendiente de pegar

No tenemos el texto oficial del TP2, ni la rúbrica ni la fecha. **Pegarlos acá** apenas se consigan y
revisar este contrato contra ellos antes de seguir: si la consigna pide algo distinto, se cambia acá primero.

Lo que sí sabemos de los dos temas asignados:

| Tema | Pregunta | Demostración esperada |
|---|---|---|
| 4 · Observabilidad | ¿Cómo seguir una solicitud que atraviesa varios servicios? | Propagar un identificador de traza/correlación por dos APIs y visualizar la traza completa, con tiempos y errores |
| 10 · Mensajería | ¿Cómo desacoplar una tarea lenta del camino principal de una solicitud? | Una API publica un trabajo, un consumidor lo procesa con demora y la API responde sin esperar |

## Stack y puertos

| Pieza | Tecnología | Puerto en el host |
|---|---|---|
| API principal (`api`) | Python 3.12 + FastAPI | 8000 |
| Validador (`validator`) | Python 3.12 + FastAPI | 8001 (solo Swagger) |
| Worker (`worker`) | Python 3.12 + Pika | **ninguno** (si publicara un puerto, `--scale worker=3` chocaría) |
| Cola | RabbitMQ 4.3 con consola de administración | 5672 (AMQP), 15672 (consola) |
| Estado | Redis 7 | 6379 |
| Trazas | OpenTelemetry → Jaeger 2 | 16686 (UI), 4317/4318 (OTLP) |
| Métricas | Prometheus 3 | 9090 |
| Dashboard (🟡) | React + Vite servido por nginx | 3000 |
| Todo junto | Docker Compose | — |

Dentro de la red de compose los servicios de Python escuchan en `:8000`.

```
Navegador ─► web :3000 ──/api──┐
Swagger / curl ────────────────┤
                               ▼
                          api :8000 ──HTTP──► validator
                           │     │
                  estado   │     │ publica (con traceparent)
                           ▼     ▼
                        redis   rabbitmq ──► worker ×N ──► redis
   api, validator, worker ── OTLP ──► jaeger      prometheus ◄── scrape: api, validator, worker, rabbitmq
```

## Contrato de la API principal (`api`, :8000)

```
POST /pipelines              body: PipelineRequest
     202 → AcceptedResponse   { job_id, status:"queued", trace_id }   + cabecera Location: /pipelines/{id}
     422 → ValidationErrorResponse { detail:{ errors:[...] } }        el validador rechazó el pedido
     503                                                              falla el validador o la cola (el job queda "failed")
GET  /pipelines/{id}         → JobState     (404 si no existe)
GET  /pipelines?limit=20     → PipelineList { items:[JobState] }, el más reciente primero        (🟡)
GET  /stats                  → Stats { counts:{queued,running,succeeded,failed}, queue_depth, workers }   (🟡)
GET  /health                 /metrics
```

**Cuerpo del pedido** (`PipelineRequest`): `{ project, branch="main", config:{ stages=["build","test","deploy"], stage_seconds=3, fail_at=null } }`.

Los modelos son **laxos a propósito**: aceptan cualquier `str`/`int`. Las reglas de negocio son del
validador; si el modelo las aplicara, FastAPI contestaría con su propio 422 y el validador nunca se
consultaría.

**Estados de un job:** `queued → running → succeeded | failed`. **Estados de una etapa:** `pending`,
`running`, `succeeded`, `failed`. Un job que falla en `test` deja `deploy` en `pending`.

Orden de `POST /pipelines`: validar → `JobStore.create` (queued) → `Publisher.publish_job` → `202`.
Si publicar falla, el job queda `failed` y se responde `503`.

## Contrato del validador (`validator`, :8001)

`POST /validate` (mismo cuerpo) → `ValidationResult { valid, errors:[] }`. Responde `200` siempre
para resultados de negocio; `5xx` solo ante fallas de infraestructura.

Reglas: `project` ~ `^[a-z0-9][a-z0-9-]{1,40}$` · `stages` no vacío, subconjunto de build/test/deploy
**en ese orden** · `stage_seconds` entre 1 y 30 · `fail_at` nulo o una de las `stages`. Latencia
artificial `VALIDATOR_LATENCY_MS` (default 150) para que su span se vea en Jaeger.

## Contrato de la cola (RabbitMQ)

- Exchange directo durable `pipelines` (routing key `pipeline.run`) → cola durable `pipeline.jobs`.
- DLX `pipelines.dlx` → cola `pipeline.jobs.dead`. Reintento: cola durable `pipeline.jobs.retry` con TTL de 5 s
  que, al vencer, devuelve el mensaje a `pipelines` (routing key `pipeline.run`). El consumidor publica en ella
  por el exchange por defecto. Los argumentos de una cola no se pueden cambiar una vez creada, por eso los 5 s
  son una constante del contrato (`RETRY_DELAY_MS`) y no una variable de entorno.
- Mensaje persistente, JSON = `JobMessage { job_id, project, branch, config, submitted_at }`.
  `message_id = job_id`. Headers: `traceparent` (W3C) y `x-attempt`.
- Consumidor: **ack manual**, `prefetch_count=1`, y dormir con `connection.sleep()` (no `time.sleep()`: bloquea
  los heartbeats y el mensaje se redelivera solo).
- Un fallo **de negocio** (`fail_at`) termina en `failed` y el mensaje **se confirma** (sin reintento).
- Un fallo **inesperado** (el handler lanza una excepción: Redis caído, un bug) se reintenta hasta `MAX_ATTEMPTS`
  intentos en total (por defecto 3, el primero incluido). Mientras `x-attempt < MAX_ATTEMPTS`, el consumidor
  encola una copia en `pipeline.jobs.retry` con `x-attempt + 1` (mismo `traceparent`; sin los headers `x-death*`
  que agrega el broker) y **recién después** confirma el original: si se corta entre una cosa y la otra queda un
  duplicado, nunca un trabajo perdido. Si no puede encolar el reintento, no confirma el original y RabbitMQ lo
  redelivera. Al agotarse los intentos: nack sin reencolar → `pipeline.jobs.dead`, y el worker deja el job
  `failed` con el error (la etapa que estaba corriendo también queda `failed`). Mientras espera su reintento el
  job sigue `running`.
- Un worker muerto sin ack hace que RabbitMQ redelivere (`redelivered=true`, `x-attempt` no cambia: un crash
  no gasta intentos). Un mensaje que no es JSON válido va directo a la cola de muertos, sin reintento.

## Contrato del estado (Redis)

- `job:{id}` = `JobState` en JSON, TTL 24 h. `jobs:recent` = ZSET por `submitted_at`.
  `worker:{host}` = latido, se renueva cada 5 s y vence a los 15 s.
- La API escribe `queued` **antes** de publicar. El worker llama a `begin_attempt` al empezar cada intento
  (un mensaje redelivered repite el pipeline desde cero) y actualiza etapa por etapa.
- Las reglas de cada transición viven en `common/deployflow_common/transitions.py` (funciones puras):
  `InMemoryJobStore` y el `RedisJobStore` de P2 las comparten, así no pueden divergir.

## Observabilidad

- **Trazas.** `service.name` ∈ {`api`, `validator`, `worker`}. Spans: api `POST /pipelines` (SERVER) →
  `POST` al validador (CLIENT) → validador `POST /validate` (SERVER); api `publish pipeline.jobs` (PRODUCER);
  worker `process pipeline.jobs` (CONSUMER, hijo del contexto extraído del mensaje) → `stage build|test|deploy`
  (INTERNAL). Una etapa fallida hace `record_exception` + status ERROR. Enlace a la traza: `{JAEGER_URL}/trace/{trace_id}`.
  Los spans de la cola (PRODUCER, CONSUMER y las etapas) los crea P2 con la API de OpenTelemetry; P3 aporta
  `setup_telemetry`, `inject_trace_context`, `extract_trace_context` y `current_trace_id`.
- **Métricas** (nombres en `contract.py`): `http_requests_total{method,route,status}`,
  `http_request_duration_seconds`, `pipelines_submitted_total{result}`, `pipeline_jobs_total{status}`,
  `pipeline_job_duration_seconds`, `pipeline_stage_duration_seconds{stage}`, `pipeline_stage_failures_total{stage}`,
  `worker_jobs_in_progress`, `worker_messages_redelivered_total`. `route` es la **plantilla**, no la URL cruda.
  Las de la cola salen del plugin `rabbitmq_prometheus` (el endpoint por defecto es agregado; el detalle por cola
  está en `/metrics/detailed`).
- **Logs.** Una línea JSON: `{ts, level, service, logger, msg, trace_id, span_id, job_id?, stage?, error?}`.

## Variables de entorno e interruptores

Todas están en [`.env.example`](.env.example). Los **interruptores** (`common/deployflow_common/factory.py`)
permiten desarrollar una parte sola y enchufar lo real después, sin tocar código:

| Variable | Valores | Por defecto | Para desarrollar solo |
|---|---|---|---|
| `STATE_BACKEND` | `memory` · `redis` | `redis` | `memory` |
| `PUBLISHER` | `fake` · `rabbit` | `rabbit` | `fake` |
| `TELEMETRY` | `on` · `off` | `on` | `off` |

Un valor desconocido **falla** con un `ValueError` (no cae en silencio en otro backend). Con `redis` o `rabbit`
hace falta tener Redis y RabbitMQ levantados (`docker compose up -d`).

`MAX_ATTEMPTS` (por defecto 3) lo lee el worker al arrancar: son los intentos **totales** por trabajo, el primero
incluido (`1` = sin reintentos). Un valor que no sea un entero ≥ 1 corta el arranque con un error claro.

## Librería compartida `common/` (`deployflow_common`)

| Módulo | Qué es | Dueño |
|---|---|---|
| `contract.py` | Constantes (colas, claves, métricas, spans, env) y modelos pydantic | Hito 0 (congelado) |
| `transitions.py` | `begin_attempt`, `apply_stage_update`, `apply_finish` (funciones puras) | Hito 0 (congelado) |
| `interfaces.py` | Protocolos `JobStore` y `Publisher`, y `PublishError` | Hito 0 (congelado) |
| `fakes.py`, `factory.py` | `InMemoryJobStore`, `FakePublisher` y los interruptores | Hito 0 (congelado) |
| `messaging.py` | `RabbitPublisher`, `declare_topology`, `Consumer`, `Delivery` | **P2** |
| `retry.py` | Reglas del reintento: `attempt_of`, `retry_headers`, `max_attempts_from_env` | **P2** |
| `state.py` | `RedisJobStore` | **P2** |
| `observability.py`, `logging.py`, `metrics.py` | Trazas, logs JSON y métricas | **P3** |

`observability`, `logging` y `metrics` hoy son *stubs* que no hacen nada con la firma final: P1 y P2 ya
pueden llamarlos (los reemplaza P3). `messaging` y `state` ya están implementados por P2 y probados contra
RabbitMQ y Redis reales: `RabbitPublisher`, `Consumer` y `Delivery` (cola) y `RedisJobStore` (estado).

**Tests que cumplir.** `tests/store_contract.py` es la suite de contrato de cualquier `JobStore`: P2 la
corre contra `RedisJobStore` (una subclase con una fixture `store`) y tiene que pasar igual que con memoria.
`tests/test_interface_contracts.py` fija lo que P3 tiene que seguir cumpliendo al reemplazar los stubs.
`tests/test_examples.py` valida cada JSON de `docs/contract-examples/` contra su modelo.

## Estructura y dueños de archivos

```
lab2/
  AGENTS.md  PLAN.md  .env.example  requirements-dev.txt        ← Hito 0
  common/                       librería compartida (ver tabla de arriba)
  docs/contract-examples/       un JSON de ejemplo por respuesta                  ← Hito 0
  services/api/  services/validator/                                           ← P1
  services/worker/                                                             ← P2
  services/web/                                                                ← P4 (🟡)
  observability/                prometheus.yml, Jaeger, queries.md               ← P3
  docker-compose.yml  scripts/  README.md  COLOQUIO.md                         ← P4
  tests/e2e/  .github/workflows/lab2-ci.yml                                    ← P1 (al final)
```

Nadie edita archivos de otra parte. Los cambios al contrato (un campo, el nombre de una cola o de una
métrica) van en un PR chico que se mergea primero y se avisa a todos.

## Cómo trabajar

Entorno (un solo venv para todas las partes; Python 3.12 o superior):

```bash
cd lab2
python -m venv .venv
.venv/Scripts/activate            # Windows (PowerShell: .venv\Scripts\Activate.ps1)  |  source .venv/bin/activate
pip install -r requirements-dev.txt
cd common && pytest               # los tests de la librería compartida
```

Infraestructura para desarrollar (sin los servicios de la aplicación):

```bash
docker compose up -d              # RabbitMQ, Redis, Jaeger y Prometheus
docker compose ps                 # esperar a que estén "healthy"
docker compose down               # al terminar (agregar -v para borrar los datos)
```

Desarrollo de una parte sola: exportar `STATE_BACKEND=memory PUBLISHER=fake TELEMETRY=off`.

## Reglas de git

- Una rama por parte, todas desde el Hito 0: `lab2/p1-apis`, `lab2/p2-worker`, `lab2/p3-observabilidad`,
  `lab2/p4-front-plataforma`. PR chico a `main` cada vez que algo funcione; `main` siempre con los tests en verde.
- `git pull --rebase origin main` antes de empezar cada día.
- Mensajes de commit tipo `feat(lab2): validador con las reglas de etapas`.
- Agregar solo rutas de `lab2/` (`git add lab2/...`). No subir `.env`.
- Dependencias nuevas: al `requirements.txt` del propio servicio (las de `common/pyproject.toml` están fijadas).

## Notas de lab1 que aplican acá

- En los healthchecks de compose usar **`127.0.0.1`, no `localhost`**: dentro del contenedor `localhost` resuelve
  primero a IPv6, el servidor escucha solo en IPv4, el contenedor queda `unhealthy` y deja de recibir tráfico.
- `.gitattributes` fuerza finales de línea LF: sin eso, en Windows los scripts y Dockerfiles llegan con CRLF y
  fallan dentro de los contenedores Linux.

## Alcance

Fuera: autenticación, despliegues reales, frontend más allá de un pantallazo, Grafana/Loki. Si falta tiempo,
el dashboard es lo primero que se recorta: Swagger lo reemplaza en la demo.
