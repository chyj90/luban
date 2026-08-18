"""
Luban Embedding Service
使用 sentence-transformers + BGE-small-zh-v1.5 提供向量嵌入 API
优先通过 ModelScope（国内）下载模型，失败则回退 HuggingFace

启动: pip install -r requirements.txt && python embedding_server.py
默认端口: 8765
"""

import os
import numpy as np
from flask import Flask, request, jsonify

app = Flask(__name__)

MODEL_NAME = os.environ.get("EMBEDDING_MODEL", "BAAI/bge-small-zh-v1.5")
HUGGINGFACE_MIRROR = os.environ.get("HF_ENDPOINT", "https://hf-mirror.com")

os.environ["HF_ENDPOINT"] = HUGGINGFACE_MIRROR

model = None

def load_model():
    global model
    from sentence_transformers import SentenceTransformer

    model_dir = _try_modelscope_download()
    if model_dir:
        print(f"[Luban Embedding] Loading model from local: {model_dir}")
        model = SentenceTransformer(model_dir)
    else:
        print(f"[Luban Embedding] ModelScope failed, trying HuggingFace via {HUGGINGFACE_MIRROR}")
        model = SentenceTransformer(MODEL_NAME)

    dim = model.get_sentence_embedding_dimension()
    print(f"[Luban Embedding] Model loaded, dimension: {dim}")


def _try_modelscope_download():
    """通过 ModelScope 下载模型，返回本地路径；失败返回 None"""
    try:
        from modelscope import snapshot_download
        print(f"[Luban Embedding] Downloading {MODEL_NAME} from ModelScope...")
        model_dir = snapshot_download(MODEL_NAME)
        print(f"[Luban Embedding] Downloaded to: {model_dir}")
        return model_dir
    except Exception as e:
        print(f"[Luban Embedding] ModelScope download failed: {e}")
        return None


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": MODEL_NAME, "loaded": model is not None})


@app.route("/v1/embeddings", methods=["POST"])
def embeddings():
    if model is None:
        return jsonify({"error": "Model not loaded yet"}), 503

    data = request.get_json()
    if not data or "input" not in data:
        return jsonify({"error": "Missing 'input' field"}), 400

    texts = data["input"]
    if isinstance(texts, str):
        texts = [texts]

    embeddings = model.encode(texts, normalize_embeddings=True)

    result = [
        {
            "object": "embedding",
            "index": i,
            "embedding": emb.tolist() if isinstance(emb, np.ndarray) else emb,
        }
        for i, emb in enumerate(embeddings)
    ]

    return jsonify({
        "object": "list",
        "data": result,
        "model": MODEL_NAME,
        "usage": {"prompt_tokens": sum(len(t) for t in texts), "total_tokens": sum(len(t) for t in texts)},
    })


if __name__ == "__main__":
    load_model()
    port = int(os.environ.get("EMBEDDING_PORT", 8765))
    print(f"[Luban Embedding] Starting server on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)