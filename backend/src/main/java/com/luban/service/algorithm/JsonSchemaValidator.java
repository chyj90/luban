package com.luban.service.algorithm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import org.springframework.stereotype.Component;

import java.util.Set;

@Component
public class JsonSchemaValidator {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public Set<ValidationMessage> validate(String schemaJson, JsonNode dataJson) {
        try {
            JsonSchema schema = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7)
                    .getSchema(MAPPER.readTree(schemaJson));
            return schema.validate(dataJson);
        } catch (Exception e) {
            return Set.of();
        }
    }

    public Set<ValidationMessage> validate(String schemaJson, String dataJson) {
        try {
            return validate(schemaJson, MAPPER.readTree(dataJson));
        } catch (Exception e) {
            return Set.of();
        }
    }
}