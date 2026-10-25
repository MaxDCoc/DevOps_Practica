# DeployFlow (lab 2)

Mini plataforma CI/CD simulada: la API acepta un pipeline, lo valida, lo deja en RabbitMQ y un worker simula build, test y deploy. El estado queda en Redis.

Jaeger y Prometheus ya muestran el recorrido de un pedido: el compose levanta `api`, `validator` y `worker` con `TELEMETRY=on`, así que cada pipeline genera una traza con sus spans y los tres servicios se scrapean. El dashboard de P4 permite verlo sin tocar curl ni Swagger.

## Levantar

Desde esta carpeta:

```bash
docker compose up --build -d
docker compose ps
```

Hay que esperar a que los ocho servicios queden `healthy`. Bajar todo y borrar los datos:

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

## Dashboard (P4)

[http://localhost:3000](http://localhost:3000). Formulario para lanzar pipelines (con atajos para forzar el fallo en `test` y para mandar diez de golpe), lista que se refresca cada 2 s con el estado de cada etapa, duración y enlace a la traza en Jaeger, y un panel con los pedidos por estado, la profundidad de la cola y los workers vivos. nginx sirve el build y reenvía `/api/` a `api:8000`; no tiene lógica de negocio propia. Para maquetar sin backend: `cd services/web && npm run dev:mock`.

## URLs

| Qué | Dónde |
|---|---|
| Dashboard | http://localhost:3000 |
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

La respuesta trae un `job_id` y un `trace_id` (32 hex, W3C). El avance se consulta con `GET /pipelines/{job_id}` y la traza completa se abre en `http://localhost:16686/trace/<trace_id>` (el dashboard arma ese enlace solo).
