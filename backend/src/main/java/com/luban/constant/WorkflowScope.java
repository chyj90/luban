package com.luban.constant;

public enum WorkflowScope {
    APPLICATION("APPLICATION"),
    PLATFORM("PLATFORM");

    private final String value;

    WorkflowScope(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }
}