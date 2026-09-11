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
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple --upgrade pip
RUN pip install --no-cache-dir torch==2.4.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple \
       "transformers==4.46.3" "sentence-transformers==3.1.1" \
    && pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

# Pre-download the embedding model from HuggingFace mirror (for faster startup)
ENV HF_ENDPOINT=https://hf-mirror.com
ENV EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
RUN python -c "\
from sentence_transformers import SentenceTransformer; \
m = SentenceTransformer('${EMBEDDING_MODEL}'); \
print('Model cached, dimension:', m.get_sentence_embedding_dimension()); \
"

# Copy application code
COPY embedding_server.py .
COPY sandbox_manager.py .

# Create non-root user, copy model cache to user home
RUN useradd -m -s /bin/bash luban \
    && chown -R luban:luban /app \
    && mkdir -p /home/luban/.cache \
    && cp -r /root/.cache/huggingface /home/luban/.cache/ \
    && chown -R luban:luban /home/luban/.cache
USER luban

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8765/health || exit 1

CMD ["python", "embedding_server.py"]