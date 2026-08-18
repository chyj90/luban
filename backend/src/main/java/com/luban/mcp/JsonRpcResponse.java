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
public class JsonRpcResponse {

    @JsonProperty("jsonrpc")
    private String jsonrpc = "2.0";

    private Object result;

    private JsonRpcError error;

    private Object id;

    public static JsonRpcResponse success(Object id, Object result) {
        JsonRpcResponse response = new JsonRpcResponse();
        response.setId(id);
        response.setResult(result);
        return response;
    }

    public static JsonRpcResponse error(Object id, int code, String message, Object data) {
        JsonRpcResponse response = new JsonRpcResponse();
        response.setId(id);
        response.setError(new JsonRpcError(code, message, data));
        return response;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class JsonRpcError {
        private int code;
        private String message;
        private Object data;
    }
}