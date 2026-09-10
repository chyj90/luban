#!/bin/bash
# ============================================================
# Luban All-in-One Docker Entrypoint
# 初始化 MySQL → 启动所有服务
# ============================================================
set -e

MYSQL_DATA_DIR="/app/data/mysql"
MYSQL_PID_FILE="/var/run/mysqld/mysqld.pid"
MYSQL_SOCKET="/var/run/mysqld/mysqld.sock"

# ---------- 环境变量默认值 ----------
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-luban123}"
MYSQL_DATABASE="${MYSQL_DATABASE:-luban}"

# ---------- 生成安全密钥 ----------
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

# ---------- 初始化 MySQL 数据目录 ----------
if [ ! -d "$MYSQL_DATA_DIR/mysql" ]; then
    echo "[entry] 首次启动，初始化 MySQL 数据目录..."
    mkdir -p "$MYSQL_DATA_DIR" /var/run/mysqld
    chown -R mysql:mysql "$MYSQL_DATA_DIR" /var/run/mysqld

    # 初始化 MySQL 系统表
    mysqld --initialize-insecure --user=mysql --datadir="$MYSQL_DATA_DIR"
    echo "[entry] MySQL 系统表初始化完成"

    # 启动 MySQL（无权限模式）
    mysqld --user=mysql --datadir="$MYSQL_DATA_DIR" --skip-networking --socket="$MYSQL_SOCKET" &
    MYSQL_PID=$!

    # 等待 MySQL 启动
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

    # 关闭临时 MySQL
    mysqladmin --socket="$MYSQL_SOCKET" -u root -p"${MYSQL_ROOT_PASSWORD}" shutdown
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

# 写入 /etc/environment 确保 supervisord 子进程能读取
env | grep -E '^(LUBAN_|SPRING_|MYSQL_|EMBEDDING_|HF_)' > /etc/luban.env

echo "[entry] 启动所有服务..."
exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf