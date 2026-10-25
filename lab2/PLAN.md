# Plan de desarrollo — DeployFlow (TP2 DevOps)

## Qué es este proyecto

TP2 de DevOps (UTN FRRe 2026), Grupo 4, temas **4 (Observabilidad)** y **10
(Mensajería)**. DeployFlow es una mini plataforma CI/CD *simulada*: una API
recibe "ejecutá este pipeline", otra API lo valida, el trabajo se encola en
RabbitMQ y un worker simula build → test → deploy con demoras. Todo se ve en
Jaeger (trazas), Prometheus (métricas) y los logs JSON.

La plataforma CI/CD es el vehículo, no el objetivo real: el TP existe para
demostrar **mensajería asíncrona** (la API responde `202` sin esperar) y
**observabilidad distribuida** (un `trace_id` que cruza API → validación →
cola → worker). Ante cualquier duda de prioridades, gana lo que se ve en la
demo de 5 pasos (ver Fase 5).

Guía del equipo en palabras simples, con el contrato resumido en el Anexo A:
[`docs/DeployFlow_guia_del_equipo.pdf`](docs/DeployFlow_guia_del_equipo.pdf).
El contrato completo va a vivir en `AGENTS.md` (se crea en la Fase 0).

## Cómo usar este archivo

1. **Cada uno edita solo su sección** (P1, P2, P3, P4) para no chocar en este
   archivo. Las fases 0, 2, 3, 4 y 5 las edita quien las lidera (figura en el
   título).
2. Tildá `- [ ]` → `- [x]` cuando algo **ande de verdad**, no cuando lo
   escribiste.
3. Poné tu nombre en **Responsable** de tu parte.
4. Al cerrar una fase o una parte, cambiá el emoji del título (🔲 pendiente ·
   🔶 en curso · ✅ completa) y agregá una línea **Verificado:** con cómo lo
   probaste (comando, URL o captura).
5. Si encontrás un problema y lo resolvés, dejá una **Nota de
   troubleshooting** como en lab1: sirve para el informe y el coloquio.
6. Si aparece algo nuevo, agregalo en la fase que corresponda con su emoji de
   prioridad.
7. Dejá una línea en la **Bitácora** del final cada vez que subas algo.
8. PR chico a `main` cada vez que algo funcione. `main` siempre con los tests
   en verde. `git pull --rebase origin main` antes de arrancar cada día.

**Prioridad de cada tarea:** 🔴 imprescindible para terminar hoy · 🟡 si queda
tiempo · ⚪ extra.

## Camino de hoy (si hay que terminar en el día)

| Bloque | Qué se hace | Quién | Estimado* |
|---|---|---|---|
| 0 | **Fase 0**: contrato y esqueleto | 1 persona. Los otros 3 leen la guía, instalan Docker/Python/Node y revisan el Anexo A | ~45 min |
| 1 | **Fase 1**, solo las tareas 🔴 de cada parte | Los 4 en paralelo | 2–3 h |
| 2 | **Fase 2** (API ↔ cola ↔ worker) y **Fase 3** (observabilidad) | P2 + P1, después P3 | ~1,5 h |
| 3 | **Fase 4** (compose completo) y **Fase 5** (demo y entrega) | P4 lidera, todos ayudan | ~1,5 h |

\* Estimación, sin medir: unas 6 h corridas con 4 personas.

**Se deja afuera hoy (🟡/⚪):** el dashboard React, `GET /pipelines` y
`/stats`, reintentos + DLQ, tests e2e y CI propio, `COLOQUIO.md` y diapositivas.
El dashboard es lo primero que se recorta: **Swagger lo reemplaza** en la demo.

**Si somos menos de 4**, el orden es P2 → P1 → P3 → P4-liviano. Con eso ya hay
mensajería funcionando (P2 + P1), después se suma la observabilidad (P3) y por
último el compose completo y el script de demo (P4 sin dashboard).

## Reparto

| Parte | Responsable | Carpetas propias | Puede arrancar YA con |
|---|---|---|---|
| **P1 — API** | MaxDCoc | `services/api/`, `services/validator/` | Las reglas del validador como funciones puras con tests |
| **P2 — Mensajería** | MaxDCoc | `services/worker/`, `common/.../messaging.py`, `state.py` | El ejecutor de etapas con tests; RabbitMQ y Redis con compose |
| **P3 — Observabilidad** | ________ | `common/.../observability.py`, `logging.py`, `metrics.py`, `observability/` | El formateador de logs JSON y el test de `inject`/`extract` |
| **P4 — Plataforma** (+ front 🟡) | ________ | `docker-compose.yml`, `scripts/`, `README.md`, `services/web/` | El compose de infraestructura (y los mocks del front, si hay dashboard) |

**Reglas para no pisarse:** nadie edita archivos de otra parte; los cambios al
contrato van en un PR chico que se mergea primero; `docker-compose.yml` lo toca
solo P4; las dependencias nuevas van al `requirements.txt` del propio servicio.
Agregar a git **solo rutas de `lab2/`** (hay un cambio sin commitear en
`lab1/COLOQUIO.md` que no es de este trabajo) y commits con el usuario de
cada uno, sin `Co-Authored-By` de Claude.

## Cómo se acopla todo sin esperarse

