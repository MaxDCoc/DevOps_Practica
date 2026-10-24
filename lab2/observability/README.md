# P3 — Observabilidad y pruebas locales

Trazas OpenTelemetry → Jaeger, métricas Prometheus y logs JSON correlacionados.
Esta guía y `compose.local.yml` permiten validar P3 sin editar el compose de P4.
El contrato sigue siendo [`../AGENTS.md`](../AGENTS.md).

## Levantar en la rama de trabajo

Requisitos: Docker con Compose, Python ≥3.12 y puertos 8000, 8001, 9090, 16686,
4317/4318, 5672, 15672 y 6379 disponibles. Desde la raíz del repositorio:

```bash
git switch lab2/p3
cd lab2
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

docker compose -f docker-compose.yml -f observability/compose.local.yml config --quiet
docker compose -f docker-compose.yml -f observability/compose.local.yml up --build -d --wait
# Si Prometheus estaba levantado antes de cambiar prometheus.yml, recargarlo:
docker compose -f docker-compose.yml -f observability/compose.local.yml restart prometheus
```

En Windows, activar con `.venv\Scripts\Activate.ps1` y usar `python` en lugar de
`python3`. `uv venv --python 3.12 .venv` y `uv pip install -r requirements-dev.txt`
son alternativas a venv/pip. **Instalar desde `lab2/`**, porque el requirements
usa `./common` como ruta relativa.

El complemento usa los Dockerfiles existentes. Dentro de Docker, el endpoint
OTLP es `http://jaeger:4317`; para un servicio ejecutado en el host usar
`OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4317`.
El SDK interpreta `http://` como gRPC sin TLS; no forzamos insecure para URLs HTTPS.
Estas credenciales y puertos son de laboratorio, no de producción.

## Comprobar el flujo real

```bash
# Desde lab2/, con el venv activado y un worker:
python -m pytest observability/check_local.py -v -s

# Escalar sin colisiones de puertos:
docker compose -f docker-compose.yml -f observability/compose.local.yml up -d --wait --scale worker=3 worker
EXPECTED_WORKERS=3 python -m pytest observability/check_local.py -v -s
```

PowerShell: `$env:EXPECTED_WORKERS="3"; python -m pytest observability/check_local.py -v -s`.

Los cinco tests verifican:
1. Pipeline exitoso: mismo trace_id, tres servicios y cadena de padres correcta.
2. Fallo en test: span ERROR, sin deploy y log JSON con trace_id/span_id coincidentes.
3. Targets UP y el número esperado de workers descubiertos por DNS.
4. Incremento del contador de fallos.
5. Métricas de cola con label `queue="pipeline.jobs"` desde `/metrics/detailed`.

Crean dos pipelines de prueba (etapas de 1 s), no borran estados ni colas y no
levantan servicios automáticamente. Se invocan explícitamente. Jaeger guarda las
trazas en memoria en esta configuración: reiniciarlo puede borrarlas.

## Pantallas para probar a mano

- Swagger API: <http://localhost:8000/docs>.
- Swagger validador: <http://localhost:8001/docs>.
- Jaeger: <http://localhost:16686>.
- Targets de Prometheus: <http://localhost:9090/targets>.
- Consola RabbitMQ: <http://localhost:15672> (`deployflow` / `deployflow` por defecto).

En Swagger hay ejemplos de éxito y `fail_at: "test"`. El POST devuelve `202`,
`job_id` y `trace_id`; consultar `GET /pipelines/{job_id}` hasta finalizar. Abrir
`http://localhost:16686/trace/<trace_id>`. Consultas para latencias, errores,
cola y escalado: [`queries.md`](queries.md).

```bash
docker compose -f docker-compose.yml -f observability/compose.local.yml logs --no-log-prefix worker
```

El log del fallo de etapa incluye `job_id`, `stage`, `error`, `trace_id` y
`span_id`. Se agregó con autorización del usuario en `services/worker/app/runner.py`,
sin alterar estados, ack ni ejecución. El resto de P1/P2 no se modificó.
Los mensajes de arranque de Uvicorn anteriores al lifespan pueden ser texto;
una vez ejecutado `setup_logging`, sus logs también salen en JSON.

## Regresión y validación de configuración

**Los tests de mensajería de `common` purgan las colas del contrato. Ejecutarlos
solo con infraestructura, sin consumidores ni trabajos valiosos pendientes.**
Los tests Redis usan y vacían la base 15, no la base 0 de la aplicación.

```bash
# Si levantaste los servicios locales, dejar terminar los jobs y parar el worker:
docker compose -f docker-compose.yml -f observability/compose.local.yml stop worker

# Venv activado, desde lab2/; ejecutar por separado para no mezclar módulos app:
(cd common && python -m pytest -q)
(cd services/api && python -m pytest -q)
(cd services/validator && python -m pytest -q)
(cd services/worker && python -m pytest -q)

docker compose -f docker-compose.yml -f observability/compose.local.yml exec -T prometheus promtool check config /etc/prometheus/prometheus.yml

# Retomar el flujo completo, con tres workers:
docker compose -f docker-compose.yml -f observability/compose.local.yml up -d --wait --scale worker=3 worker
```

Con las versiones fijadas del proyecto, el nuevo test de FastAPI muestra una
advertencia de Starlette: `TestClient` depreca httpx en favor de httpx2. No es un
fallo de los tests; no se cambiaron dependencias congeladas para ocultarla.

## Decisiones de implementación

- `TELEMETRY=off` no instala instrumentación de trazas ni exportador; los logs y
  métricas siguen funcionando. Variables desconocidas fallan con `ValueError`.
- Un TracerProvider y un Resource por proceso; setup repetido no duplica exportadores.
  El cierre vacía pendientes y es definitivo, igual que el del SDK. Para otro
  ciclo de vida completo se inicia otro proceso. No ejecutar varios servicios con
  diferentes `service.name` dentro del mismo proceso.
- `traceparent`/`tracestate` viajan en headers AMQP W3C, preservando `x-attempt`.
  Los bytes se normalizan; contexto ausente/inválido inicia una traza nueva.
- Los spans de la cola y métricas de negocio ya eran de P1/P2: no se duplican.
  El worker ya tiene servidor HTTP; no llama al helper `start_metrics_server`.
- Rutas HTTP por plantilla, 404 como `__unmatched__`; se excluyen `/health` y
  `/metrics` para no contaminar las mediciones. Prometheus añade job/instance
  como labels del scrape, no hace falta incluir IDs en las métricas.
- Prometheus usa DNS A para encontrar cada worker. `sum(up{job="worker"})`
  cuenta los sanos; `count(up)` incluye también targets caídos.
- P4 puede reutilizar la configuración de Prometheus y los bloques de servicios
  del complemento al completar su compose. No usar ambos bloques duplicados.

## Apagar sin borrar datos

```bash
docker compose -f docker-compose.yml -f observability/compose.local.yml down
```

No se necesita `-v` para estas pruebas. No ejecutar merge/push a main hasta
revisar juntos la validación local.
