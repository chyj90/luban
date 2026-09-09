package com.luban.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 修改密码请求，旧密码和新密码均为 rsa: 前缀的 RSA-OAEP 密文。
 * 不对密文做 @Size 限制——RSA 2048 密文约 344 字符，校验在 service 层解密后执行。
 */
@Data
public class ChangePasswordRequest {
    @NotBlank
    private String oldPassword;

    @NotBlank
    private String newPassword;
}