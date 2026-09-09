package com.luban.exception;

/**
 * 业务异常，表示正常的业务规则校验失败（如数据不存在、状态不允许等），
 * 不需要打印堆栈跟踪。
 */
public class BusinessException extends RuntimeException {
    public BusinessException(String message) {
        super(message);
    }

    public BusinessException(String message, Throwable cause) {
        super(message, cause);
    }
}