#!/bin/bash
# ============================================================
# Luban Embedding 服务启动脚本（宿主机部署）
# 每次启动前重新构建 sandbox 镜像并清理旧沙箱容器，
# 保证 /v1/execute-code 等沙箱执行用的是最新代码。
# 可用环境变量覆盖:
#   EMBEDDING_PORT=8765          服务端口
#   SANDBOX_ENABLED=true|false   是否启用沙箱池（默认 true）
#   PYTHON_BIN=python3           Python 解释器
# 用法:
#   ./start.sh          前台启动（卡在终端）
#   ./start.sh -d       后台启动（日志输出到 logs/server.log）
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/server.log"
PID_FILE="$LOG_DIR/embedding.pid"
SELF_PID_FILE="$LOG_DIR/start.sh.pid"

PYTHON_BIN="${PYTHON_BIN:-python3}"
PORT="${EMBEDDING_PORT:-8765}"
SANDBOX_ENABLED="${SANDBOX_ENABLED:-true}"

DAEMON=false
if [ "${1:-}" = "-d" ]; then
    DAEMON=true
fi

mkdir -p "$LOG_DIR"
cd "$SCRIPT_DIR"

# ---------- 0. 杀掉旧的 start.sh 自身 ----------
if [ -f "$SELF_PID_FILE" ]; then
    OLD_SELF_PID="$(cat "$SELF_PID_FILE")"
    if [ "$OLD_SELF_PID" != "$$" ] && kill -0 "$OLD_SELF_PID" 2>/dev/null; then
        echo "[start] 杀掉旧的 start.sh 进程 (pid=$OLD_SELF_PID)"
        kill "$OLD_SELF_PID" 2>/dev/null || true
        sleep 1
        kill -9 "$OLD_SELF_PID" 2>/dev/null || true
    fi
fi
echo $$ > "$SELF_PID_FILE"

# ---------- 1. 重新构建 sandbox 镜像 ----------
echo "[start] 构建 sandbox 镜像: luban-sandbox:latest"
docker build -f Dockerfile.sandbox -t luban-sandbox:latest .

# ---------- 2. 清理旧沙箱容器 ----------
STALE=$(docker ps -aq --filter "name=luban-sandbox-")
if [ -n "$STALE" ]; then
    echo "[start] 清理旧沙箱容器: $(echo "$STALE" | wc -l | tr -d ' ') 个"
    docker rm -f $STALE >/dev/null
fi

# ---------- 3. 停掉旧的服务进程 ----------
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    OLD_PID="$(cat "$PID_FILE")"
    echo "[start] 停止旧进程 (pid=$OLD_PID)"
    kill "$OLD_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
        kill -0 "$OLD_PID" 2>/dev/null || break
        sleep 0.5
    done
    kill -9 "$OLD_PID" 2>/dev/null || true
fi
rm -f "$PID_FILE"

# ---------- 4. 依赖检查 ----------
if "$PYTHON_BIN" -c "import flask, numpy, sentence_transformers, faiss, modelscope, openpyxl, pandas, yaml, rdflib" >/dev/null 2>&1; then
    echo "[start] Python 依赖检查通过"
else
    echo "[start] 检测到缺失依赖，安装 requirements.txt ..."
    "$PYTHON_BIN" -m pip install -r "$SCRIPT_DIR/requirements.txt"
fi

# ---------- 5. 启动 ----------
echo "[start] 启动 embedding 服务 (port=$PORT, sandbox=$SANDBOX_ENABLED)"

if [ "$DAEMON" = true ]; then
    SANDBOX_ENABLED="$SANDBOX_ENABLED" EMBEDDING_PORT="$PORT" \
        nohup "$PYTHON_BIN" embedding_server.py >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "[start] 后台启动，pid=$(cat "$PID_FILE")，日志: $LOG_FILE"
else
    SANDBOX_ENABLED="$SANDBOX_ENABLED" EMBEDDING_PORT="$PORT" \
        "$PYTHON_BIN" embedding_server.py 2>&1 | tee "$LOG_FILE" &
    echo $! > "$PID_FILE"
    echo "[start] 前台启动，pid=$(cat "$PID_FILE")，日志: $LOG_FILE"
    wait "$(cat "$PID_FILE")"
    exit $?
fi

# ---------- 6. 等待服务就绪（仅后台模式） ----------
echo "[start] 等待服务就绪（每 5s 输出日志尾部，首次加载模型可能较慢）..."
LAST_LINES=0
for i in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
        echo "[start] 服务已就绪: http://127.0.0.1:$PORT"
        echo "[start] 沙箱健康检查: http://127.0.0.1:$PORT/v1/sandbox/health"
        exit 0
    fi
    if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "[start] 错误: 进程已退出，日志最后 20 行:" >&2
        tail -20 "$LOG_FILE" >&2
        exit 1
    fi
    CURRENT_LINES=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$CURRENT_LINES" -gt "$LAST_LINES" ]; then
        echo "--- [$(date '+%H:%M:%S')] 日志新输出 ---"
        tail -5 "$LOG_FILE"
        LAST_LINES=$CURRENT_LINES
    fi
    sleep 5
done

echo "[start] 警告: 600s 内未就绪，服务仍在后台加载，请观察日志: $LOG_FILE"