Cada parte trabaja contra una versión de mentira de sus vecinos y después se
enchufa lo real cambiando una variable, sin tocar código:

| Interruptor | Valores | Quién lo usa |
|---|---|---|
| `STATE_BACKEND` | `memory` (dev/tests) · `redis` (real) | P1, P2 |
| `PUBLISHER` | `fake` (dev/tests) · `rabbit` (real) | P1 |
| `TELEMETRY` | `off` (dev/tests) · `on` (real) | P1, P2, P3 |

Escalones: **N0** contrato (Fase 0) → **N1** cada parte sola con dobles (Fase 1)
→ **N2** API ↔ cola ↔ worker reales (Fase 2) → **N3** observabilidad encendida
(Fase 3) → **N4** todo junto en compose (Fase 4).

## Fase 0 — Contrato y esqueleto (N0) ✅ (verificado; falta el PR a `main` y el tag)

**Lidera:** MaxDCoc · Es lo único secuencial: hasta que no esté en `main`, las
ramas de las 4 partes no salen.

- [x] 🔴 Rama `lab2/hito0-contrato` desde `main` (creada en local, todavía sin commits)
- [x] 🔴 `lab2/.gitignore` (`__pycache__`, `.venv`, `.env`, `.pytest_cache`,
      `node_modules`, `dist`) y `lab2/.gitattributes` (`* text=auto eol=lf`):
      la raíz del repo no tiene ninguno y con CRLF se rompen los scripts
      dentro de los contenedores
- [x] 🔴 `AGENTS.md` con los requisitos y el contrato (HTTP, mensaje AMQP, claves
      de Redis, nombres de métricas, variables de entorno)
- [ ] 🔴 Pegar en `AGENTS.md` la **consigna oficial, la rúbrica y la fecha** (⚠ hay
      que conseguirlas, ver Pendientes) y revisar el contrato contra ellas
- [x] 🔴 `common/` instalable: `pyproject.toml` con **todas** las dependencias
      fijadas + `contract.py` (modelos pydantic y constantes)
- [x] 🔴 Stubs con las firmas finales de `observability.py`, `logging.py`,
      `metrics.py`, `messaging.py`, `state.py` (compilan y no hacen nada) +
      `InMemoryJobStore`, `FakePublisher` y `factory.py` (lee los interruptores)
- [x] 🔴 Carpetas `services/{api,validator,worker}` con su `requirements.txt`
      fijado
- [x] 🔴 `docker-compose.yml` **solo con infraestructura** (rabbitmq, redis,
      jaeger, prometheus) con healthchecks, y `.env.example`
      _Los 4 servicios levantan y quedan healthy. A Jaeger se le agregó el
      healthcheck acá, porque su imagen no trae uno_
- [x] 🔴 Tags de imágenes fijados y verificados (se descargaron con `compose up`):
      `rabbitmq:4.3.7-management`, `redis:7-alpine`, `jaegertracing/jaeger:2.22.0`,
      `prom/prometheus:v3.15.1`. `python:3.12-slim`, `node` y `nginx` los fija cada
      parte con su Dockerfile
- [x] 🟡 `docs/contract-examples/*.json`: una respuesta de ejemplo por endpoint
      (los usan los mocks del front y los tests de la API)
- [ ] 🔴 **Criterio de salida:** `docker compose up -d` deja los 4 servicios
      healthy, `pip install ./common` anda y `pytest` corre (aunque esté
      vacío). PR a `main` + tag `lab2-hito0`
      _Casi: `compose up`, `pip install` y `pytest` andan. Falta el PR a `main`
      y el tag._

**Verificado (22/10):** `pip install -r requirements-dev.txt` sin conflictos
(`pip check` limpio) y 61 tests en verde. Además se hizo una prueba de mutaciones:
se rompió el código a propósito en 15 puntos y los tests detectaron las 15.
`docker compose config` valida la sintaxis del compose.
`docker compose up -d --wait`: los 4 servicios quedan healthy. Con la infra arriba se
comprobó que Jaeger recibe un span por OTLP/HTTP (`:4318`) y lo devuelve por su API,
que `pika` y `redis-py` se conectan con las URLs de desarrollo local de
`.env.example`, que la consola de RabbitMQ responde con `deployflow:deployflow` y que
`rabbitmq_prometheus` **ya viene habilitado** en la imagen y escucha en el `:15692`.

**Nota de troubleshooting (Docker Desktop 4.48 en la máquina de MaxDCoc):** no
arrancó. El log dice `initializing Inference manager: ... remove
...\Docker\run\dockerInference: The file cannot be accessed by the system`. Es un
socket Unix huérfano de 0 bytes (ReparsePoint, del 12/10) que Windows no deja borrar
sin permisos de administrador (`del`, `Remove-Item` y `File.Delete` fallaron).
Para destrabarlo hay que probar, en este orden: reiniciar la PC; actualizar Docker
Desktop; o abrir una consola **como administrador** y borrar
`%LOCALAPPDATA%\Docker\run\dockerInference` (si `del` falla, probar `fsutil
reparsepoint delete` sobre ese archivo y después `del`). **No** usar «Reset to
factory defaults»: borra las imágenes y la configuración.
**Resuelto el mismo día:** Docker Desktop volvió a arrancar después de que MaxDCoc lo
reabrió. No sabemos cuál paso lo destrabó; si vuelve a pasar, probar los de arriba.

