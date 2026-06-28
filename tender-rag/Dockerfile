FROM python:3.11-slim

WORKDIR /app

RUN set -eux; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-rus \
        tesseract-ocr-kaz \
        antiword \
        catdoc \
    || apt-get install -y --no-install-recommends \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-rus \
        antiword \
        catdoc; \
    rm -rf /var/lib/apt/lists/*

# CPU-only torch (smaller image than default CUDA wheel)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Запекаем модель эмбеддингов в образ, чтобы рантайм не качал ~470MB весов с
# HF Hub на первом запросе (это вызывало зависания index-document и таймауты).
# Кэш кладётся в /opt/hf-cache и при старте используется в offline-режиме.
ARG EMBEDDING_MODEL=intfloat/multilingual-e5-small
ENV HF_HOME=/opt/hf-cache
RUN mkdir -p /opt/hf-cache \
    && (python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBEDDING_MODEL}')" \
        || echo "Embedding model predownload failed; runtime will use hashing fallback if the model is unavailable.") \
    && find /opt/hf-cache -name '*.incomplete' -delete

COPY app ./app
COPY db ./db
COPY scripts ./scripts

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8083}"]
