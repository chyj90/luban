#!/bin/bash
# ============================================================
# Luban 后端启动脚本
# 自动注入 LUBAN_JWT_SECRET / LUBAN_DATASOURCE_SECRET 环境变量
# 密钥自动持久化到 backend/.env，重启后登录态不丢失
# 使用方式：
#   ./start.sh          前台启动（默认）
#   ./start.sh -d       后台启动（日志输出到 logs/backend.log）
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/backend.log"
PID_FILE="$LOG_DIR/backend.pid"
SELF_PID_FILE="$LOG_DIR/start.sh.pid"

DAEMON=false
if [ "${1:-}" = "-d" ]; then
    DAEMON=true
fi

mkdir -p "$LOG_DIR"

# ---------- 0. 杀掉旧的 start.sh 自身 ----------
if [ -f "$SELF_PID_FILE" ]; then
    OLD_SELF_PID="$(cat "$SELF_PID_FILE")"
    if [ "$OLD_SELF_PID" != "$$" ] && kill -0 "$OLD_SELF_PID" 2>/dev/null; then
        echo "[start.sh] 杀掉旧的 start.sh 进程 (pid=$OLD_SELF_PID)"
        kill "$OLD_SELF_PID" 2>/dev/null || true
        sleep 1
        kill -9 "$OLD_SELF_PID" 2>/dev/null || true
    fi
fi
echo $$ > "$SELF_PID_FILE"

# ---------- 加载已持久化的密钥 ----------
if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
    echo "[start.sh] 已加载 $ENV_FILE"
fi

# ---------- LUBAN_JWT_SECRET ----------
if [ -z "$LUBAN_JWT_SECRET" ] || [ ${#LUBAN_JWT_SECRET} -lt 32 ]; then
    LUBAN_JWT_SECRET=$(openssl rand -hex 32)
    export LUBAN_JWT_SECRET
    echo "[start.sh] LUBAN_JWT_SECRET 未配置或过短，已生成随机密钥"
else
    export LUBAN_JWT_SECRET
    echo "[start.sh] LUBAN_JWT_SECRET 已配置 (${#LUBAN_JWT_SECRET} 字符)"
fi

# ---------- LUBAN_DATASOURCE_SECRET ----------
if [ -z "$LUBAN_DATASOURCE_SECRET" ] || [ ${#LUBAN_DATASOURCE_SECRET} -lt 16 ]; then
    LUBAN_DATASOURCE_SECRET=$(openssl rand -base64 32)
    export LUBAN_DATASOURCE_SECRET
    echo "[start.sh] LUBAN_DATASOURCE_SECRET 未配置或过短，已生成随机密钥 (Base64)"
else
    export LUBAN_DATASOURCE_SECRET
    echo "[start.sh] LUBAN_DATASOURCE_SECRET 已配置 (${#LUBAN_DATASOURCE_SECRET} 字符)"
fi

# ---------- LUBAN_RSA_PRIVATE_KEY ----------
RSA_KEY_FILE="$SCRIPT_DIR/.rsa_key.pem"
if [ -f "$RSA_KEY_FILE" ]; then
    LUBAN_RSA_PRIVATE_KEY=$(cat "$RSA_KEY_FILE")
    export LUBAN_RSA_PRIVATE_KEY
    echo "[start.sh] LUBAN_RSA_PRIVATE_KEY 已从 $RSA_KEY_FILE 加载"
else
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$RSA_KEY_FILE" 2>/dev/null
    LUBAN_RSA_PRIVATE_KEY=$(cat "$RSA_KEY_FILE")
    export LUBAN_RSA_PRIVATE_KEY
    echo "[start.sh] LUBAN_RSA_PRIVATE_KEY 未配置，已生成并保存到 $RSA_KEY_FILE"
fi

# ---------- LUBAN_AGENT_AES_KEY ----------
if [ -z "$LUBAN_AGENT_AES_KEY" ] || [ ${#LUBAN_AGENT_AES_KEY} -lt 16 ]; then
    LUBAN_AGENT_AES_KEY=$(openssl rand -base64 32)
    export LUBAN_AGENT_AES_KEY
    echo "[start.sh] LUBAN_AGENT_AES_KEY 未配置或过短，已生成随机密钥"
else
    export LUBAN_AGENT_AES_KEY
    echo "[start.sh] LUBAN_AGENT_AES_KEY 已配置 (${#LUBAN_AGENT_AES_KEY} 字符)"
fi

# ---------- 持久化到 .env ----------
cat > "$ENV_FILE" << EOF
# Luban 环境变量（由 start.sh 自动生成，请勿提交到 Git）
LUBAN_JWT_SECRET=$LUBAN_JWT_SECRET
LUBAN_DATASOURCE_SECRET=$LUBAN_DATASOURCE_SECRET
LUBAN_AGENT_AES_KEY=$LUBAN_AGENT_AES_KEY
EOF
echo "[start.sh] 密钥已写入 $ENV_FILE"

mkdir -p "$SCRIPT_DIR/config"
cp "$RSA_KEY_FILE" "$SCRIPT_DIR/config/rsa-private.pem"
echo "[start.sh] RSA 私钥已复制到 config/rsa-private.pem"

# ---------- 停掉旧的后端进程 ----------
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    OLD_PID="$(cat "$PID_FILE")"
    echo "[start.sh] 停止旧后端进程 (pid=$OLD_PID)"
    kill "$OLD_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
        kill -0 "$OLD_PID" 2>/dev/null || break
        sleep 0.5
    done
    kill -9 "$OLD_PID" 2>/dev/null || true
fi
rm -f "$PID_FILE"

# ---------- 启动 ----------
cd "$SCRIPT_DIR"

if [ "$DAEMON" = true ]; then
    echo "[start.sh] 后台启动 Luban（日志: $LOG_FILE）"
    nohup mvn spring-boot:run >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "[start.sh] 后端 pid=$(cat "$PID_FILE")"

    echo "[start.sh] 等待服务就绪（每 5s 输出日志尾部）..."
    LAST_LINES=0
    for i in $(seq 1 60); do
        if curl -fsS "http://127.0.0.1:8080/api/v1/security/public-key" >/dev/null 2>&1; then
            echo "[start.sh] 服务已就绪: http://127.0.0.1:8080"
            exit 0
        fi
        if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            echo "[start.sh] 错误: 进程已退出，日志最后 20 行:" >&2
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
    echo "[start.sh] 警告: 300s 内未就绪，服务仍在后台启动，请观察日志: $LOG_FILE"
else
    echo "[start.sh] 前台启动 Luban..."
    exec mvn spring-boot:run
fi