## Fase 1 — Cada parte funciona sola (N1) 🔲

Cada uno trabaja en su rama (`lab2/p1-apis`, `lab2/p2-worker`,
`lab2/p3-observabilidad`, `lab2/p4-front-plataforma`) contra sus dobles. Mientras el
PR del Hito 0 no esté mergeado a `main`, las ramas parten de
`origin/lab2/hito0-contrato`.

### P1 — API (principal + validación) ✅ · Responsable: MaxDCoc (con Claude)

**Validador** — `services/validator/`
- [x] 🔴 Reglas como funciones puras + tests: `project` con
      `^[a-z0-9][a-z0-9-]{1,40}$`, `stages` no vacío y en orden
      build/test/deploy, `stage_seconds` entre 1 y 30, `fail_at` nulo o dentro
      de `stages`
- [x] 🔴 `POST /validate` → `{ valid, errors[] }` (siempre `200` para resultados
      de negocio) y `GET /health`
- [x] 🔴 Latencia artificial `VALIDATOR_LATENCY_MS` (default 150) para que su
      span se vea en Jaeger
- [x] 🔴 `Dockerfile` (usuario no root, contexto de build = `lab2/`)

**API principal** — `services/api/`
- [x] 🔴 `POST /pipelines`: validar → `JobStore.create` (queued) →
      `Publisher.publish_job` → `202 { job_id, status, trace_id }`; `422` si el
      validador rechaza; `503` si falla el validador o la cola (y el job queda
      `failed`)
- [x] 🔴 `GET /pipelines/{id}` (404 si no existe) y `GET /health`
- [x] 🔴 Endpoints `def` (no `async`): `pika` es bloqueante
- [x] 🔴 Store y publisher salen de `factory` (interruptores `STATE_BACKEND` y
      `PUBLISHER`)
- [x] 🔴 Swagger con ejemplos clickeables: uno exitoso y otro con
      `fail_at: "test"`
- [x] 🔴 Tests con `TestClient` y los dobles (202, 422, 503, 404)
- [x] 🔴 `Dockerfile`
- [x] 🟡 `GET /pipelines?limit=20` y `GET /stats` (los usa el dashboard)

**Verificado (22/10):** 42 tests del validador y 29 de la API en verde, y una prueba de
mutaciones (25 roturas del código a propósito, las 25 detectadas). Las dos imágenes se
construyen (~290 MB cada una) y, corriendo en una red de Docker con el estado en memoria y
el publisher falso, responden como dice el contrato: `POST /pipelines` → `202` en ~210 ms,
`422` con el mismo cuerpo que `docs/contract-examples/validation-rejected-422.json`,
`GET /pipelines/{id}`, `GET /pipelines`, `GET /stats` y Swagger en `/docs`.
**Pendiente:** probarla con la cola y Redis reales (depende de P2) y con el `trace_id`
real en las respuestas (depende de P3).

**Nota:** con el validador caído `POST /pipelines` responde `503` correctamente, pero tarda
~4 s: probablemente la resolución DNS del nombre `validator` falla lento dentro de Docker
antes de que actúe el timeout de 2 s. Tenerlo en cuenta en la demo y en los healthchecks de
compose (`depends_on: condition: service_healthy`).

### P2 — Mensajería, worker y estado ✅ · Responsable: MaxDCoc (con Claude)

- [x] 🔴 `runner.py` puro con tests: etapas con `sleep` inyectable, `fail_at`,
      `stage_seconds`, actualiza el estado en cada etapa
- [x] 🔴 `declare_topology` idempotente: exchange `pipelines`, cola
      `pipeline.jobs` con DLX, cola `pipeline.jobs.dead`
- [x] 🔴 `Publisher`: confirmaciones del broker y reconexión con backoff
      (RabbitMQ acepta TCP antes de estar listo)
- [x] 🔴 `RedisJobStore`: `create`, `get`, `update_stage`, `finish`, con TTL de
      24 h y transiciones idempotentes
- [x] 🔴 Worker: ack manual y `prefetch_count=1`; `Consumer.stop()` deja terminar el
      job en curso (probado contra RabbitMQ real)
- [x] 🔴 SIGTERM real: `docker stop` a mitad de un job y que termine antes de salir
      (probado en contenedor: tardó 7,0 s, salió con código 0 y el job quedó `succeeded`)
- [x] 🔴 **Dormir con `connection.sleep()`**, no con `time.sleep()`: si no, un
      job largo bloquea los heartbeats y el mensaje se redelivera solo
- [x] 🔴 Servidor HTTP del worker (`/health` y `/metrics` en `:8000`) en un hilo
- [x] 🔴 `tools/publish_sample.py` para probar sin la API _(probado desde el host contra un worker en contenedor)_
- [x] 🔴 `Dockerfile` del worker _(construido y probado en contenedor)_
- [x] 🟡 `Publisher.queue_depth()`, `heartbeat`/`live_workers`, `counts`,
      `list_recent` (los usa `/stats`)
