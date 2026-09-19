package com.luban.service;

/** EB 实例上概念索引未构建（多副本新实例/EB 重启）。调用方捕获后触发全量重建再重试。 */
public class FaissIndexMissingException extends RuntimeException {
    public FaissIndexMissingException(String message) {
        super(message);
    }
}
