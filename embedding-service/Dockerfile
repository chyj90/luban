# ============================================================
# Luban Embedding Service
# ============================================================
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the embedding model from HuggingFace mirror (for faster startup)
ENV HF_ENDPOINT=https://hf-mirror.com
ENV EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBEDDING_MODEL}')" || true

# Copy application code
COPY embedding_server.py .
COPY sandbox_manager.py .

# Create non-root user
RUN useradd -m -s /bin/bash luban && chown -R luban:luban /app
USER luban

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8765/health || exit 1

CMD ["python", "embedding_server.py"]