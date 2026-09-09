package com.luban.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class RegisterRequest {
    @NotBlank @Email
    private String email;

    @NotBlank @Size(min = 2, max = 30)
    private String account;

    /** RSA 密文约 344 字符，不做 @Size 限制，解密后 service 层校验长度 */
    @NotBlank
    private String password;
}