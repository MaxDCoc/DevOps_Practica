# DeployFlow (lab 2)

Mini plataforma CI/CD simulada: la API acepta un pipeline, lo valida, lo deja en RabbitMQ y un worker simula build, test y deploy. El estado queda en Redis.

Jaeger y Prometheus están levantados con el resto. Todavía no muestran el recorrido de un pedido: las trazas y el scrape de `api`, `validator` y `worker` los enciende P3. Hasta ese merge el compose fuerza `TELEMETRY=off`. Los pasos para prenderlo están en [PLAN.md](PLAN.md), sección «Después del merge de P3».

## Levantar

Desde esta carpeta:

```bash
docker compose up --build -d
docker compose ps
```

Hay que esperar a que los siete servicios queden `healthy`. Bajar todo y borrar los datos:

```bash
docker compose down -v
```

## Demo

Con el compose arriba:

```bash
python scripts/demo.py ok
python scripts/demo.py fail
python scripts/demo.py burst --n 30
python scripts/demo.py scale 3
```

- `ok` manda un pipeline de 3 segundos por etapa y espera `succeeded`. La API responde `202` mucho antes de que el worker termine.
- `fail` pide que falle en `test`. El job queda `failed` y `deploy` sigue `pending`.
- `burst` manda 30 pedidos, imprime `queue_depth` y espera a que terminen. Con un solo worker la cola se ve llena; con tres, a veces ya está vacía cuando el script la consulta.
- `scale 3` pasa a tres workers (sin recrear el que ya corre) y espera a verlos en `GET /stats`.

## URLs

| Qué | Dónde |
|---|---|
| API y Swagger | http://localhost:8000/docs |
| Validador y Swagger | http://localhost:8001/docs |
| Consola de RabbitMQ | http://localhost:15672 (`deployflow` / `deployflow`) |
| Jaeger | http://localhost:16686 |
| Prometheus | http://localhost:9090 |

Un pedido de ejemplo, el mismo que usa `demo.py ok`:

```bash
curl -s -X POST http://localhost:8000/pipelines \
  -H "Content-Type: application/json" \
  -d "{\"project\":\"shop-frontend\",\"branch\":\"main\",\"config\":{\"stages\":[\"build\",\"test\",\"deploy\"],\"stage_seconds\":3,\"fail_at\":null}}"
```

La respuesta trae un `job_id`. El avance se consulta con `GET /pipelines/{job_id}`. `trace_id` vuelve `null` hasta que P3 reemplace los stubs de observabilidad.
