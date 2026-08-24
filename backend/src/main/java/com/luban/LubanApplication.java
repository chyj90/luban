package com.luban;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class LubanApplication {

    public static void main(String[] args) {
        SpringApplication.run(LubanApplication.class, args);
    }
}