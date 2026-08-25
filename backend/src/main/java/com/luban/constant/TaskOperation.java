package com.luban.constant;

public enum TaskOperation {
    APPROVE("审批"),
    REJECT("驳回"),
    TRANSFER("转办"),
    ADD_SIGN("加签"),
    DELEGATE("委派"),
    REASSIGN("修改处理人");

    private final String label;

    TaskOperation(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}