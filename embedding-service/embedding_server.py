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


# ---- FAISS Vector Index for Concept Semantic Matching ----

try:
    import faiss
    FAISS_AVAILABLE = True
    print("[Luban Embedding] FAISS is available")
except ImportError:
    FAISS_AVAILABLE = False
    print("[Luban Embedding] FAISS not available, install with: pip install faiss-cpu")

concept_index = None           # faiss.IndexFlatIP
concept_ids = []               # list of concept IDs (strings)
concept_index_dim = None       # dimension of the index


@app.route("/v1/faiss/health", methods=["GET"])
def faiss_health():
    return jsonify({
        "faiss_available": FAISS_AVAILABLE,
        "index_built": concept_index is not None,
        "index_size": len(concept_ids) if concept_ids else 0,
        "dimension": concept_index_dim,
    })


@app.route("/v1/faiss/build", methods=["POST"])
def faiss_build():
    """Build FAISS index from concept embeddings.
    Request: { "concepts": [ { "id": "concept_1", "text": "员工姓名", "embedding": [...] }, ... ] }
    """
    global concept_index, concept_ids, concept_index_dim

    if not FAISS_AVAILABLE:
        return jsonify({"error": "FAISS is not installed"}), 503

    data = request.get_json()
    if not data or "concepts" not in data:
        return jsonify({"error": "Missing 'concepts' field"}), 400

    concepts = data["concepts"]
    if not concepts:
        return jsonify({"error": "Empty concepts list"}), 400

    dim = len(concepts[0]["embedding"])
    concept_index = faiss.IndexFlatIP(dim)  # Inner Product for normalized vectors
    concept_index_dim = dim
    concept_ids = []

    vectors = np.array([c["embedding"] for c in concepts], dtype=np.float32)
    concept_ids = [str(c["id"]) for c in concepts]
    concept_index.add(vectors)

    return jsonify({
        "status": "ok",
        "index_size": concept_index.ntotal,
        "dimension": dim,
    })


@app.route("/v1/faiss/search", methods=["POST"])
def faiss_search():
    """Search similar concepts by text embedding.
    Request: { "embedding": [...], "top_k": 5 }
    Response: { "results": [ { "id": "concept_1", "score": 0.95 }, ... ] }
    """
    if not FAISS_AVAILABLE:
        return jsonify({"error": "FAISS is not installed"}), 503
    if concept_index is None:
        return jsonify({"error": "Index not built yet"}), 503

    data = request.get_json()
    if not data or "embedding" not in data:
        return jsonify({"error": "Missing 'embedding' field"}), 400

    query_vec = np.array([data["embedding"]], dtype=np.float32)
    top_k = min(data.get("top_k", 5), len(concept_ids))

    scores, indices = concept_index.search(query_vec, top_k)

    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx >= 0 and idx < len(concept_ids):
            results.append({
                "id": concept_ids[idx],
                "score": float(score),
            })

    return jsonify({"results": results})


@app.route("/v1/faiss/add", methods=["POST"])
def faiss_add():
    """Add vectors to the existing index.
    Request: { "concepts": [ { "id": "concept_new", "embedding": [...] }, ... ] }
    """
    global concept_index, concept_ids

    if not FAISS_AVAILABLE:
        return jsonify({"error": "FAISS is not installed"}), 503
    if concept_index is None:
        return jsonify({"error": "Index not built yet, use /v1/faiss/build first"}), 503

    data = request.get_json()
    if not data or "concepts" not in data:
        return jsonify({"error": "Missing 'concepts' field"}), 400

    for c in data["concepts"]:
        vec = np.array([c["embedding"]], dtype=np.float32)
        concept_index.add(vec)
        concept_ids.append(str(c["id"]))

    return jsonify({"status": "ok", "index_size": concept_index.ntotal})


@app.route("/v1/faiss/remove", methods=["POST"])
def faiss_remove():
    """Remove concepts from index by IDs. Since FAISS IndexFlatIP doesn't support
    removal, we rebuild the index without the specified IDs.
    Request: { "ids": ["concept_1", "concept_2"] }
    """
    global concept_index, concept_ids

    if not FAISS_AVAILABLE:
        return jsonify({"error": "FAISS is not installed"}), 503
    if concept_index is None:
        return jsonify({"error": "Index not built yet"}), 503

    data = request.get_json()
    remove_ids = set(data.get("ids", []))
    if not remove_ids:
        return jsonify({"error": "Missing 'ids' field"}), 400

    keep_indices = [i for i, cid in enumerate(concept_ids) if cid not in remove_ids]
    if not keep_indices:
        concept_index = None
        concept_ids = []
        return jsonify({"status": "ok", "index_size": 0})

    remaining_vectors = concept_index.reconstruct_n(0, concept_index.ntotal)[keep_indices]
    new_concept_ids = [concept_ids[i] for i in keep_indices]

    dim = remaining_vectors.shape[1]
    new_index = faiss.IndexFlatIP(dim)
    new_index.add(remaining_vectors.astype(np.float32))

    concept_index = new_index
    concept_ids = new_concept_ids

    return jsonify({"status": "ok", "index_size": concept_index.ntotal})


