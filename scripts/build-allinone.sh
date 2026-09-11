#!/bin/bash
# ============================================================
# Luban All-in-One 镜像构建脚本
# 自动从 .env 文件读取大模型配置，通过 --build-arg 传入
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"
ENV_TEMPLATE="$PROJECT_DIR/.env.docker"

# ---------- 检查 .env 是否存在 ----------
if [ ! -f "$ENV_FILE" ]; then
    echo "[build] 未找到 .env 文件"
    echo "[build] 请先复制模板: cp .env.docker .env"
    echo "[build] 然后编辑 .env 填写你的 LUBAN_LLM_API_KEY"
    exit 1
fi

# ---------- 加载 .env ----------
echo "[build] 加载配置: $ENV_FILE"
set -a
source "$ENV_FILE"
set +a

# ---------- 检查必需变量 ----------
if [ -z "$LUBAN_LLM_API_KEY" ] || [ "$LUBAN_LLM_API_KEY" = "sk-your-api-key-here" ]; then
    echo "[build] 错误: 请在 .env 中设置 LUBAN_LLM_API_KEY"
    exit 1
fi

# ---------- 构建 build-arg ----------
BUILD_ARGS=""
[ -n "$LUBAN_LLM_API_KEY" ] && BUILD_ARGS="$BUILD_ARGS --build-arg LUBAN_LLM_API_KEY=$LUBAN_LLM_API_KEY"
[ -n "$LUBAN_LLM_ENDPOINT" ] && BUILD_ARGS="$BUILD_ARGS --build-arg LUBAN_LLM_ENDPOINT=$LUBAN_LLM_ENDPOINT"
[ -n "$LUBAN_LLM_MODEL" ] && BUILD_ARGS="$BUILD_ARGS --build-arg LUBAN_LLM_MODEL=$LUBAN_LLM_MODEL"

echo "[build] 开始构建镜像: luban:latest"
echo "[build] 模型: $LUBAN_LLM_MODEL"
echo "[build] 端点: $LUBAN_LLM_ENDPOINT"

docker build \
    -f "$PROJECT_DIR/Dockerfile.allinone" \
    -t luban:latest \
    $BUILD_ARGS \
    "$PROJECT_DIR"

echo "[build] 构建完成: luban:latest"