# Dashboard (P4)

Pantalla única para ver los pipelines en vivo: formulario con atajos, lista que se
refresca cada 2 s (estado, etapas, duración y enlace a la traza en Jaeger) y panel de
estadísticas con pedidos por estado, profundidad de la cola y workers vivos.

No tiene lógica de negocio propia: habla con la API de P1 por `/api/...` y muestra lo
que hay en Redis. Si el dashboard no llega a tiempo, **Swagger lo reemplaza** en la demo
(`http://localhost:8000/docs`).

## Desarrollo

Con la infraestructura y los servicios de compose arriba:

```bash
cd lab2/services/web
npm install
npm run dev          # http://localhost:5173, proxy /api -> http://127.0.0.1:8000
```

Contra el servidor de mocks (sin backend, ideal para maquetar):

```bash
npm run dev:mock     # mismo puerto, /api lo responde un plugin de Vite
```

El mock implementa el contrato del Anexo A (`docs/contract-examples/`): valida el
pedido igual que el validador, responde `202`, simula el avance de las etapas con
`stage_seconds` y permite `fail_at`. Arranca con cuatro pipelines de ejemplo.

## Build y contenedor

```bash
npm run build        # tsc -b && vite build
docker build -t deployflow-web .
```

En compose, `web` se levanta con `docker compose up --build -d` y queda en
`http://localhost:3000`. nginx sirve el build y reenvía `/api/` a `api:8000`.

## Variables de build (opcionales)

| Variable | Por defecto | Para qué |
|---|---|---|
| `VITE_API_BASE` | `/api` | Prefijo de la API en el navegador |
| `VITE_JAEGER_URL` | `http://localhost:16686` | Base del enlace *Ver traza* |
| `VITE_PROMETHEUS_URL` | `http://localhost:9090` | Enlace del panel de estadísticas |
| `VITE_RABBITMQ_URL` | `http://localhost:15672` | Enlace a la consola de RabbitMQ |
| `VITE_API_DOCS_URL` | `http://localhost:8000/docs` | Enlace a Swagger |
| `VITE_API_TARGET` | `http://127.0.0.1:8000` | A dónde proxya Vite en `npm run dev` |