import subprocess
import tempfile
import traceback
import json
from datetime import datetime

PARSE_LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(PARSE_LOG_DIR, exist_ok=True)

def _parse_log(msg):
    """Write a timestamped message to the parse log file."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    log_file = os.path.join(PARSE_LOG_DIR, "parse-file.log")
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(f"[{timestamp}] {msg}\n")
    print(f"[parse-file] {msg}", flush=True)

@app.route("/v1/parse-file", methods=["POST"])
def parse_file():
    """Execute LLM-generated Python code to parse a file and return concepts.
    Request: { "file_path": "/path/to/file.xlsx", "code": "import openpyxl\\n..." }
    Response: { "concepts": [ { "name": "...", "description": "...", ... }, ... ] }
    """
    _parse_log("=" * 60)
    _parse_log("NEW PARSE REQUEST")

    data = request.get_json()
    if not data or "file_path" not in data or "code" not in data:
        _parse_log("ERROR: Missing 'file_path' or 'code' field")
        return jsonify({"error": "Missing 'file_path' or 'code' field"}), 400

    file_path = data["file_path"]
    code = data["code"]

    _parse_log(f"file_path: {file_path}")
    _parse_log(f"file_exists: {os.path.exists(file_path)}")
    if os.path.exists(file_path):
        _parse_log(f"file_size: {os.path.getsize(file_path)} bytes")
    _parse_log(f"code_length: {len(code)} chars")
    _parse_log(f"code (first 300 chars): {code[:300]}")

    if not os.path.exists(file_path):
        _parse_log(f"ERROR: File not found: {file_path}")
        return jsonify({"error": f"File not found: {file_path}"}), 400

    try:
        script = (
            "import sys, json, traceback\n"
            "_IMPORT_FILE_PATH = " + json.dumps(file_path) + "\n"
            "FILE_PATH = _IMPORT_FILE_PATH\n"
            "try:\n"
            + "\n".join("    " + line for line in code.split("\n")) +
            "\n"
            "except Exception as e:\n"
            "    print(json.dumps({'error': str(e), 'traceback': traceback.format_exc()}), file=sys.stderr)\n"
            "    sys.exit(1)\n"
        )

        _parse_log(f"script_length: {len(script)} chars")

        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write(script)
            script_path = f.name
        _parse_log(f"script_path: {script_path}")

        _parse_log("executing: python3 " + script_path)
        t0 = datetime.now()
        proc = subprocess.run(
            ["python3", script_path],
            capture_output=True,
            text=True,
            timeout=60,
        )
        elapsed = (datetime.now() - t0).total_seconds()
        _parse_log(f"execution_time: {elapsed:.2f}s")
        _parse_log(f"returncode: {proc.returncode}")
        _parse_log(f"stdout_length: {len(proc.stdout)} chars")
        _parse_log(f"stderr_length: {len(proc.stderr)} chars")

        os.unlink(script_path)
        _parse_log(f"script_cleaned: {script_path}")

        if proc.returncode != 0:
            _parse_log(f"ERROR: Python execution failed")
            _parse_log(f"stderr (last 2000 chars):\n{proc.stderr[-2000:]}")
            if proc.stdout:
                _parse_log(f"stdout (last 1000 chars):\n{proc.stdout[-1000:]}")
            return jsonify({
                "error": "Python execution failed",
                "stderr": proc.stderr[-2000:],
            }), 500

        stdout_trimmed = proc.stdout.strip()
        _parse_log(f"stdout_trimmed (first 500 chars): {stdout_trimmed[:500]}")

        try:
            result = json.loads(stdout_trimmed)
        except json.JSONDecodeError as e:
            _parse_log(f"ERROR: JSON decode failed: {e}")
            _parse_log(f"stdout (first 2000 chars):\n{proc.stdout[:2000]}")
            return jsonify({
                "error": f"Failed to parse JSON output: {e}",
                "stdout": proc.stdout[:1000],
            }), 500

        if not isinstance(result, list):
            _parse_log(f"ERROR: Result is not a list, type={type(result).__name__}")
            _parse_log(f"result: {str(result)[:500]}")
            return jsonify({"error": "Code must return a JSON array", "output": str(result)[:500]}), 500

        _parse_log(f"SUCCESS: {len(result)} concepts extracted")
        for i, item in enumerate(result[:20]):
            _parse_log(f"  [{i+1}] name={item.get('name')}, description={item.get('description')}, parentName={item.get('parentName')}")
        if len(result) > 20:
            _parse_log(f"  ... and {len(result) - 20} more concepts")

        return jsonify({"concepts": result})

    except subprocess.TimeoutExpired:
        _parse_log("ERROR: Python execution timed out (60s)")
        return jsonify({"error": "Python execution timed out (60s)"}), 500
    except Exception as e:
        _parse_log(f"ERROR: Unexpected exception: {e}")
        _parse_log(f"traceback:\n{traceback.format_exc()}")
        return jsonify({"error": f"Execution error: {e}"}), 500


if __name__ == "__main__":
    load_model()
    port = int(os.environ.get("EMBEDDING_PORT", 8765))
    print(f"[Luban Embedding] Starting server on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)