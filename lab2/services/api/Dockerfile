# Contexto de build: lab2/   ->   docker build -f services/api/Dockerfile -t deployflow-api .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Primero la librería compartida y las dependencias (cambian poco): aprovecha la caché de capas.
COPY common /tmp/common
COPY services/api/requirements.txt /tmp/requirements.txt
RUN pip install /tmp/common -r /tmp/requirements.txt && rm -rf /tmp/common /tmp/requirements.txt

COPY services/api/app /app/app

RUN useradd --system --uid 10001 --no-create-home appuser
USER appuser

ENV SERVICE_NAME=api
EXPOSE 8000
# Un solo proceso: con varios, los contadores de prometheus_client se reparten entre procesos.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
