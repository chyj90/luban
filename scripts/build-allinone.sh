#!/bin/bash
# ============================================================
# Luban All-in-One 镜像构建 & 导出脚本
# ============================================================
set -e

IMAGE_NAME="${IMAGE_NAME:-luban}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
EXPORT_FILE="${EXPORT_FILE:-luban-image.tar}"

cd "$(dirname "$0")/.."

echo "=========================================="
echo " Luban All-in-One 镜像构建"
echo "=========================================="
echo " 镜像名称: ${IMAGE_NAME}:${IMAGE_TAG}"
echo " 导出文件: ${EXPORT_FILE}"
echo ""

# 构建镜像
echo "[1/2] 构建 Docker 镜像..."
docker build -f Dockerfile.allinone -t "${IMAGE_NAME}:${IMAGE_TAG}" .

# 导出为 tar 文件
echo ""
echo "[2/2] 导出镜像为 ${EXPORT_FILE}..."
docker save -o "${EXPORT_FILE}" "${IMAGE_NAME}:${IMAGE_TAG}"

# 显示大小
SIZE=$(ls -lh "${EXPORT_FILE}" | awk '{print $5}')
echo ""
echo "=========================================="
echo " 完成！"
echo " 镜像: ${IMAGE_NAME}:${IMAGE_TAG}"
echo " 文件: ${EXPORT_FILE} (${SIZE})"
echo "=========================================="
echo ""
echo "--- 分发给其他人 ---"
echo ""
echo "方式一：上传到 Docker Hub"
echo "  docker tag ${IMAGE_NAME}:${IMAGE_TAG} your-username/${IMAGE_NAME}:${IMAGE_TAG}"
echo "  docker push your-username/${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo "方式二：U 盘拷贝"
echo "  将 ${EXPORT_FILE} 拷贝到 U 盘，对方执行："
echo "  docker load -i ${EXPORT_FILE}"
echo "  docker run -d --name luban -p 80:80 -v luban-data:/app/data ${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo "--- 本地运行 ---"
echo "  docker run -d --name luban -p 80:80 -v luban-data:/app/data ${IMAGE_NAME}:${IMAGE_TAG}"
echo "  访问 http://localhost 登录，默认账号 root@luban.local / 123456"