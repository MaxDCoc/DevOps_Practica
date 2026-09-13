# Lab 1 — Sistema de Subastas en Tiempo Real

![CI](https://github.com/MaxDCoc/DevOps_Practica/actions/workflows/ci.yml/badge.svg?branch=fases6y7)
![SAST](https://github.com/MaxDCoc/DevOps_Practica/actions/workflows/sast.yml/badge.svg?branch=fases6y7)

TP1 DevOps — UTN FRRe 2026. App web + API NestJS + Redis detrás de Traefik, con 3 réplicas de la API.

## Levantar

```bash
docker compose up --build
```

| URL | Qué es |
|---|---|
| http://localhost/ | App web |
| http://localhost/api/health | Health (incluye `hostname` de la réplica) |
| http://localhost:8080 | Dashboard Traefik |

## Arquitectura local

- **Traefik** en `:80` — `/` → web, `/api` → balanceo entre `api1` / `api2` / `api3`
- **Redis** — solo la API se conecta; sticky cookie `api_sticky` para Socket.IO
- Demo de balanceo: refrescar `/api/health` y ver hostnames distintos; `docker stop lab1-api1-1` y comprobar que el servicio sigue respondiendo

## Pipeline

Workflows en la raíz del repo (`.github/workflows/`):

1. Tests unitarios (`npm test` en `api/`)
2. SAST con Semgrep
3. Build + push a Docker Hub (`$DOCKERHUB_USERNAME/subastas-api` y `subastas-web`)

Configurar en GitHub → Settings → Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

## Docs

- [AGENTS.md](./AGENTS.md) — consigna, stack, contrato
- [PLAN.md](./PLAN.md) — fases del desarrollo
- [COLOQUIO.md](./COLOQUIO.md) — guía de defensa