- [x] 🟡 Cola de reintento (`pipeline.jobs.retry`, espera 5 s): un error inesperado del
      handler vuelve a la cola con `x-attempt` + 1 hasta `MAX_ATTEMPTS` (3 por defecto,
      el primero incluido) y recién entonces va a la DLQ, con el job en `failed`
      _(rama `lab2/p2-reintento`, ver «Verificado (reintento)»)_
- [x] 🟡 Un mensaje que no es JSON válido va directo a la DLQ (probado)
- [x] 🔴 **Hecho cuando:** un mensaje de prueba deja el estado
      `queued → running → succeeded` en Redis; `fail_at: test` termina `failed`
      con ack; matar el worker a mitad de un job hace que otro lo termine
      _(verificado de punta a punta en contenedores, ver abajo)_

**Verificado (23/10):** 91 tests en `common`, corridos contra el Redis y el RabbitMQ **reales**
del compose (incluyen la suite de contrato del `JobStore` aplicada a `RedisJobStore`, el
redelivery de un mensaje sin confirmar, la DLQ, un job de 6 s con heartbeat de 2 s y el
`prefetch`), y 18 en el worker. Prueba de mutaciones: se rompió el código a propósito en 28
puntos y los tests detectaron los 28. **Prueba de punta a punta en contenedores (23/10)**, con P1 (el código de `main`) y P2 juntos
sobre la infraestructura de compose y con `TELEMETRY=off`:
- Un pipeline completo: `POST /pipelines` → `202` en 236 ms; el estado pasó por `running` en
  build, test y deploy hasta `succeeded`, con 1 intento y 3,0 s en total.
- La API no se bloquea: con el worker ocupado en un trabajo de 6 s, dos `POST` seguidos
  respondieron `202` en 178 y 170 ms.
- Fallo controlado (`fail_at: test`): quedó `failed` con «falló la etapa test (simulado)»;
  `build` OK, `test` fallida y `deploy` pendiente.
- `publish_sample.py --count 2 --follow` desde el host contra el worker en contenedor: los 2
  pipelines terminaron `succeeded` (código de salida 0).
- `docker stop` a mitad de un job: el worker lo terminó antes de salir (7,0 s, código de salida 0,
  job `succeeded` en 1 intento).
- `docker kill` a mitad de un job: el job quedó `running`, otro worker lo recogió y lo terminó
  (`succeeded`, 2 intentos); la métrica `worker_messages_redelivered_total` de ese worker marcó 1.
- 3 workers: `/stats` mostró `workers: 3`; con 9 pipelines en cola, los 12 de 3 s terminaron en
  12,9 s repartidos 4, 4 y 4. Los ~36 s con un solo worker son el cálculo (12 × 3 s), no una medición.
- El campo `workers` de `/stats` tarda hasta 15 s en notar un worker muerto (es la vida del latido).
- La cola de reintento (🟡) no formaba parte de esta prueba: se hizo después (ver «Verificado (reintento)»).

**Verificado (reintento, 23/10):** 136 tests en `common` (la cola real contra RabbitMQ: la topología,
el reintento con `x-attempt` + 1 y el `traceparent` intacto, el paso a la DLQ al agotar los intentos,
dos vueltas completas por la cola esperando los 5 s reales y un reintento que no se puede encolar sin
perder el mensaje) y 27 en el worker. Prueba de mutaciones: 26 cambios rotos a propósito, 25
detectados; el que sobrevive es equivalente (la guarda `is_finished` de `_give_up` es redundante porque
las transiciones del store ya son idempotentes). Prueba de punta a punta con el worker en un
contenedor y la infraestructura de compose:
- `MAX_ATTEMPTS=abc` y `MAX_ATTEMPTS=0` cortan el arranque con
  `ValueError: MAX_ATTEMPTS tiene que ser un entero mayor o igual a 1…`.
- Un pipeline normal termina `succeeded` en 1 intento y las tres colas quedan vacías.
- Un fallo de negocio (`fail_at: test`) termina `failed` y no pasa por la cola de reintento ni por la
  de muertos.
- Redis caído 12 s con un trabajo en vuelo (`MAX_ATTEMPTS=5`): el worker reintentó 2 veces (cada intento
  tarda unos 3 s en fallar al conectar con Redis, más los 5 s de espera) y el job terminó `succeeded`
  a los 19,1 s, sin nada en la cola de muertos.
- Un error que se repite (una etapa que el job no tiene) con `MAX_ATTEMPTS=3`: tres intentos separados
  por ~6 s (5 s de espera + 1 s de trabajo); el job quedó `failed` a los 13,1 s con «error inesperado en
  el intento 3 de 3: ValueError…» y `attempts=3`, la etapa que ya había terminado sigue `succeeded`, hay
  1 mensaje en `pipeline.jobs.dead` con `x-attempt=3` y `pipeline_jobs_total{status="errored"}` marca 3.

Lo que conviene saber (decisiones de diseño):
- Mientras espera su reintento el job sigue `running` (no vuelve a `queued`): el contrato no tiene una
  transición para eso.
- Si el estado tampoco responde al agotar los intentos (Redis caído), el mensaje igual va a la cola de
  muertos pero el job no se puede cerrar como `failed`: queda como estaba hasta que venza en Redis.
