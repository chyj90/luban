#!/bin/sh
# ============================================================
# Luban Docker Entrypoint
# 自动生成并持久化密钥，确保重启后登录态不丢失
# ============================================================

set -e

# ---------- LUBAN_JWT_SECRET ----------
if [ -z "$LUBAN_JWT_SECRET" ] || [ ${#LUBAN_JWT_SECRET} -lt 32 ]; then
    LUBAN_JWT_SECRET=$(openssl rand -hex 32)
    export LUBAN_JWT_SECRET
    echo "[entrypoint] LUBAN_JWT_SECRET 未配置，已生成随机密钥"
else
    echo "[entrypoint] LUBAN_JWT_SECRET 已配置 (${#LUBAN_JWT_SECRET} 字符)"
fi

# ---------- LUBAN_DATASOURCE_SECRET ----------
if [ -z "$LUBAN_DATASOURCE_SECRET" ] || [ ${#LUBAN_DATASOURCE_SECRET} -lt 16 ]; then
    LUBAN_DATASOURCE_SECRET=$(openssl rand -base64 32)
    export LUBAN_DATASOURCE_SECRET
    echo "[entrypoint] LUBAN_DATASOURCE_SECRET 未配置，已生成随机密钥"
else
    echo "[entrypoint] LUBAN_DATASOURCE_SECRET 已配置 (${#LUBAN_DATASOURCE_SECRET} 字符)"
fi

# ---------- LUBAN_RSA_PRIVATE_KEY ----------
if [ -z "$LUBAN_RSA_PRIVATE_KEY" ]; then
    LUBAN_RSA_PRIVATE_KEY=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)
    export LUBAN_RSA_PRIVATE_KEY
    echo "[entrypoint] LUBAN_RSA_PRIVATE_KEY 未配置，已生成随机密钥"
else
    echo "[entrypoint] LUBAN_RSA_PRIVATE_KEY 已配置 (${#LUBAN_RSA_PRIVATE_KEY} 字符)"
fi

# ---------- 等待 MySQL 就绪（docker-compose depends_on 已保证顺序，此处为额外保险） ----------
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