#!/bin/sh
# ============================================================
# Luban Docker Entrypoint (docker-compose 用)
# 密钥优先从环境变量读取，否则自动生成并持久化到 Volume
# ============================================================
set -e

SECRETS_FILE="/app/secrets/luban.env"

# ---------- 加载已持久化的密钥 ----------
if [ -f "$SECRETS_FILE" ]; then
    echo "[entrypoint] 加载持久化密钥: $SECRETS_FILE"
    set -a
    . "$SECRETS_FILE"
    set +a
fi

# ---------- LUBAN_JWT_SECRET ----------
if [ -z "$LUBAN_JWT_SECRET" ] || [ ${#LUBAN_JWT_SECRET} -lt 32 ]; then
    LUBAN_JWT_SECRET=$(openssl rand -hex 32)
    export LUBAN_JWT_SECRET
    echo "[entrypoint] LUBAN_JWT_SECRET 已生成"
else
    echo "[entrypoint] LUBAN_JWT_SECRET 已配置 (${#LUBAN_JWT_SECRET} 字符)"
fi

# ---------- LUBAN_DATASOURCE_SECRET ----------
if [ -z "$LUBAN_DATASOURCE_SECRET" ] || [ ${#LUBAN_DATASOURCE_SECRET} -lt 16 ]; then
    LUBAN_DATASOURCE_SECRET=$(openssl rand -base64 32)
    export LUBAN_DATASOURCE_SECRET
    echo "[entrypoint] LUBAN_DATASOURCE_SECRET 已生成"
else
    echo "[entrypoint] LUBAN_DATASOURCE_SECRET 已配置 (${#LUBAN_DATASOURCE_SECRET} 字符)"
fi

# ---------- LUBAN_RSA_PRIVATE_KEY ----------
if [ -z "$LUBAN_RSA_PRIVATE_KEY" ]; then
    LUBAN_RSA_PRIVATE_KEY=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)
    export LUBAN_RSA_PRIVATE_KEY
    echo "[entrypoint] LUBAN_RSA_PRIVATE_KEY 已生成"
else
    echo "[entrypoint] LUBAN_RSA_PRIVATE_KEY 已配置 (${#LUBAN_RSA_PRIVATE_KEY} 字符)"
fi

# ---------- LUBAN_AGENT_AES_KEY ----------
if [ -z "$LUBAN_AGENT_AES_KEY" ] || [ ${#LUBAN_AGENT_AES_KEY} -lt 16 ]; then
    LUBAN_AGENT_AES_KEY=$(openssl rand -base64 32)
    export LUBAN_AGENT_AES_KEY
    echo "[entrypoint] LUBAN_AGENT_AES_KEY 已生成"
else
    echo "[entrypoint] LUBAN_AGENT_AES_KEY 已配置 (${#LUBAN_AGENT_AES_KEY} 字符)"
fi

# ---------- 持久化密钥到 Volume（下次重启复用） ----------
mkdir -p "$(dirname "$SECRETS_FILE")"
cat > "$SECRETS_FILE" << EOF
LUBAN_JWT_SECRET='${LUBAN_JWT_SECRET}'
LUBAN_DATASOURCE_SECRET='${LUBAN_DATASOURCE_SECRET}'
LUBAN_RSA_PRIVATE_KEY='${LUBAN_RSA_PRIVATE_KEY}'
LUBAN_AGENT_AES_KEY='${LUBAN_AGENT_AES_KEY}'
EOF
echo "[entrypoint] 密钥已持久化到 $SECRETS_FILE"

# ---------- 等待 MySQL 就绪 ----------
MYSQL_HOST="${MYSQL_HOST:-mysql}"
MYSQL_PORT="${MYSQL_PORT:-3306}"

echo "[entrypoint] 检测 MySQL 连接: $MYSQL_HOST:$MYSQL_PORT"
for i in $(seq 1 30); do
    if nc -z "$MYSQL_HOST" "$MYSQL_PORT" 2>/dev/null; then
        echo "[entrypoint] MySQL 已就绪"
        break
    fi
    echo "[entrypoint] 等待 MySQL... ($i/30)"
    sleep 2
done

# ---------- 启动 Spring Boot ----------
echo "[entrypoint] 启动 Luban 后端..."
exec java \
    -Djava.security.egd=file:/dev/./urandom \
    -jar /app/app.jar