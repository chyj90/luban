package com.luban.service.algorithm;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AlgorithmConfig {

    private String scriptPath;
    @Builder.Default private int timeout = 30;
    @Builder.Default private String pythonVersion = "3.11";
    @Builder.Default private String runtime = "python";
    @Builder.Default private int maxInputSizeMB = 10;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static AlgorithmConfig parse(String configJson) {
        if (configJson == null || configJson.isBlank()) {
            return AlgorithmConfig.builder().build();
        }
        try {
            return MAPPER.readValue(configJson, AlgorithmConfig.class);
        } catch (JsonProcessingException e) {
            org.slf4j.LoggerFactory.getLogger(AlgorithmConfig.class).warn("Failed to parse AlgorithmConfig JSON: {}", e.getMessage());
            return AlgorithmConfig.builder().build();
        }
    }

    public String toJson() {
        try {
            return MAPPER.writeValueAsString(this);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }
}