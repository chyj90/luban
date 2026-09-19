package com.luban.service;

import java.util.List;
import java.util.Map;

/**
 * 部分 EB 数据源列索引未构建（多副本新实例 / EB 重启 / 结构指纹变更后未重建）。
 * 携带缺失的数据源 id 与其余数据源的部分检索结果，调用方据此自愈（补建后重试，
 * 仍缺失时降级使用部分结果——只丢 embedding 命中，关键词匹配兜底不受影响）。
 */
public class FaissColumnIndexMissingException extends RuntimeException {

    private final List<String> missingDatasources;
    private final List<Map<String, Object>> partialResults;

    public FaissColumnIndexMissingException(List<String> missingDatasources,
                                            List<Map<String, Object>> partialResults) {
        super("列索引未构建的数据源: " + missingDatasources);
        this.missingDatasources = missingDatasources;
        this.partialResults = partialResults;
    }

    public List<String> getMissingDatasources() {
        return missingDatasources;
    }

    public List<Map<String, Object>> getPartialResults() {
        return partialResults;
    }
}
