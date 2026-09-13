# DevOps_Practica

![CI](https://github.com/MaxDCoc/DevOps_Practica/actions/workflows/ci.yml/badge.svg)
![SAST](https://github.com/MaxDCoc/DevOps_Practica/actions/workflows/sast.yml/badge.svg)

TP1 DevOps — UTN FRRe 2026. Sistema de subastas en tiempo real (web + API + Redis contenerizados).

## Lab 1

Ver [lab1/README.md](lab1/README.md).

```bash
cd lab1
docker compose up --build
```

## CI/CD

- **CI** (`.github/workflows/ci.yml`): tests Vitest de la API + build/push de imágenes `subastas-api` y `subastas-web` a Docker Hub.
- **SAST** (`.github/workflows/sast.yml`): Semgrep sobre `lab1/`.

Secrets de GitHub necesarios para el push a Docker Hub:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN` (Access Token, no la password)