- Un worker que muere sin confirmar no gasta intentos (el mensaje vuelve con el mismo `x-attempt`).
- No se agregó ninguna métrica: `pipeline_jobs_total{status="errored"}` ya cuenta cada intento fallido.

**Nota para P3** (qué quedó hecho en P2 y qué no hay que repetir):
- Los spans de la cola los crea P2 con la API de OpenTelemetry (`opentelemetry.trace`), sin
  esperar a P3: `publish pipeline.jobs` (PRODUCER, en `common/.../messaging.py`) y, en el
  worker, `process pipeline.jobs` (CONSUMER) con un hijo `stage <nombre>` por etapa
  (`services/worker/app/`). Sin SDK configurado son no-ops; apenas P3 configure el
  `TracerProvider` aparecen solos.
- P3 solo tiene que implementar `inject_trace_context` y `extract_trace_context` (el publisher
  llama a la primera dentro del span PRODUCER; el worker llama a la segunda con los headers del
  mensaje y usa ese contexto como padre del span CONSUMER), además de `setup_telemetry`,
  `current_trace_id`, los logs y las métricas HTTP de la API y el validador.
- Las métricas del worker (`pipeline_jobs_total`, `pipeline_stage_duration_seconds`, etc.) ya las
  define y publica el propio worker en `services/worker/app/metrics.py`.
- El worker sirve `/health` y `/metrics` con su propio servidor
  (`services/worker/app/http_server.py`): `start_metrics_server` no hace falta para el worker.

### P3 — Observabilidad ✅ (mergeada a `main` en el PR #3) · Responsable: ________

- [x] 🔴 `setup_logging`: una línea JSON con `ts, level, service, logger, msg,
      trace_id, span_id` + extras y excepciones; tests de correlación e idempotencia
- [x] 🔴 `setup_telemetry`: Resource, TracerProvider, `BatchSpanProcessor` + OTLP
      gRPC a Jaeger; `shutdown_telemetry` con flush; respeta `TELEMETRY=off`
- [x] 🔴 `inject_trace_context` / `extract_trace_context` sobre los headers AMQP
      (coerción bytes↔str) + tests de contexto válido, ausente e inválido
- [x] 🔴 Spans PRODUCER y CONSUMER con atributos `messaging.*`: se reutilizan los
      de P2, sin agregar helpers duplicados; validada la cadena de padres en Jaeger
- [x] 🔴 `instrument_fastapi`: spans de FastAPI y `httpx`, métricas HTTP con
      `route` por **plantilla** (404 agrupados) y `/metrics`
- [x] 🔴 `start_metrics_server` implementado como helper del contrato, pero no
      se llama desde el worker: P2 ya sirve `/health` y `/metrics`
- [x] 🔴 `observability/prometheus/prometheus.yml`: intervalos de 5 s, api y
      validator estáticos, worker con DNS A y puerto 8000, RabbitMQ `:15692` y
      `/metrics/detailed` para detalle por cola; validado con `promtool`
- [x] 🔴 `observability/queries.md`: PromQL y búsquedas Jaeger para la demo;
      `sum(up{job="worker"})` cuenta sanos, `count(up)` cuenta targets totales
- [ ] 🟡 Regla de alerta por tasa de fallos
- [ ] ⚪ Grafana / Loki
- [x] 🔴 **Hecho cuando:** los tests pasan y Jaeger y Prometheus levantan con la
      configuración; integración local validada con 1 y 3 workers

**Verificado (23/10, local):** 114 tests en `common`, 29 de API, 42 del validador y
19 del worker (204 en total), con RabbitMQ y Redis reales disponibles. Cinco tests
opt-in en `observability/check_local.py` verifican traza completa, padres, fallo,
logs correlacionados, targets UP, contador de fallos y detalle de cola. Pasaron
con 1 worker y con 3; ejecución final con 3. `promtool check config` y Compose
válidos; 18 consultas PromQL aceptadas por Prometheus real. Último POST exitoso:
202 en 0,243 s; traza `a722b8dcb2aa258d55e9aceadf53b572`. Fallo:
`ec6362d750442026173830d91e4c12e5`.

**Escalado medido:** 30 pipelines de 3 etapas × 1 s, enviados en 4,88 s;
28 pendientes antes de escalar de 1 a 3 workers; los 30 terminaron bien en
36,75 s desde el primer envío. No es una comparación controlada de rendimiento:
incluye envío, arranque/escalado y consultas de seguimiento.

**Integración:** se usa `observability/compose.local.yml`, sin editar el compose
de P4. Cambio mínimo en P2 autorizado por el usuario: log de error dentro del span
de etapa y su test, sin tocar la ejecución ni el ack. Instrucciones en
`observability/README.md`. Publicación de `lab2/p3` autorizada por el usuario;
el merge a `main` queda a su cargo desde GitHub.

**Troubleshooting:** Jaeger puede devolver una traza parcial mientras llegan los
batches de cada servicio: los tests esperan todos los spans necesarios, no solo
el del worker. La revisión independiente detectó salida duplicada con un handler
de consola preexistente: corregida con regresión RED→GREEN, conservando handlers
de captura/archivo. Starlette emite una advertencia de deprecación de TestClient
con httpx; no se cambiaron las dependencias congeladas para ocultarla.

### P4 — Plataforma y entrega 🔶 · Responsable: ________

