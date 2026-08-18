package com.luban.mcp;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class JsonRpcRequest {

    @JsonProperty("jsonrpc")
    private String jsonrpc = "2.0";

    private String method;

    private Map<String, Object> params;

    private Object id;

    public boolean isValid() {
        return "2.0".equals(jsonrpc) && method != null && !method.isEmpty();
    }

    public boolean isNotification() {
        return id == null;
    }
}