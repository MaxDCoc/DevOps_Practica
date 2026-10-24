# P3 — Plan de implementación local

**Objetivo:** completar la observabilidad del contrato de `../AGENTS.md` y la sección P3 de `../PLAN.md`.
**Rama:** `lab2/p3`, creada desde `main` (`ac39b48`). No hacer commit, push ni merge sin autorización.
**Arquitectura:** OpenTelemetry SDK + exportador OTLP gRPC hacia Jaeger; instrumentación FastAPI/httpx; Prometheus pull; logs JSON por stderr.

## Restricciones y decisiones

- Conservar las firmas compartidas y los nombres del contrato. `TELEMETRY=off` desactiva trazas, no métricas ni logs.
- No duplicar spans de cola, métricas de negocio ni servidor HTTP del worker: ya existen en P1/P2.
- El usuario autorizó expresamente el cambio mínimo en el worker de P2: log del fallo de etapa y su prueba.
- No editar `docker-compose.yml` de P4: las pruebas completas usarán un archivo compose complementario dentro de `observability/`.
- Sin Grafana, Loki, dashboard ni reintentos de negocio en esta entrega.

## 1. Trazas y logs

Archivos: `common/deployflow_common/{observability,logging}.py`, `common/tests/test_{observability,logging}.py`; excepción autorizada en `services/worker/app/runner.py` y sus tests.
Interfaces: conservar `setup_telemetry(service_name)`, `shutdown_telemetry()`, `inject_trace_context(headers)`, `extract_trace_context(headers)`, `current_trace_id()` y `setup_logging(service_name, level="INFO")`.

- [x] Escribir tests de propagación W3C (str/bytes, headers ausentes/inválidos, preservar x-attempt), resource/exportación/cierre, apagado e inicialización repetida.
- [x] Ejecutar tests y comprobar fallos por funcionalidad ausente.
- [x] Implementar con propagador W3C, Resource `service.name`, BatchSpanProcessor y OTLP gRPC; cierre que vacía pendientes.
- [x] Escribir y ejecutar tests RED de logs JSON, contexto activo y errores en una sola línea; implementar el formatter y setup idempotente.
- [x] Agregar test RED del fallo controlado del worker; emitir el log dentro del span de etapa.
- [x] Ejecutar common y worker; los tests de infraestructura requieren las URLs locales de Redis/RabbitMQ.

## 2. HTTP y Prometheus

Archivos: `common/deployflow_common/metrics.py`, `common/tests/test_metrics.py`, `observability/prometheus/prometheus.yml`, `observability/queries.md`.
Interfaces: `instrument_fastapi(app, service_name)` y `start_metrics_server(port)` conservadas. El servidor auxiliar no se llama desde el worker existente.

- [x] Tests RED con aplicación real: métricas por plantilla, 404 sin cardinalidad ilimitada, errores 500, doble instrumentación, varias apps sin colisiones, spans SERVER y CLIENT y modo off.
- [x] Implementar middleware ASGI, endpoint `/metrics`, instrumentación FastAPI/httpx y helper de servidor auxiliar.
- [x] Configurar api/validator estáticos, worker DNS A en puerto 8000 y RabbitMQ (incluyendo detalle de colas).
- [x] Validar con `promtool check config`; documentar PromQL de errores, p95, cola y workers sanos, y búsquedas Jaeger.

## 3. Integración y revisión

Archivos propios: `observability/compose.local.yml`, `observability/README.md`, pruebas/herramientas de verificación dentro de `observability/` según necesidad, sección P3 y Fase 3 de `PLAN.md`.

- [x] Ejecutar regresión de common y los tres servicios por separado (sus módulos `app` comparten nombre).
- [x] Levantar infraestructura y servicios en local con compose complementario, manteniendo workers sin puertos publicados.
- [x] Probar éxito y fallo: trace_id de respuesta = logs del worker = Jaeger, spans de todos los servicios y etapa test ERROR.
- [x] Comprobar targets UP, incremento de fallos y descubrimiento de tres workers.
- [x] Revisar el diff con un revisor independiente; resolver hallazgos importantes con pruebas.
- [x] Registrar evidencia real y pendientes, sin marcar como hechos PR/merge a main.

## Riesgos que verificar

1. Inicialización/cierre global OTel y recreación de apps en tests: sin providers cerrados reutilizados ni registros duplicados.
2. Headers AMQP binarios o inválidos: no romper el consumidor ni perder headers de negocio.
3. Logs con excepción/multilínea: una sola línea JSON, identificadores del span activo y extras preservados.
4. Rutas dinámicas y 404: etiquetas acotadas; no usar job_id en métricas.
5. Réplicas: DNS descubre cada worker; contar sanos con `sum(up{job="worker"})`, no solo `count(up)`.

## Evidencia / decisiones de ejecución

- Entorno local: Python 3.12.14, dependencias fijadas instaladas con `uv pip install -r requirements-dev.txt` desde `lab2/`.
- La primera instalación desde la raíz falló por la ruta relativa `./common`; corregido ejecutando desde `lab2/`, sin cambiar requisitos.
- Regresión final: 114 common + 29 API + 42 validator + 19 worker = 204 tests, sin skips de infraestructura; una advertencia de deprecación externa Starlette/httpx.
- Integración final: `EXPECTED_WORKERS=3 .venv/bin/python -m pytest observability/check_local.py -v -s` → 5 passed; antes también validado con un worker.
- `promtool check config`, `docker compose ... config --quiet` y rebuild de los tres servicios: exit 0. Las 18 consultas de queries.md fueron aceptadas por Prometheus real.
- Burst de 30 jobs, escalando 1→3: 30 succeeded, cola ready máxima observada 28, 36,75 s desde el primer envío (no comparación controlada).
- La consulta inicial de Jaeger podía devolver una traza parcial (faltaba el batch del validador). Evidencia: consulta posterior de la misma traza mostró los tres servicios. Corregida la espera del test para exigir los spans completos; integración GREEN.
- Revisión independiente read-only: un hallazgo medio sobre handlers de consola preconfigurados que duplicaban el JSON. Test de regresión falló con 8 líneas; corregido setup_logging, test GREEN y suites completas GREEN.
- Decisiones de alcance confirmadas: ciclo de vida OTel único por proceso y servicio; no hot-switch de telemetría, múltiples servicios por intérprete ni métricas multiproceso. Son límites documentados del lab, no capacidades prometidas.
- El chequeo local se llama check_local.py para no recolectarlo por accidente: requiere invocación explícita y servicios levantados.
- Quedan fuera los extras (alerta, Grafana/Loki) y la consigna oficial todavía pendiente del equipo. El usuario autorizó publicar lab2/p3 y bajar el entorno local de DeployFlow sin borrar volúmenes; hará personalmente el merge a main desde GitHub.
