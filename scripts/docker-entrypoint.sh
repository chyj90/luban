#!/bin/bash
# ============================================================
# Luban All-in-One Docker Entrypoint
# 密钥优先从环境变量读取，否则自动生成并持久化
# 初始化 MySQL → 启动所有服务
# ============================================================
set -e

MYSQL_DATA_DIR="/app/data/mysql"
MYSQL_SOCKET="/var/run/mysqld/mysqld.sock"
SECRETS_FILE="/app/data/.luban-secrets"

# ---------- 环境变量默认值 ----------
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-luban123}"
MYSQL_DATABASE="${MYSQL_DATABASE:-luban}"

# ---------- 加载已持久化的密钥 ----------
if [ -f "$SECRETS_FILE" ]; then
    echo "[entry] 加载持久化密钥: $SECRETS_FILE"
    set -a
    source "$SECRETS_FILE"
    set +a
fi

# ---------- 生成/校验安全密钥 ----------
if [ -z "$LUBAN_JWT_SECRET" ] || [ ${#LUBAN_JWT_SECRET} -lt 32 ]; then
    export LUBAN_JWT_SECRET=$(openssl rand -hex 32)
    echo "[entry] LUBAN_JWT_SECRET 已生成"
fi
if [ -z "$LUBAN_DATASOURCE_SECRET" ] || [ ${#LUBAN_DATASOURCE_SECRET} -lt 16 ]; then
    export LUBAN_DATASOURCE_SECRET=$(openssl rand -base64 32)
    echo "[entry] LUBAN_DATASOURCE_SECRET 已生成"
fi
if [ -z "$LUBAN_RSA_PRIVATE_KEY" ]; then
    export LUBAN_RSA_PRIVATE_KEY=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)
    echo "[entry] LUBAN_RSA_PRIVATE_KEY 已生成"
fi
if [ -z "$LUBAN_AGENT_AES_KEY" ] || [ ${#LUBAN_AGENT_AES_KEY} -lt 16 ]; then
    export LUBAN_AGENT_AES_KEY=$(openssl rand -base64 32)
    echo "[entry] LUBAN_AGENT_AES_KEY 已生成"
fi

# ---------- 持久化密钥（下次重启复用） ----------
cat > "$SECRETS_FILE" << EOF
LUBAN_JWT_SECRET='${LUBAN_JWT_SECRET}'
LUBAN_DATASOURCE_SECRET='${LUBAN_DATASOURCE_SECRET}'
LUBAN_RSA_PRIVATE_KEY='${LUBAN_RSA_PRIVATE_KEY}'
LUBAN_AGENT_AES_KEY='${LUBAN_AGENT_AES_KEY}'
EOF
echo "[entry] 密钥已持久化到 $SECRETS_FILE"

# ---------- 初始化 MySQL 数据目录 ----------
if [ ! -d "$MYSQL_DATA_DIR/mysql" ]; then
    echo "[entry] 首次启动，初始化 MySQL 数据目录..."
    mkdir -p "$MYSQL_DATA_DIR" /var/run/mysqld
    chown -R mysql:mysql "$MYSQL_DATA_DIR" /var/run/mysqld

    mysqld --initialize-insecure --user=mysql --datadir="$MYSQL_DATA_DIR"
    echo "[entry] MySQL 系统表初始化完成"

    mysqld --user=mysql --datadir="$MYSQL_DATA_DIR" --skip-networking --socket="$MYSQL_SOCKET" &
    MYSQL_PID=$!

    for i in $(seq 1 30); do
        if mysqladmin ping --socket="$MYSQL_SOCKET" --silent 2>/dev/null; then
            break
        fi
        sleep 1
    done

    echo "[entry] 配置 MySQL 用户和数据库..."
    mysql --socket="$MYSQL_SOCKET" -u root <<EOF
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASSWORD}';
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED WITH mysql_native_password BY '${MYSQL_ROOT_PASSWORD}';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
EOF

    MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin --socket="$MYSQL_SOCKET" -u root shutdown
    wait "$MYSQL_PID" 2>/dev/null || true
    echo "[entry] MySQL 初始化完成"
else
    echo "[entry] MySQL 数据目录已存在，跳过初始化"
    mkdir -p /var/run/mysqld
    chown -R mysql:mysql /var/run/mysqld
fi

# ---------- 导出环境变量供 supervisord 子进程使用 ----------
export SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:3306/${MYSQL_DATABASE}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC&createDatabaseIfNotExist=true"
export SPRING_DATASOURCE_USERNAME=root
export SPRING_DATASOURCE_PASSWORD="$MYSQL_ROOT_PASSWORD"
export LUBAN_EMBEDDING_BASE_URL="http://127.0.0.1:8765"

env | grep -E '^(LUBAN_|SPRING_|MYSQL_|EMBEDDING_|HF_)' > /etc/luban.env

echo "[entry] 启动所有服务..."
mkdir -p /app/data/logs
exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf