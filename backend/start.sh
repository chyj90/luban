#!/bin/bash
# ============================================================
# Luban 后端启动脚本
# 自动注入 LUBAN_JWT_SECRET / LUBAN_DATASOURCE_SECRET 环境变量
# 密钥自动持久化到 backend/.env，重启后登录态不丢失
# 使用方式：./start.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

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
# CryptoUtil 要求 Base64 编码的 32 字节密钥，用 openssl rand -base64 32 生成
if [ -z "$LUBAN_DATASOURCE_SECRET" ] || [ ${#LUBAN_DATASOURCE_SECRET} -lt 16 ]; then
    LUBAN_DATASOURCE_SECRET=$(openssl rand -base64 32)
    export LUBAN_DATASOURCE_SECRET
    echo "[start.sh] LUBAN_DATASOURCE_SECRET 未配置或过短，已生成随机密钥 (Base64)"
else
    export LUBAN_DATASOURCE_SECRET
    echo "[start.sh] LUBAN_DATASOURCE_SECRET 已配置 (${#LUBAN_DATASOURCE_SECRET} 字符)"
fi

# ---------- LUBAN_RSA_PRIVATE_KEY ----------
# RSA 私钥用于传输层信封加密（数据源密码等敏感字段），持久化到文件避免重启后失效
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

# ---------- 持久化到 .env（默认开启） ----------
# 注意：RSA 私钥含多行，不能写入 .env（source 会解析失败），改用文件持久化
cat > "$ENV_FILE" << EOF
# Luban 环境变量（由 start.sh 自动生成，请勿提交到 Git）
LUBAN_JWT_SECRET=$LUBAN_JWT_SECRET
LUBAN_DATASOURCE_SECRET=$LUBAN_DATASOURCE_SECRET
EOF
echo "[start.sh] 密钥已写入 $ENV_FILE"

# 同时复制到 config/rsa-private.pem 供 IDE 直接启动时使用
mkdir -p "$SCRIPT_DIR/config"
cp "$RSA_KEY_FILE" "$SCRIPT_DIR/config/rsa-private.pem"
echo "[start.sh] RSA 私钥已复制到 config/rsa-private.pem"

# ---------- 启动 ----------
echo "[start.sh] 正在编译并启动 Luban..."
cd "$SCRIPT_DIR"
exec mvn spring-boot:run