- [x] 🔴 `docker-compose.yml` completo: red, `depends_on:
      condition: service_healthy`, `restart`, `stop_grace_period` del worker,
      **sin puertos publicados en el worker** (si no, `--scale` choca), plugin
      `rabbitmq_prometheus` (**ya viene habilitado** en la imagen 4.3.7, verificado
      en el Hito 0: no hace falta activarlo)
      _Sin el dashboard. Desde el 25/10, `TELEMETRY=on` en api, validator y worker._
- [x] 🔴 Healthchecks con **`127.0.0.1`, no `localhost`** (aprendido en lab1:
      `localhost` resuelve primero a IPv6 y el contenedor queda unhealthy)
      _Las imágenes `python:3.12-slim` no traen wget: el chequeo usa `urllib` contra
      `http://127.0.0.1:8000/health`._
- [x] 🔴 `scripts/demo.py` con `ok`, `fail`, `burst --n 30` y `scale 3`
- [x] 🔴 `README.md`: cómo levantar, endpoints con ejemplos, URLs de las UIs
      (RabbitMQ `:15672`, Jaeger `:16686`, Prometheus `:9090`), cómo reproducir
      éxito, fallo y escalado, `docker compose down -v`
- [ ] 🟡 **Dashboard** en `services/web/` (Vite + React + TS, patrón de
      `lab1/web`): servidor de mocks (`npm run dev:mock`), formulario con
      atajos *Ejecutar OK* / *Forzar fallo en test* / *Lanzar 10*, lista en vivo
      (polling cada 2 s) con enlace *Ver traza en Jaeger*, panel de
      estadísticas, `Dockerfile` + `nginx.conf.template` con proxy `/api`
      _El `trace_id` de la API ya es real: el enlace puede armarse como
      `http://localhost:16686/trace/{trace_id}`._
- [ ] 🟡 `COLOQUIO.md` (cheat sheet, guion con tiempos, preguntas por rol) y
      `slides/OUTLINE.md` con las 7 diapositivas
- [ ] 🟡 *(lo toma P1 al terminar su núcleo)* `tests/e2e/test_flow.py` y
      `.github/workflows/lab2-ci.yml` propio (tests por servicio,
      `docker compose config` y `build`, Semgrep sobre `lab2/`). No se tocan
      `ci.yml` ni `sast.yml` de lab1

**Verificado (23/10):** `docker compose up --build -d --wait` dejó los 7 servicios
healthy. El worker publica `8000/tcp` solo dentro de la red (sin puerto en el host).
`python scripts/demo.py ok` → `202` en 340 ms y `succeeded` (`trace_id=None`).
`fail` → `202` en 187 ms, `failed` y `deploy` en `pending`.
`scale 3` pasó de `workers=1` a `workers=3` sin recrear el primero.
`burst --n 3` (con los 3 workers ya arriba) terminó los 3 en `succeeded`;
`queue_depth` salió 0 porque los workers ya los habían tomado.
`docker compose down -v` borró contenedores y la red. `burst --n 30` es el mismo
comando; no se corrió en esta pasada.

**Verificado (25/10, con P3 en `main`):** `docker compose up --build -d --wait`
con `TELEMETRY=on`. `demo.py ok` → `202` en 322 ms,
`trace_id=479871117de9ca3726ba8ed15dd8e463`, traza completa en Jaeger.
`demo.py fail` → `trace_id=e46c4e4db0f8ceda70f6ed93faa7e29d`, span `stage test`
con error y el mismo id en el log `level=error` del worker.
`demo.py scale 3` → `workers=3` y tres targets `worker` en UP, junto con
`api`, `validator` y `rabbitmq`. El stack quedó levantado.

#### Después del merge de P3 ✅ (25/10)

P3 entró a `main` en el PR #3. `prometheus.yml` ya traía el scrape de api,
validator, worker (DNS) y RabbitMQ. El compose pasó de `TELEMETRY=off` a
`TELEMETRY=on` en api, validator y worker, y se reconstruyeron las imágenes.
La receta que se siguió:

1. En `docker-compose.yml`, en **api**, **validator** y **worker**, pasar
   `TELEMETRY: "off"` a `TELEMETRY: "on"`. Está escrito literal a propósito:
   un `.env` con `TELEMETRY=on` no entra al contenedor mientras el compose
   diga `off`. `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4317` ya está.
2. Reemplazar `observability/prometheus/prometheus.yml` por el scrape real y
   validar con `docker compose exec prometheus promtool check config
   /etc/prometheus/prometheus.yml` (o `promtool` en el host). El worker ya
   sirve `/metrics` en su propio servidor; `start_metrics_server` de P3 no
   hace falta para él.

   ```yaml
   global:
     scrape_interval: 5s
   scrape_configs:
     - job_name: api
       static_configs:
         - targets: ["api:8000"]
     - job_name: validator
       static_configs:
         - targets: ["validator:8000"]
     - job_name: rabbitmq
       static_configs:
         - targets: ["rabbitmq:15692"]
     - job_name: worker
       dns_sd_configs:
         - names: ["worker"]
           type: A
           port: 8000
           refresh_interval: 5s
   ```

