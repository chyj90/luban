"""
Luban Embedding Service
使用 sentence-transformers + BGE-small-zh-v1.5 提供向量嵌入 API
优先通过 ModelScope（国内）下载模型，失败则回退 HuggingFace

启动: pip install -r requirements.txt && python embedding_server.py
默认端口: 8765
"""

import os
import shutil
from pathlib import Path

_env_dir = Path(__file__).parent
_env_file = _env_dir / ".env"
_env_example = _env_dir / ".env.example"
if not _env_file.exists() and _env_example.exists():
    shutil.copy2(_env_example, _env_file)
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip())

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

    # 优先使用本地缓存（Docker 镜像已预下载），避免每次启动都尝试联网下载
    try:
        model = SentenceTransformer(MODEL_NAME, local_files_only=True)
        print(f"[Luban Embedding] Model loaded from local cache")
    except Exception:
        print(f"[Luban Embedding] Local cache miss, trying to download...")
        model_dir = _try_modelscope_download()
        if model_dir:
            print(f"[Luban Embedding] Loading model from ModelScope: {model_dir}")
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

column_index = None            # faiss.IndexFlatIP for column-level search
column_ids = []                # list of "tableName.columnName" (strings)
column_index_dim = None        # dimension of the column index
column_index_built_for = None  # datasource_id that the column index was built for


