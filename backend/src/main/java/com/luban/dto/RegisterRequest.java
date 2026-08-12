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
    private String name;

    @NotBlank @Size(min = 6, max = 50)
    private String password;
}