3. `docker compose up -d --build`. Un `python scripts/demo.py ok` tiene que
   devolver un `trace_id` de 32 hex. Ese mismo id tiene que aparecer en
   Jaeger (`http://localhost:16686`, una sola traza con api, validator y
   worker: `POST /pipelines`, `publish pipeline.jobs`, `process pipeline.jobs`,
   `stage build|test|deploy`) y en `docker compose logs worker`.
4. `python scripts/demo.py fail`: el span `stage test` en rojo en Jaeger, un
   log `level=error` y el job `failed`.
5. `python scripts/demo.py scale 3` y, en Prometheus
   (`http://localhost:9090/targets`), tres targets `worker` en UP más `api`,
   `validator` y `rabbitmq`.
6. Recién ahí tildar el paso 3 de la Fase 5 y la casilla de la Fase 4 que pide
   los targets de Prometheus. El dashboard, el coloquio y el CI siguen en
   sus casillas amarillas.

## Fase 2 — Núcleo asíncrono: API ↔ cola ↔ worker (N2) 🔲

**Lideran:** P2 y P1 · Entra primero P2, después P1.

- [ ] 🔴 PR de P2 mergeado a `main`
- [ ] 🔴 PR de P1 mergeado a `main` (rebase sobre P2)
- [ ] 🔴 Con `STATE_BACKEND=redis` y `PUBLISHER=rabbit`: `POST /pipelines` →
      `202` en menos de 0,3 s → el worker lo procesa → `GET` muestra
      `succeeded`
- [ ] 🔴 Dos `POST` seguidos: el segundo responde al instante mientras el primero
      sigue corriendo
- [ ] 🔴 `fail_at: "test"` → estado `failed`
- [ ] 🔴 `docker compose kill worker` a mitad de un job → el mensaje vuelve a
      `ready` y otro worker lo termina

**Verificado:** _pendiente_

## Fase 3 — Observabilidad encendida (N3) ✅

**Lidera:** P3

- [x] 🔴 PR de P3 mergeado a `main`; `TELEMETRY=on` (no hacer hasta aprobar las pruebas locales)
      _PR #3 en `main`. El compose de P4 quedó con `TELEMETRY=on` el 25/10._
- [x] 🔴 Jaeger: **una sola traza** con `api`, `validator` y `worker` (spans del
      contrato: `POST /pipelines`, `publish pipeline.jobs`,
      `process pipeline.jobs`, `stage build|test|deploy`)
- [x] 🔴 El `trace_id` de la respuesta coincide con el de los logs del worker
      y con el de Jaeger (comprobación automática de trace_id y span_id)
- [x] 🔴 Un pipeline que falla deja el span de `stage test` en rojo y un log
      `level=error`
- [x] 🔴 Prometheus: targets `api`, `validator`, `worker` y `rabbitmq` en **UP**
- [x] 🔴 `pipeline_jobs_total{status="failed"}` sube cuando falla un pipeline

**Verificado (23/10):** desde `lab2/`, con el compose complementario levantado:
`EXPECTED_WORKERS=3 .venv/bin/python -m pytest observability/check_local.py -v -s`
→ 5 passed. El 25/10 se repitió sobre el compose de P4, ya en `main`: ver P4.

## Fase 4 — Todo junto (N4) 🔶

**Lidera:** P4

- [x] 🔴 Clon limpio en una carpeta nueva → `docker compose up --build -d` →
      `docker compose ps` con todo `healthy`, sin pasos manuales
      _Probado en esta copia de trabajo, no en un segundo clon: `up --build -d --wait`
      dejó api, validator, worker, rabbitmq, redis, jaeger y prometheus healthy._
- [x] 🔴 `docker compose up -d --scale worker=3` → 3 targets de worker en
      Prometheus y la cola se vacía ~3 veces más rápido
      _25/10: `python scripts/demo.py scale 3` mostró `workers=3` y Prometheus
      tenía `worker` up tres veces, más `api`, `validator` y `rabbitmq` up.
      La comparación de velocidad sigue siendo la del 23/10 en P3: 30 pipelines
      de 3 etapas × 1 s terminaron en 36,75 s al pasar de 1 a 3 workers._
- [ ] 🟡 El dashboard apunta al `/api` real (ya no al mock) y funciona
- [x] 🔴 `docker compose down -v` sin residuos

**Verificado (23/10):** ver P4. `down -v` eliminó los contenedores y la red
`deployflow_default`.

## Fase 5 — Demo y entrega 🔲

**Lideran:** todos

La demo de 5 pasos (lo que hay que poder mostrar sin dudar):

- [x] 🔴 **Paso 1:** `POST /pipelines` → `202` con `job_id`
      _25/10: `202` en 322 ms con `trace_id=479871117de9ca3726ba8ed15dd8e463`._
- [ ] 🔴 **Paso 2:** el worker tarda varios segundos; mientras tanto la API
      acepta más pedidos; `GET /pipelines/{id}` muestra el avance
- [x] 🔴 **Paso 3:** Jaeger muestra el mismo `trace_id` atravesando API,
      validación y worker (a través de la cola)
      _25/10: traza `479871117de9ca3726ba8ed15dd8e463` con spans `POST /pipelines`,
      `POST /validate`, `publish pipeline.jobs`, `process pipeline.jobs` y
      `stage build|test|deploy`, servicios api, validator y worker._