@app.route("/v1/faiss/health", methods=["GET"])
def faiss_health():
    return jsonify({
        "faiss_available": FAISS_AVAILABLE,
        "index_built": concept_index is not None,
        "index_size": len(concept_ids) if concept_ids else 0,
        "dimension": concept_index_dim,
        "column_index_built": column_index is not None,
        "column_index_size": len(column_ids) if column_ids else 0,
        "column_index_dim": column_index_dim,
        "column_index_built_for": column_index_built_for,
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


# ---- Column-level FAISS Index for Datasource Structure Pruning ----

@app.route("/v1/faiss/build-column-index", methods=["POST"])
def faiss_build_column_index():
    """Build column-level FAISS index from datasource structure.
    Request: {
        "datasource_id": "ds_1",
        "columns": [ { "id": "ACDOCA.HSL", "text": "金额", "embedding": [...] }, ... ]
    }
    """
    global column_index, column_ids, column_index_dim, column_index_built_for

    if not FAISS_AVAILABLE:
        return jsonify({"error": "FAISS is not installed"}), 503

    data = request.get_json()
    if not data or "columns" not in data or "datasource_id" not in data:
        return jsonify({"error": "Missing 'columns' or 'datasource_id' field"}), 400

    ds_id = data["datasource_id"]
    columns = data["columns"]
    if not columns:
        return jsonify({"error": "Empty columns list"}), 400

    dim = len(columns[0]["embedding"])
    column_index = faiss.IndexFlatIP(dim)
    column_index_dim = dim
    column_ids = []
    column_index_built_for = ds_id

    vectors = np.array([c["embedding"] for c in columns], dtype=np.float32)
    column_ids = [str(c["id"]) for c in columns]
    column_index.add(vectors)

    return jsonify({
        "status": "ok",
        "datasource_id": ds_id,
        "index_size": column_index.ntotal,
        "dimension": dim,
    })


@app.route("/v1/faiss/search-columns", methods=["POST"])
def faiss_search_columns():
    """Search similar columns by embedding.
    Request: { "embedding": [...], "top_k": 30 }
    Response: { "results": [ { "id": "ACDOCA.HSL", "score": 0.95 }, ... ] }
    """
    if not FAISS_AVAILABLE:
        return jsonify({"error": "FAISS is not installed"}), 503
    if column_index is None:
        return jsonify({"error": "Column index not built yet"}), 503

    data = request.get_json()
    if not data or "embedding" not in data:
        return jsonify({"error": "Missing 'embedding' field"}), 400

    query_vec = np.array([data["embedding"]], dtype=np.float32)
    top_k = min(data.get("top_k", 30), len(column_ids))

    scores, indices = column_index.search(query_vec, top_k)

    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx >= 0 and idx < len(column_ids):
            results.append({
                "id": column_ids[idx],
                "score": float(score),
            })

    return jsonify({"results": results})


@app.route("/v1/faiss/column-index-status", methods=["GET"])
def faiss_column_index_status():
    """Check if column index is built for a specific datasource.
    Query param: ?datasource_id=ds_1
    """
    ds_id = request.args.get("datasource_id")
    return jsonify({
        "built": column_index is not None and column_index_built_for == ds_id,
        "datasource_id": ds_id,
        "built_for": column_index_built_for,
        "index_size": len(column_ids) if column_ids else 0,
    })


import subprocess
import tempfile
import traceback
import json
import shutil
from datetime import datetime

from sandbox_manager import sandbox_pool, SANDBOX_ENABLED

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

        if SANDBOX_ENABLED:
            container = sandbox_pool.acquire(timeout=10)
            try:
                host_script = os.path.join(container.mount_dir, "parse.py")
                shutil.copy2(script_path, host_script)
                exec_result = container.execute(host_script, timeout=60)
            finally:
                sandbox_pool.release(container)
            os.unlink(script_path)
            _parse_log(f"script_cleaned: {script_path}")

            elapsed = (datetime.now() - t0).total_seconds()
            _parse_log(f"execution_time: {elapsed:.2f}s (sandbox)")

            success = exec_result.get("success", False)
            stdout_text = exec_result.get("stdout", "")
            stderr_text = exec_result.get("stderr", "")

            if not success:
                _parse_log(f"ERROR: Python execution failed (sandbox)")
                _parse_log(f"stderr (last 2000 chars):\n{stderr_text[-2000:]}")
                return jsonify({
                    "error": "Python execution failed",
                    "stderr": stderr_text[-2000:],
                }), 500

            stdout_trimmed = stdout_text.strip()
        else:
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
            _parse_log(f"stdout (first 2000 chars):\n{stdout_trimmed[:2000]}")
            return jsonify({
                "error": f"Failed to parse JSON output: {e}",
                "stdout": stdout_trimmed[:1000],
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


@app.route("/v1/execute-code", methods=["POST"])
def execute_code():
    """Execute LLM-generated Python code for data analysis.
    Request: { "code": "import pandas as pd\\n...", "input_data": { "sql": "SELECT ...", "concept_ids": [1, 2] } }
    Response: { "stdout": "...", "stderr": "...", "success": true }
    The SQL result is passed as a JSON string via INPUT_DATA environment variable.
    """
    data = request.get_json()
    if not data or "code" not in data:
        return jsonify({"error": "Missing 'code' field"}), 400

    code = data["code"]
    input_data = data.get("input_data", {})
    timeout = min(data.get("timeout", 30), 120)

    script = (
        "import sys, json, traceback, os\n"
        "import pandas as pd\n"
        "import numpy as np\n"
        "_INPUT_DATA = json.loads(os.environ.get('INPUT_DATA', '{}'))\n"
        "try:\n"
        + "\n".join("    " + line for line in code.split("\n")) +
        "\n"
        "except Exception as e:\n"
        "    print(json.dumps({'error': str(e), 'traceback': traceback.format_exc()}), file=sys.stderr)\n"
        "    sys.exit(1)\n"
    )

    try:
        env = {"INPUT_DATA": json.dumps(input_data)}

        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write(script)
            script_path = f.name

        if SANDBOX_ENABLED:
            container = sandbox_pool.acquire(timeout=10)
            try:
                host_script = os.path.join(container.mount_dir, "execute.py")
                shutil.copy2(script_path, host_script)
                result = container.execute(host_script, env=env, timeout=timeout)
            finally:
                sandbox_pool.release(container)
            os.unlink(script_path)
            return jsonify(result)
        else:
            full_env = os.environ.copy()
            full_env.update(env)
            proc = subprocess.run(
                ["python3", script_path],
                capture_output=True,
                text=True,
                timeout=timeout,
                env=full_env,
            )
            os.unlink(script_path)
            return jsonify({
                "success": proc.returncode == 0,
                "stdout": proc.stdout[-5000:] if proc.stdout else "",
                "stderr": proc.stderr[-2000:] if proc.stderr else "",
                "exit_code": proc.returncode,
            })

    except subprocess.TimeoutExpired:
        return jsonify({"error": f"Code execution timed out ({timeout}s)", "success": False}), 500
    except RuntimeError as e:
        return jsonify({"error": str(e), "success": False}), 503
    except Exception as e:
        return jsonify({"error": f"Execution error: {e}", "success": False}), 500


@app.route("/v1/execute-script", methods=["POST"])
def execute_script():
    """Execute an algorithm script file in the sandbox.
    Request: { "script_path": "/path/to/script.py", "input_data": {...}, "timeout": 30 }
    Response: { "stdout": "...", "stderr": "...", "success": true }
    """
    data = request.get_json()
    if not data or "script_path" not in data:
        return jsonify({"error": "Missing 'script_path' field"}), 400

    script_path = data["script_path"]
    input_data = data.get("input_data", {})
    timeout = min(data.get("timeout", 30), 120)

    if not os.path.exists(script_path):
        return jsonify({"error": f"Script not found: {script_path}", "success": False}), 404

    try:
        input_json = json.dumps(input_data)
        env = {"INPUT_DATA": input_json}

        if SANDBOX_ENABLED:
            container = sandbox_pool.acquire(timeout=10)
            try:
                host_script = os.path.join(container.mount_dir, "algorithm.py")
                shutil.copy2(script_path, host_script)
                result = container.execute(host_script, env=env, stdin_data=input_json, timeout=timeout)
            finally:
                sandbox_pool.release(container)
            return jsonify(result)
        else:
            full_env = os.environ.copy()
            full_env.update(env)
            proc = subprocess.run(
                ["python3", script_path],
                capture_output=True,
                text=True,
                input=input_json,
                timeout=timeout,
                env=full_env,
            )
            return jsonify({
                "success": proc.returncode == 0,
                "stdout": proc.stdout[-5000:] if proc.stdout else "",
                "stderr": proc.stderr[-2000:] if proc.stderr else "",
                "exit_code": proc.returncode,
            })

    except subprocess.TimeoutExpired:
        return jsonify({"error": f"Script execution timed out ({timeout}s)", "success": False}), 500
    except RuntimeError as e:
        return jsonify({"error": str(e), "success": False}), 503
    except Exception as e:
        return jsonify({"error": f"Execution error: {e}", "success": False}), 500


@app.route("/v1/check-syntax", methods=["POST"])
def check_syntax():
    """Check Python syntax of a script file using py_compile.
    Request: { "script_path": "/path/to/script.py" }
    Response: { "syntax_valid": true } or { "syntax_valid": false, "error": "..." }
    """
    data = request.get_json()
    if not data or "script_path" not in data:
        return jsonify({"error": "Missing 'script_path' field"}), 400

    script_path = data["script_path"]
    if not os.path.exists(script_path):
        return jsonify({"syntax_valid": False, "error": f"Script not found: {script_path}"})

    try:
        proc = subprocess.run(
            ["python3", "-c", f"import py_compile; py_compile.compile('{script_path}', doraise=True)"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if proc.returncode == 0:
            return jsonify({"syntax_valid": True})
        else:
            return jsonify({"syntax_valid": False, "error": proc.stderr[-500:] if proc.stderr else "Unknown syntax error"})
    except Exception as e:
        return jsonify({"syntax_valid": False, "error": str(e)})


if __name__ == "__main__":
    try:
        load_model()
    except Exception as e:
        print(f"[Luban Embedding] FATAL: Failed to load model: {e}", flush=True)
        import traceback
        traceback.print_exc()
        import sys
        sys.exit(1)
    if SANDBOX_ENABLED:
        sandbox_pool.start()
    port = int(os.environ.get("EMBEDDING_PORT", 8765))
    print(f"[Luban Embedding] Starting server on port {port} (sandbox={'ON' if SANDBOX_ENABLED else 'OFF'})")
    app.run(host="0.0.0.0", port=port, debug=False)