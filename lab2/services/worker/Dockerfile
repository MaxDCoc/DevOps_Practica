# Contexto de build: lab2/   ->   docker build -f services/worker/Dockerfile -t deployflow-worker .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Primero la librería compartida y las dependencias (cambian poco): aprovecha la caché de capas.
COPY common /tmp/common
COPY services/worker/requirements.txt /tmp/requirements.txt
RUN pip install /tmp/common -r /tmp/requirements.txt && rm -rf /tmp/common /tmp/requirements.txt

COPY services/worker/app /app/app

RUN useradd --system --uid 10001 --no-create-home appuser
USER appuser

ENV SERVICE_NAME=worker
# /health y /metrics (solo dentro de la red de compose: el worker no publica puertos, así se puede escalar).
EXPOSE 8000
# Python es PID 1 y recibe SIGTERM directo: termina el trabajo en curso antes de salir.
CMD ["python", "-m", "app.worker"]