- [x] 🔴 **Paso 4:** fallo controlado en `test`: log de error, span rojo en
      Jaeger y estado `failed`
      _25/10: `trace_id=e46c4e4db0f8ceda70f6ed93faa7e29d`. El job quedó `failed`,
      `deploy` no tiene span, `stage test` tiene `error=true` y el log del
      worker es `level=error` con ese mismo `trace_id`._
- [ ] 🔴 **Paso 5:** 30 trabajos, crece la cola en RabbitMQ, pasar de 1 a 3
      workers y comparar las métricas antes y después

Entrega:

- [ ] 🔴 Ensayar la demo dos veces, cronometrada
- [ ] 🔴 Capturas de respaldo de Jaeger, Prometheus y RabbitMQ (plan B si falla
      la red del aula)
- [ ] 🔴 `README.md` congelado
- [ ] 🟡 `COLOQUIO.md` y diapositivas (el coloquio es **individual**: cada uno
      tiene que poder explicar todo el proyecto, no solo su parte)
- [x] 🟡 Sección "Lab 2" en el `README.md` de la raíz del repo

**Verificado:** _pendiente_

## Pendientes y decisiones abiertas

- [ ] 🔴 Conseguir la **consigna oficial del TP2, la rúbrica y la fecha de
      entrega** y pegarlas en `AGENTS.md` (hoy no están en ningún archivo)
- [ ] 🔴 Completar los nombres de **Responsable** en la tabla de Reparto
- [x] 🔴 Arreglar Docker Desktop en la máquina de MaxDCoc (resuelto, ver la nota
      de troubleshooting en la Fase 0)
- [ ] 🟡 ¿Hay que publicar imágenes en Docker Hub o desplegar en la nube como
      en TP1?
- [ ] 🟡 `ci.yml` y `sast.yml` de lab1 corren en **cada push** (y pushean
      imágenes de lab1 a Docker Hub): las ramas de lab2 los van a disparar.
      Opcional, a confirmar con el grupo: `paths-ignore: ['lab2/**']` en esos
      dos archivos

## Bitácora

| Fecha | Quién | Qué se hizo |
|---|---|---|
| 22/10 | — | Creados este `PLAN.md` y la guía del equipo (`docs/DeployFlow_guia_del_equipo.pdf`) |
| 22/10 | MaxDCoc (con Claude) | Hito 0: `common/` con el contrato, las transiciones y los dobles (61 tests), 12 ejemplos JSON, `AGENTS.md`, dependencias fijadas y compose de infra levantado y verificado (4 servicios healthy). Todo en la rama `lab2/hito0-contrato` |
| 22/10 | MaxDCoc (con Claude) | P1: validador (42 tests) y API principal (29 tests) con sus Dockerfiles, probados juntos en una red de Docker con estado en memoria y publisher falso. Rama `lab2/p1-apis`, parte de `lab2/hito0-contrato` |
| 23/10 | MaxDCoc (con Claude) | P2: cola de RabbitMQ, estado en Redis y worker con sus tests (91 en `common` contra Redis y RabbitMQ reales, 18 en el worker) y su Dockerfile, probados de punta a punta en contenedores junto con P1: flujo completo, fallo controlado, `docker stop` ordenado, `docker kill` con redelivery y 3 workers. Mergeada a `main`. Queda sin hacer la cola de reintento (🟡) |
| 23/10 | — (rama `lab2/p3`) | P3 implementada y validada localmente: trazas OTLP, contexto AMQP, logs JSON, métricas HTTP, DNS de workers, consultas y compose complementario. 204 tests de regresión + 5 de integración; 30 jobs y escalado 1→3. Cambio mínimo de log en P2 autorizado. Publicación de la rama autorizada; merge a main reservado al usuario en GitHub. |
|  |  |  |
| 23/10 | MaxDCoc (con Claude) | P2: cola de RabbitMQ, estado en Redis y worker con sus tests (91 en `common` contra Redis y RabbitMQ reales, 18 en el worker) y su Dockerfile, probados de punta a punta en contenedores junto con P1: flujo completo, fallo controlado, `docker stop` ordenado, `docker kill` con redelivery y 3 workers. Mergeada a `main`. La cola de reintento (🟡) se hizo después (fila siguiente) |
| 23/10 | MaxDCoc (con Claude) | P2: cola de reintento (`pipeline.jobs.retry`, espera de 5 s, hasta `MAX_ATTEMPTS` intentos y después la DLQ con el job en `failed`). 136 tests en `common` y 27 en el worker, mutaciones 25/26 (1 equivalente) y prueba de punta a punta con el worker en contenedor. Rama `lab2/p2-reintento`, mergeada a `main` |
| 23/10 | — | P4 sin P3: api, validator y worker en el compose (`TELEMETRY=off`), `scripts/demo.py` y `lab2/README.md`. Verificado `ok`, `fail`, `scale 3`, `burst --n 3` y `down -v`. En P4 quedó el procedimiento para encender trazas y Prometheus al mergear P3 |
| 25/10 | — | P3 ya estaba en `main` (PR #3). P4 encendió `TELEMETRY=on` en el compose y verificó la traza en Jaeger, el log de error del worker y 3 targets `worker` en Prometheus |
