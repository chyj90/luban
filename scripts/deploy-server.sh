#!/bin/bash
# ============================================================
# Luban 云服务器部署脚本
# 停止旧容器 → 删除旧镜像 → 拉取最新镜像 → 启动
# ============================================================
set -e

CONTAINER_NAME="luban"
IMAGE_REPO="crpi-lfrgtiymyz6leo28.cn-beijing.personal.cr.aliyuncs.com/chengyj90/luban"
IMAGE_TAG="${1:-latest}"
IMAGE_NAME="${IMAGE_REPO}:${IMAGE_TAG}"
DATA_DIR="/root/luban"
SERVER_IP="118.25.152.252"

echo "========== Luban 云服务器部署 =========="

# ---------- 1. 停止并删除旧容器 ----------
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "[1/5] 停止并删除旧容器 ${CONTAINER_NAME}..."
    docker stop "$CONTAINER_NAME" && docker rm "$CONTAINER_NAME"
else
    echo "[1/5] 容器 ${CONTAINER_NAME} 不存在，跳过"
fi

# ---------- 2. 删除所有旧版本镜像 ----------
OLD_IMAGES=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep "^${IMAGE_REPO}:" || true)
if [ -n "$OLD_IMAGES" ]; then
    echo "[2/5] 删除旧镜像："
    echo "$OLD_IMAGES" | while read -r img; do echo "  - $img"; done
    echo "$OLD_IMAGES" | xargs docker rmi
else
    echo "[2/5] 无旧镜像，跳过"
fi

# ---------- 3. 拉取最新镜像 ----------
echo "[3/5] 拉取最新镜像 ${IMAGE_NAME}..."
docker pull "$IMAGE_NAME"

# ---------- 4. 准备数据目录与 SSL 证书 ----------
echo "[4/5] 准备数据目录..."
mkdir -p "$DATA_DIR/ssl"
if [ -f "$DATA_DIR/ssl/tls.crt" ] && [ -f "$DATA_DIR/ssl/tls.key" ]; then
    echo "  检测到 SSL 证书，HTTPS 将自动启用"
else
    echo "  未检测到 SSL 证书，自动生成自签名证书（CN=${SERVER_IP}）..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$DATA_DIR/ssl/tls.key" \
        -out "$DATA_DIR/ssl/tls.crt" \
        -subj "/CN=${SERVER_IP}" 2>/dev/null
    echo "  自签名证书已生成，HTTPS 将自动启用"
    echo "  （浏览器会提示不安全，点"继续访问"即可；生产环境建议替换为正式证书）"
fi

# ---------- 5. 启动新容器 ----------
echo "[5/5] 启动新容器..."

docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p 80:80 \
    -p 443:443 \
    -v "${DATA_DIR}:/app/data" \
    "$IMAGE_NAME"

echo ""
echo "========== 部署完成 =========="
echo "HTTP:  http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')"
echo "HTTPS: https://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')"
echo "数据目录: ${DATA_DIR}"
echo "SSL 证书: ${DATA_DIR}/ssl/"
echo "日志查看: docker logs -f ${CONTAINER_NAME}"
echo ""
echo "替换为正式证书：将 tls.crt + tls.key 覆盖到 ${DATA_DIR}/ssl/ 后 docker restart ${CONTAINER_NAME}"