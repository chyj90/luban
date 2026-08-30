package com.luban.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.AgentConfig;
import com.luban.entity.AsyncTask;
import com.luban.entity.Concept;
import com.luban.entity.ConceptRelation;
import com.luban.repository.AgentConfigRepository;
import com.luban.repository.ConceptRelationRepository;
import com.luban.repository.ConceptRepository;
import com.luban.repository.OntologyGroupRepository;
import com.luban.entity.OntologyGroup;
import com.luban.entity.IndustryRelation;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;

import java.io.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;
@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptImportService {

    private final ConceptRepository conceptRepository;
    private final ConceptRelationRepository conceptRelationRepository;
    private final AgentConfigRepository agentConfigRepository;
    private final AgentConfigService agentConfigService;
    private final OntologyGroupRepository groupRepository;
    private final OntologyService ontologyService;
    private final IndustryService industryService;
    private final AsyncTaskService asyncTaskService;

    private final ObjectMapper jsonMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    private final String pythonServiceUrl = System.getProperty(
            "luban.embedding.base-url", "http://127.0.0.1:8765");

    @SuppressWarnings("unchecked")
    public Map<String, Object> preview(String sourceType, String content, String url, Long industryId, Long groupId) {
        log.info("══════════════════════════════════════════════════");
        log.info("[import] 开始导入预览, sourceType={}, industryId={}, groupId={}, mode={}",
                sourceType, industryId, groupId, url != null ? "URL" : "paste");
        Map<String, Object> result = new LinkedHashMap<>();
        File tempFile = null;
        try {
            String rawContent = resolveContent(content, url);
            if (rawContent == null) {
                log.warn("[import] 无法获取内容: url={}, contentLength={}",
                        url, content != null ? content.length() : 0);
                result.put("error", "无法获取内容，请检查 URL 或粘贴内容");
                return result;
            }
            log.info("[import] 内容获取成功, length={}", rawContent.length());

            tempFile = saveToTempFile(rawContent, sourceType);
            log.info("[import] 临时文件: {} ({} bytes)", tempFile.getAbsolutePath(), tempFile.length());

            Map<String, Object> parseResult = parseWithPythonService(sourceType, tempFile.toPath(), industryId);

            if (parseResult.containsKey("error")) {
                result.put("error", parseResult.get("error"));
                return result;
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> rawConcepts = (List<Map<String, Object>>) parseResult.get("concepts");
            if (rawConcepts == null || rawConcepts.isEmpty()) {
                log.warn("[import] 解析结果为空, sourceType={}", sourceType);
                result.put("error", "未解析到任何概念");
                return result;
            }
            log.info("[import] Python解析得到 {} 个概念", rawConcepts.size());

            result = buildPreviewResult(rawConcepts, industryId, groupId, sourceType);
            log.info("[import] 预览构建完成, totalConcepts={}", result.get("total"));

        } catch (Exception e) {
            log.error("[import] 预览失败: {}", e.getMessage(), e);
            result.put("error", "预览失败: " + e.getMessage());
        } finally {
            if (tempFile != null) {
                boolean deleted = tempFile.delete();
                log.info("[import] 临时文件清理: {} (deleted={})", tempFile.getName(), deleted);
            }
        }
        log.info("══════════════════════════════════════════════════");
        return result;
    }

    public long previewAsync(String sourceType, byte[] fileBytes, String content, String url,
                              Long industryId, Long groupId, Long userId) {
        AsyncTask task = asyncTaskService.createTask("IMPORT_CONCEPTS", 3, userId);
        asyncTaskService.startTask(task.getId());
        Thread.startVirtualThread(() -> {
            try {
                asyncTaskService.updateProgress(task.getId(), 0, "正在解析内容...");
                String rawContent = content;
                if (url != null && !url.isEmpty()) {
                    rawContent = resolveContent(null, url);
                }
                if (rawContent == null && fileBytes != null) {
                    rawContent = new String(fileBytes, java.nio.charset.StandardCharsets.UTF_8);
                }
                if (rawContent == null || rawContent.isEmpty()) {
                    asyncTaskService.failTask(task.getId(), "无法获取内容");
                    return;
                }

                asyncTaskService.updateProgress(task.getId(), 1, "正在调用 AI 解析...");
                Map<String, Object> result = preview(sourceType, rawContent, null, industryId, groupId);
                if (result.containsKey("error")) {
                    asyncTaskService.failTask(task.getId(), (String) result.get("error"));
                    return;
                }

                asyncTaskService.updateProgress(task.getId(), 2, "解析完成");
                result.put("_industryId", industryId);
                result.put("_groupId", groupId);
                asyncTaskService.completeTask(task.getId(), jsonMapper.writeValueAsString(result));
            } catch (Exception e) {
                log.error("[import-async] 预览失败: {}", e.getMessage(), e);
                asyncTaskService.failTask(task.getId(), e.getMessage());
            }
        });
        return task.getId();
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> executeFromTask(Long taskId, List<Map<String, Object>> selectedItems) {
        AsyncTask task = asyncTaskService.getTask(taskId);
        if (task == null) {
            return Map.of("error", "任务不存在");
        }
        if (!"COMPLETED".equals(task.getStatus())) {
            return Map.of("error", "任务尚未完成");
        }
        try {
            Map<String, Object> preview = jsonMapper.readValue(task.getResult(), Map.class);
            String sourceType = (String) preview.get("sourceType");
            Long industryId = preview.get("_industryId") instanceof Number n ? n.longValue() : null;
            Long groupId = preview.get("_groupId") instanceof Number n ? n.longValue() : null;
            return execute(sourceType, null, null, industryId, groupId, selectedItems);
        } catch (Exception e) {
            log.error("[import-async] 从任务执行导入失败: {}", e.getMessage(), e);
            return Map.of("error", "导入失败: " + e.getMessage());
        }
    }

    private String buildFileSummary(String sourceType, Path filePath) {
        try {
            String ext = sourceType.toLowerCase();
            long fileSize = Files.size(filePath);
            log.info("[import] │  文件: {} ({} bytes, type={})", filePath, fileSize, ext);

            if ("excel".equals(ext) || "xlsx".equals(ext) || "xls".equals(ext)) {
                return buildExcelSummary(filePath);
            } else {
                return buildTextSummary(filePath);
            }
        } catch (Exception e) {
            log.warn("[import] │  摘要生成异常: {}", e.getMessage(), e);
            return null;
        }
    }

    private String buildExcelSummary(Path filePath) {
        try {
            org.apache.poi.ss.usermodel.Workbook workbook =
                    new org.apache.poi.xssf.usermodel.XSSFWorkbook(filePath.toFile());
            StringBuilder sb = new StringBuilder();
            int maxChars = 30000;

            int totalSheets = workbook.getNumberOfSheets();
            log.info("[import] │  Excel: {} sheets", totalSheets);

            // 阶段1: 收集所有 sheet 的结构概览
            List<SheetInfo> sheetInfos = new ArrayList<>();
            for (int si = 0; si < totalSheets; si++) {
                org.apache.poi.ss.usermodel.Sheet sheet = workbook.getSheetAt(si);
                String sheetName = sheet.getSheetName();
                int lastRow = sheet.getLastRowNum();
                if (lastRow < 1) {
                    log.info("[import] │    Sheet[{}] '{}': 空表,跳过", si, sheetName);
                    continue;
                }
                org.apache.poi.ss.usermodel.Row headerRow = sheet.getRow(0);
                List<String> headers = new ArrayList<>();
                if (headerRow != null) {
                    for (int ci = 0; ci < headerRow.getLastCellNum(); ci++) {
                        headers.add(getCellString(headerRow.getCell(ci)));
                    }
                }
                sheetInfos.add(new SheetInfo(si, sheetName, lastRow + 1, headers));
                log.info("[import] │    Sheet[{}] '{}': {} rows", si, sheetName, lastRow + 1);
            }

            // 输出结构概览
            sb.append("=== 文件结构概览 ===\n");
            sb.append("Sheet总数: ").append(sheetInfos.size()).append("\n");

            // Sheet分类：根据结构特征自动识别数据Sheet vs 元数据Sheet
            // 数据Sheet特征：表头列数 >= 3，且数据行有实质内容
            // 元数据Sheet特征：列数少（1-2列），或数据稀疏（封面/版权/说明页）
            List<SheetInfo> dataSheets = new ArrayList<>();
            List<SheetInfo> metaSheets = new ArrayList<>();

            for (SheetInfo info : sheetInfos) {
                int nonEmptyHeaders = (int) info.headers.stream()
                        .filter(h -> !h.trim().isEmpty()).count();
                boolean isDataSheet = nonEmptyHeaders >= 3;
                if (isDataSheet) {
                    dataSheets.add(info);
                } else {
                    metaSheets.add(info);
                }
            }

            sb.append("\n【数据Sheet - 包含结构化概念定义，需要解析】(").append(dataSheets.size()).append("个):\n");
            for (SheetInfo info : dataSheets) {
                sb.append("  ✓ Sheet[").append(info.index).append("] '").append(info.name)
                        .append("': ").append(info.rowCount).append("行, ")
                        .append(info.headers.size()).append("列\n");
                if (!info.headers.isEmpty()) {
                    sb.append("    表头: ");
                    for (int hi = 0; hi < info.headers.size(); hi++) {
                        String h = info.headers.get(hi);
                        if (!h.isEmpty()) sb.append("[").append(hi).append("]").append(h).append(" | ");
                    }
                    sb.append("\n");
                }
            }

            sb.append("\n【元数据Sheet - 封面/版权/说明页，跳过不解析】(").append(metaSheets.size()).append("个):\n");
            for (SheetInfo info : metaSheets) {
                sb.append("  ✗ Sheet[").append(info.index).append("] '").append(info.name)
                        .append("': ").append(info.rowCount).append("行, ")
                        .append(info.headers.size()).append("列 - 跳过\n");
            }
            sb.append("\n");

            log.info("[import] │  结构概览: {} sheets, {} chars", sheetInfos.size(), sb.length());

            // 阶段2: 只采样数据Sheet（前5+尾5行），元数据Sheet已在分类中标注跳过
            int charsPerSheet = Math.max(300, (maxChars - sb.length()) / Math.max(1, dataSheets.size()));
            sb.append("=== 数据采样 ===\n");
            int totalRows = 0;

            for (SheetInfo info : dataSheets) {
                if (sb.length() >= maxChars) {
                    log.info("[import] │    摘要已达上限 {} chars, 停止采样", maxChars);
                    break;
                }

                org.apache.poi.ss.usermodel.Sheet sheet = workbook.getSheetAt(info.index);
                int sheetBudget = Math.min(charsPerSheet, maxChars - sb.length());
                if (sheetBudget < 100) {
                    sb.append("Sheet '").append(info.name).append("': 空间不足,跳过\n");
                    continue;
                }

                sb.append("\n--- Sheet: ").append(info.name)
                        .append(" (").append(info.rowCount).append("行) ---\n");

                int sampleStart = sb.length();
                int rowCount = 0;

                // 前5行
                int frontEnd = Math.min(5, info.rowCount - 1);
                for (int ri = 1; ri <= frontEnd && sb.length() - sampleStart < sheetBudget; ri++) {
                    appendRow(sb, sheet, ri, info.headers, "R" + ri);
                    rowCount++;
                }

                // 中间5行
                if (info.rowCount > frontEnd + 5 && sb.length() - sampleStart < sheetBudget) {
                    int midStart = info.rowCount / 2 - 2;
                    int midEnd = midStart + 5;
                    if (midStart <= frontEnd) midStart = frontEnd + 1;
                    sb.append("  ... (").append(midStart - frontEnd - 1).append(" rows) ...\n");
                    for (int ri = midStart; ri < midEnd && ri < info.rowCount && sb.length() - sampleStart < sheetBudget; ri++) {
                        appendRow(sb, sheet, ri, info.headers, "R" + ri);
                        rowCount++;
                    }
                    frontEnd = midEnd - 1;
                }

                // 尾5行（不重复）
                if (info.rowCount > frontEnd + 1 && sb.length() - sampleStart < sheetBudget) {
                    int tailStart = Math.max(frontEnd + 1, info.rowCount - 5);
                    sb.append("  ... (").append(tailStart - frontEnd - 1).append(" rows) ...\n");
                    for (int ri = tailStart; ri < info.rowCount && sb.length() - sampleStart < sheetBudget; ri++) {
                        appendRow(sb, sheet, ri, info.headers, "R" + ri);
                        rowCount++;
                    }
                }

                totalRows += rowCount;
                log.info("[import] │    Sheet '{}': {} sample rows, {} chars",
                        info.name, rowCount, sb.length() - sampleStart);
            }

            workbook.close();
            log.info("[import] │  Excel摘要: {} sheets, {} 采样行, {} chars",
                    sheetInfos.size(), totalRows, sb.length());
            return sb.length() > 0 ? sb.toString() : null;

        } catch (Exception e) {
            log.warn("[import] │  Excel摘要生成失败: {}", e.getMessage(), e);
            return null;
        }
    }

    private void appendRow(StringBuilder sb, org.apache.poi.ss.usermodel.Sheet sheet,
                           int rowIndex, List<String> headers, String label) {
        org.apache.poi.ss.usermodel.Row row = sheet.getRow(rowIndex);
        if (row == null) return;
        StringBuilder rowStr = new StringBuilder();
        rowStr.append("  ").append(label).append(": ");
        boolean hasData = false;
        int maxCol = headers.isEmpty() ? row.getLastCellNum() : headers.size();
        for (int ci = 0; ci < maxCol; ci++) {
            String val = getCellString(row.getCell(ci));
            if (!val.isEmpty()) {
                hasData = true;
                if (val.length() > 100) val = val.substring(0, 100) + "...";
                rowStr.append("[").append(ci).append("]").append(val).append(" | ");
            }
        }
        if (hasData) {
            sb.append(rowStr).append("\n");
        }
    }

    // 内部类：Sheet 结构信息
    private static class SheetInfo {
        final int index;
        final String name;
        final int rowCount;
        final List<String> headers;
        SheetInfo(int index, String name, int rowCount, List<String> headers) {
            this.index = index;
            this.name = name;
            this.rowCount = rowCount;
            this.headers = headers;
        }
    }

    private String buildTextSummary(Path filePath) {
        try {
            String content = Files.readString(filePath);
            int maxLen = 6000;
            log.info("[import] │  文本文件: {} chars", content.length());
            if (content.length() > maxLen) {
                String truncated = content.substring(0, maxLen)
                        + "\n... (truncated, total " + content.length() + " chars)";
                log.info("[import] │  截断至 {} chars", maxLen);
                return truncated;
            }
            return content;
        } catch (Exception e) {
            log.warn("[import] │  文本摘要生成失败: {}", e.getMessage(), e);
            return null;
        }
    }

    private String getCellString(org.apache.poi.ss.usermodel.Cell cell) {
        if (cell == null) return "";
        switch (cell.getCellType()) {
            case STRING: return cell.getStringCellValue().trim();
            case NUMERIC:
                if (org.apache.poi.ss.usermodel.DateUtil.isCellDateFormatted(cell)) {
                    return cell.getDateCellValue().toString();
                }
                double num = cell.getNumericCellValue();
                if (num == Math.floor(num) && !Double.isInfinite(num)) return String.valueOf((long) num);
                return String.valueOf(num);
            case BOOLEAN: return String.valueOf(cell.getBooleanCellValue());
            case FORMULA:
                try { return cell.getStringCellValue().trim(); }
                catch (Exception e) { return String.valueOf(cell.getNumericCellValue()); }
            default: return "";
        }
    }

    private String extractCodeBlock(String text) {
        int start = text.indexOf("```python");
        if (start >= 0) {
            start += 9;
            int end = text.indexOf("```", start);
            if (end > start) return text.substring(start, end).trim();
        }
        start = text.indexOf("```");
        if (start >= 0) {
            start += 3;
            int end = text.indexOf("```", start);
            if (end > start) return text.substring(start, end).trim();
        }
        if (text.contains("import ") && text.contains("print(json.dumps(")) {
            return text.trim();
        }
        return null;
    }

    private Map<String, Object> parseWithPythonService(String sourceType, Path filePath, Long industryId) {
        log.info("[import] ┌─ 阶段1: 生成文件摘要");
        String summary = buildFileSummary(sourceType, filePath);
        if (summary == null) {
            log.warn("[import] └─ 摘要生成失败");
            return Map.of("error", "文件摘要生成失败，请检查文件格式");
        }
        log.info("[import] ├─ 摘要长度: {} chars", summary.length());

        log.info("[import] ┌─ 阶段2: LLM生成解析代码");
        ImportSession session = new ImportSession(sourceType, filePath, summary, null, industryId);
        LLMResult llmResult = callLLMWithHistory(sourceType, session);
        if (llmResult.code == null) {
            if (llmResult.clarification != null) {
                log.warn("[import] └─ LLM需要澄清: {}", llmResult.clarification);
                return Map.of("error", "AI 解析遇到疑问: " + llmResult.clarification);
            }
            log.warn("[import] └─ LLM生成代码失败, LLM原始响应: {}", llmResult.rawResponse);
            return Map.of("error", "AI 解析失败，请检查文件内容是否可识别");
        }
        log.info("[import] ├─ 生成代码长度: {} chars", llmResult.code.length());
        log.info("[import] ├─ 完整代码:\n{}", llmResult.code);

        log.info("[import] ┌─ 阶段3: Python服务执行");
        List<Map<String, Object>> concepts = executePythonCode(filePath, llmResult.code);
        log.info("[import] └─ 执行结果: {} 个概念", concepts.size());
        return Map.of("concepts", (Object) concepts);
    }

    private Map<String, Object> buildPreviewResult(List<Map<String, Object>> rawConcepts, Long industryId, Long groupId, String sourceType) {
        log.info("[import] → 开始LLM规范化, conceptCount={}, autoDomain={}", rawConcepts.size(), groupId == null);
        List<Map<String, Object>> normalized = normalizeWithLLM(rawConcepts, industryId, groupId);
        log.info("[import] → LLM规范化完成, 返回 {} 个概念", normalized.size());

        List<Map<String, Object>> withConflicts = detectConflicts(normalized, groupId);
        long conflictCount = withConflicts.stream().filter(c -> Boolean.TRUE.equals(c.get("conflict"))).count();
        log.info("[import] → 冲突检测完成, {} 个冲突", conflictCount);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("concepts", withConflicts);
        result.put("total", withConflicts.size());
        result.put("sourceType", sourceType);

        if (groupId == null) {
            result.put("autoDomain", true);
            List<Map<String, Object>> domains = extractDomains(withConflicts);
            result.put("suggestedDomains", domains);
            log.info("[import] → 自动域识别: {} 个域", domains.size());
        }
        return result;
    }

    private List<Map<String, Object>> resolveConflicts(List<Map<String, Object>> rawConcepts) {
        return detectConflicts(rawConcepts, null);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> executePythonCode(Path filePath, String code) {
        List<Map<String, Object>> concepts = new ArrayList<>();
        try {
            Map<String, Object> requestBody = new LinkedHashMap<>();
            requestBody.put("file_path", filePath.toAbsolutePath().toString());
            requestBody.put("code", code);

            String requestJson = jsonMapper.writeValueAsString(requestBody);
            log.info("[import] │  Python服务请求: {} bytes, url={}", requestJson.length(),
                    pythonServiceUrl + "/v1/parse-file");
            log.info("[import] │  Python代码({} chars):\n{}", code.length(), code);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(pythonServiceUrl + "/v1/parse-file"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(requestJson))
                    .timeout(Duration.ofSeconds(90))
                    .build();

            long start = System.currentTimeMillis();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            long elapsed = System.currentTimeMillis() - start;
            log.info("[import] │  Python服务响应: HTTP {} ({}ms)", response.statusCode(), elapsed);

            if (response.statusCode() != 200) {
                String respBody = response.body();
                log.warn("[import] │  Python服务错误响应: {}", respBody.length() > 2000 ? respBody.substring(0, 2000) : respBody);
                return concepts;
            }

            Map<String, Object> respBody = jsonMapper.readValue(response.body(), Map.class);
            List<Map<String, Object>> rawConcepts = (List<Map<String, Object>>) respBody.get("concepts");
            if (rawConcepts == null) {
                log.warn("[import] │  Python服务返回无concepts字段, body: {}",
                        response.body().length() > 500 ? response.body().substring(0, 500) : response.body());
                return concepts;
            }

            for (Map<String, Object> item : rawConcepts) {
                Map<String, Object> concept = new LinkedHashMap<>();
                concept.put("name", item.getOrDefault("name", "Unknown"));
                concept.put("displayName", item.getOrDefault("displayName", item.get("name")));
                concept.put("originalName", item.get("name"));
                concept.put("description", item.getOrDefault("description", ""));
                concept.put("parentName", item.get("parentName"));
                concept.put("suggestedDomain", item.getOrDefault("domain", "默认域"));
                concept.put("relationDefs", item.getOrDefault("relations", new ArrayList<>()));
                List<Map<String, Object>> rels = (List<Map<String, Object>>) item.getOrDefault("relations", new ArrayList<>());
                List<String> relList = new ArrayList<>();
                for (Map<String, Object> r : rels) {
                    relList.add(r.getOrDefault("type", "") + " → " + r.getOrDefault("target", ""));
                }
                concept.put("relations", relList);
                concepts.add(concept);
            }

        } catch (Exception e) {
            log.error("[import] │  Python执行异常: {}", e.getMessage(), e);
        }
        return concepts;
    }

    private File saveToTempFile(String content, String sourceType) throws IOException {
        String ext = getExtension(sourceType);
        File file = File.createTempFile("luban-import-", ext);
        Files.writeString(file.toPath(), content);
        return file;
    }

    private Path saveBytesToTempFile(byte[] bytes, String sourceType) throws IOException {
        String ext = getExtension(sourceType);
        File file = File.createTempFile("luban-import-", ext);
        Files.write(file.toPath(), bytes);
        return file.toPath();
    }

    private String getExtension(String sourceType) {
        switch (sourceType.toLowerCase()) {
            case "excel": return ".xlsx";
            case "owl": return ".owl";
            case "swagger": return ".json";
            case "json": return ".json";
            case "yaml": case "yml": return ".yaml";
            case "xml": return ".xml";
            default: return "." + sourceType.toLowerCase();
        }
    }

    @SuppressWarnings("unchecked")
    @Transactional
    public Map<String, Object> execute(String sourceType, String content, String url, Long industryId, Long groupId,
                                        List<Map<String, Object>> selectedItems) {
        log.info("[import] ===== 开始执行导入, sourceType={}, industryId={}, itemCount={}, autoDomain={} =====",
                sourceType, industryId, selectedItems.size(), groupId == null);
        Map<String, Object> result = new LinkedHashMap<>();
        int created = 0;
        int skipped = 0;
        List<Map<String, Object>> imported = new ArrayList<>();

        try {
            Map<String, Long> domainCache = new LinkedHashMap<>();
            boolean autoDomain = groupId == null;

            if (autoDomain) {
                List<String> existingNames = groupRepository.findAll().stream()
                        .map(OntologyGroup::getName)
                        .collect(Collectors.toList());
                for (Map<String, Object> item : selectedItems) {
                    String domain = (String) item.getOrDefault("suggestedDomain", "默认域");
                    domainCache.putIfAbsent(domain, null);
                }
                for (String domainName : domainCache.keySet()) {
                    if (existingNames.contains(domainName)) {
                        OntologyGroup existing = groupRepository.findByName(domainName).orElse(null);
                        domainCache.put(domainName, existing != null ? existing.getId() : null);
                        log.info("[import] 域 '{}' 已存在, id={}", domainName, existing != null ? existing.getId() : null);
                    } else {
                        OntologyGroup newGroup = new OntologyGroup();
                        newGroup.setName(domainName);
                        newGroup.setDisplayName(domainName);
                        newGroup.setDescription("自动创建: " + domainName);
                        newGroup.setIndustryId(industryId);
                        newGroup = groupRepository.save(newGroup);
                        domainCache.put(domainName, newGroup.getId());
                        log.info("[import] 创建新域 '{}', id={}", domainName, newGroup.getId());
                    }
                }
            }

            Map<Long, Concept> createdConcepts = new LinkedHashMap<>();

            for (Map<String, Object> item : selectedItems) {
                String name = (String) item.get("name");
                String displayName = (String) item.get("displayName");
                String description = (String) item.get("description");
                String parentName = (String) item.get("parentName");
                Boolean skip = (Boolean) item.get("skip");

                if (Boolean.TRUE.equals(skip) || name == null) {
                    skipped++;
                    continue;
                }

                if (displayName == null || displayName.isEmpty()) {
                    displayName = name;
                }

                Long conceptGroupId = groupId;
                if (autoDomain) {
                    String domain = (String) item.getOrDefault("suggestedDomain", "默认域");
                    conceptGroupId = domainCache.get(domain);
                }

                Concept concept = new Concept();
                concept.setName(name);
                concept.setDescription(description);
                concept.setGroupId(conceptGroupId);

                concept = conceptRepository.save(concept);
                createdConcepts.put(concept.getId(), concept);
                created++;

                Map<String, Object> importedItem = new LinkedHashMap<>();
                importedItem.put("name", name);
                importedItem.put("id", concept.getId());
                importedItem.put("status", "created");
                imported.add(importedItem);
            }

            log.info("[import] 概念创建完成: created={}, skipped={}", created, skipped);

            int relCount = 0;
            Set<String> createdRelationKeys = new HashSet<>();
            Set<String> usedRelationTypes = new HashSet<>();
            for (Map<String, Object> item : selectedItems) {
                String name = (String) item.get("name");
                List<Map<String, Object>> rels = (List<Map<String, Object>>) item.get("relationDefs");
                if (name == null || rels == null) continue;

                Concept source = createdConcepts.values().stream()
                        .filter(c -> c.getName().equals(name))
                        .findFirst().orElse(null);
                if (source == null) continue;

                for (Map<String, Object> rel : rels) {
                    String targetName = (String) rel.get("target");
                    String relType = (String) rel.get("type");
                    if (targetName == null || relType == null) continue;

                    Concept target = createdConcepts.values().stream()
                            .filter(c -> c.getName().equals(targetName))
                            .findFirst().orElse(null);
                    if (target == null) continue;

                    String relKey = source.getId() + "->" + target.getId() + ":" + relType;
                    if (!createdRelationKeys.add(relKey)) {
                        log.info("[import] 跳过重复关系: {} {} {}", source.getName(), relType, target.getName());
                        continue;
                    }

                    ConceptRelation relation = new ConceptRelation();
                    relation.setSourceConceptId(source.getId());
                    relation.setTargetConceptId(target.getId());
                    relation.setRelationType(relType);
                    relation.setExpression((String) rel.get("expression"));
                    relation.setDescription((String) rel.get("description"));
                    conceptRelationRepository.save(relation);
                    usedRelationTypes.add(relType);
                    relCount++;
                }
            }
            log.info("[import] 关系创建完成: {} 条", relCount);

            if (industryId != null && !usedRelationTypes.isEmpty()) {
                Set<String> existingTypes = industryService.getRelations(industryId).stream()
                        .map(IndustryRelation::getRelationType)
                        .collect(Collectors.toSet());
                usedRelationTypes.removeAll(existingTypes);
                if (!usedRelationTypes.isEmpty()) {
                    result.put("newRelationTypes", new ArrayList<>(usedRelationTypes));
                    log.info("[import] 发现新关系类型: {}", usedRelationTypes);
                }
            }

            ontologyService.reload();

            result.put("created", created);
            result.put("skipped", skipped);
            result.put("imported", imported);
            log.info("[import] ===== 导入完成: created={}, skipped={}, relations={} =====", created, skipped, relCount);

        } catch (Exception e) {
            log.error("[import] 导入执行失败: {}", e.getMessage(), e);
            TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
            result.put("error", "导入失败: " + e.getMessage());
        }
        return result;
    }

    private String resolveContent(String content, String url) {
        if (url != null && !url.isEmpty()) {
            try {
                log.info("[import] 从URL获取内容: {}", url);
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .timeout(Duration.ofSeconds(15))
                        .GET()
                        .build();
                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() == 200) {
                    log.info("[import] URL内容获取成功: {} bytes", response.body().length());
                    return response.body();
                }
                log.warn("[import] URL请求失败: HTTP {}", response.statusCode());
            } catch (Exception e) {
                log.warn("[import] URL请求异常: {}", e.getMessage());
            }
        }
        return content != null && !content.isEmpty() ? content : null;
    }

    private List<Map<String, Object>> normalizeWithLLM(List<Map<String, Object>> rawConcepts, Long industryId, Long groupId) {
        try {
            AgentConfig config = agentConfigRepository.findByIsDefaultTrue().orElse(null);
            if (config == null) {
                log.warn("[import] → 无默认AgentConfig, 跳过规范化");
                return rawConcepts;
            }

            String apiKey = agentConfigService.decrypt(config.getSecretKeyEnc());
            String baseUrl = config.getModelEndpoint();
            if (!baseUrl.endsWith("/v1")) {
                baseUrl = baseUrl.replaceAll("/+$", "") + "/v1";
            }

            StringBuilder sb = new StringBuilder();
            for (Map<String, Object> c : rawConcepts) {
                sb.append("- name: ").append(c.get("name")).append("\n");
                sb.append("  description: ").append(c.getOrDefault("description", "")).append("\n");
                List<String> rels = (List<String>) c.get("relations");
                if (rels != null && !rels.isEmpty()) {
                    sb.append("  relations: ").append(String.join(", ", rels)).append("\n");
                }
            }

            boolean autoDomain = groupId == null;

            String prompt = "你是一个本体建模专家。请将以下原始概念定义规范化为中文概念。\n\n"
                    + "原始概念：\n" + sb + "\n"
                    + "请为每个概念返回规范化的JSON数组，每个元素包含：\n"
                    + "- name: 英文标识（驼峰或下划线，如 CustomerOrder）\n"
                    + "- displayName: 中文显示名称（如 客户订单）\n"
                    + "- description: 中文描述（20字以内）\n"
                    + "- parentName: 父概念标识（如有）\n";

            if (autoDomain) {
                prompt += "- domain: 该概念所属的域/分组名称（根据概念名称和描述推断，将相似概念归入同一域，如 Market Domain、Product Domain）\n";
            }

            prompt += "- relations: 关系列表，每项 { type: 关系类型英文, target: 目标概念名, expression: 计算公式(可选), description: 关系描述(可选) }\n\n"
                    + "可用关系类型：\n"
                    + getRelationPromptString(industryId) + "\n"
                    + "优先从上表选择，如果原始数据中的关系类型不在上表，可保留原样\n\n"
                    + "只返回JSON数组，不要其他内容。";

            log.info("[import] → 规范化LLM请求: promptLength={}", prompt.length());

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", config.getModelName());
            body.put("messages", List.of(
                    Map.of("role", "system", "content", "你是一个数据规范化工具。只输出JSON数组，不要任何解释、提问或澄清。"),
                    Map.of("role", "user", "content", prompt)
            ));
            body.put("temperature", 0.3);
            body.put("max_tokens", 32768);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/chat/completions"))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(jsonMapper.writeValueAsString(body)))
                    .timeout(Duration.ofSeconds(60))
                    .build();

            long start = System.currentTimeMillis();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            long elapsed = System.currentTimeMillis() - start;
            log.info("[import] → 规范化LLM响应: HTTP {} ({}ms)", response.statusCode(), elapsed);

            if (response.statusCode() != 200) {
                log.warn("[import] → LLM调用失败: HTTP {}, body={}", response.statusCode(), response.body());
                return rawConcepts;
            }

            Map<String, Object> respBody = jsonMapper.readValue(response.body(), Map.class);
            List<Map<String, Object>> choices = (List<Map<String, Object>>) respBody.get("choices");
            if (choices == null || choices.isEmpty()) return rawConcepts;

            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            String llmContent = (String) message.get("content");
            if (llmContent == null || llmContent.isEmpty()) {
                llmContent = (String) message.get("reasoning_content");
                if (llmContent != null) {
                    log.info("[import] → 使用 reasoning_content 作为响应内容");
                }
            }
            if (llmContent == null) return rawConcepts;

            log.info("[import] → 规范化LLM原始响应: {} chars", llmContent.length());

            String jsonStr = extractJsonArray(llmContent);
            if (jsonStr == null) {
                log.warn("[import] → 无法提取JSON数组, 原始响应:\n{}", llmContent);
                return rawConcepts;
            }

            List<Map<String, Object>> llmResult = jsonMapper.readValue(sanitizeJson(jsonStr), List.class);
            log.info("[import] → 规范化结果: {} 个概念", llmResult.size());
            List<Map<String, Object>> merged = new ArrayList<>();

            for (int i = 0; i < rawConcepts.size(); i++) {
                Map<String, Object> raw = rawConcepts.get(i);
                Map<String, Object> llmItem = i < llmResult.size() ? llmResult.get(i) : null;

                if (llmItem != null) {
                    String llmName = (String) llmItem.get("name");
                    if (llmName != null && !llmName.isEmpty()) {
                        raw.put("name", llmName);
                    }
                    String llmDisplay = (String) llmItem.get("displayName");
                    if (llmDisplay != null && !llmDisplay.isEmpty()) {
                        raw.put("displayName", llmDisplay);
                    }
                    String llmDesc = (String) llmItem.get("description");
                    if (llmDesc != null && !llmDesc.isEmpty()) {
                        raw.put("description", llmDesc);
                    }
                    String llmParent = (String) llmItem.get("parentName");
                    if (llmParent != null && !llmParent.isEmpty()) {
                        raw.put("parentName", llmParent);
                    }
                    String llmDomain = (String) llmItem.get("domain");
                    if (llmDomain != null && !llmDomain.isEmpty()) {
                        raw.put("suggestedDomain", llmDomain);
                    }
                    List<Map<String, Object>> llmRels = (List<Map<String, Object>>) llmItem.get("relations");
                    if (llmRels != null) {
                        raw.put("relationDefs", llmRels);
                        List<String> relList = new ArrayList<>();
                        for (Map<String, Object> r : llmRels) {
                            relList.add(r.getOrDefault("type", "") + " → " + r.getOrDefault("target", ""));
                        }
                        raw.put("relations", relList);
                    }
                }
                merged.add(raw);
            }

            return merged;

        } catch (Exception e) {
            log.error("[import] → LLM规范化异常: {}", e.getMessage(), e);
            return rawConcepts;
        }
    }

    private List<Map<String, Object>> extractDomains(List<Map<String, Object>> concepts) {
        Map<String, List<Map<String, Object>>> grouped = new LinkedHashMap<>();
        for (Map<String, Object> c : concepts) {
            String domain = (String) c.getOrDefault("suggestedDomain", "默认域");
            grouped.computeIfAbsent(domain, k -> new ArrayList<>()).add(c);
        }

        List<Map<String, Object>> domains = new ArrayList<>();
        List<String> existingNames = groupRepository.findAll().stream()
                .map(OntologyGroup::getName)
                .collect(Collectors.toList());

        for (Map.Entry<String, List<Map<String, Object>>> entry : grouped.entrySet()) {
            Map<String, Object> domain = new LinkedHashMap<>();
            domain.put("name", entry.getKey());
            domain.put("conceptCount", entry.getValue().size());
            domain.put("isNew", !existingNames.contains(entry.getKey()));
            domains.add(domain);
        }
        return domains;
    }

    private List<Map<String, Object>> detectConflicts(List<Map<String, Object>> concepts, Long groupId) {
        List<String> existingNames = conceptRepository.findAll().stream()
                .filter(c -> groupId == null || groupId.equals(c.getGroupId()))
                .map(Concept::getName)
                .collect(Collectors.toList());

        for (Map<String, Object> concept : concepts) {
            String name = (String) concept.get("name");
            boolean conflict = existingNames.contains(name);
            concept.put("conflict", conflict);
            if (conflict) {
                concept.put("conflictMessage", "概念名称 \"" + name + "\" 已存在");
            }
        }
        return concepts;
    }

    private String extractJsonArray(String text) {
        int start = text.indexOf('[');
        int end = text.lastIndexOf(']');
        if (start >= 0 && end > start) {
            return text.substring(start, end + 1);
        }
        return null;
    }

    private String sanitizeJson(String json) {
        if (json == null) return null;
        String s = json.trim();
        if (s.startsWith("```")) {
            s = s.replaceAll("```json\\s*", "").replaceAll("```\\s*", "").trim();
        }
        int start = s.indexOf('{');
        if (start < 0) start = s.indexOf('[');
        if (start > 0) s = s.substring(start);
        if (s.isEmpty()) return json;

        int quoteCount = 0;
        boolean escaped = false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (escaped) { escaped = false; continue; }
            if (c == '\\') { escaped = true; continue; }
            if (c == '"') quoteCount++;
        }
        if (quoteCount % 2 != 0) {
            s = s + "\"";
            log.warn("[sanitize-json] 修复未闭合的字符串引号");
        }

        int braceCount = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '{' || c == '[') braceCount++;
            else if (c == '}' || c == ']') braceCount--;
        }
        char firstChar = s.charAt(0);
        char closingChar = firstChar == '{' ? '}' : ']';
        for (int i = 0; i < braceCount; i++) {
            s += closingChar;
        }
        if (braceCount > 0) {
            log.warn("[sanitize-json] 修复 {} 个未闭合的花括号/方括号", braceCount);
        }

        return s;
    }

    private static class ImportSession {
        String sourceType;
        Path filePath;
        String summary;
        List<Map<String, String>> llmMessages;
        Long industryId;
        Long groupId;
        long createdAt;

        ImportSession(String sourceType, Path filePath, String summary, Long groupId, Long industryId) {
            this.sourceType = sourceType;
            this.filePath = filePath;
            this.summary = summary;
            this.groupId = groupId;
            this.industryId = industryId;
            this.llmMessages = new ArrayList<>();
            this.createdAt = System.currentTimeMillis();
        }
    }

    private static class LLMResult {
        String code;
        String clarification;
        String rawResponse;
    }

    private LLMResult callLLMWithHistory(String sourceType, ImportSession session) {
        LLMResult result = new LLMResult();
        try {
            AgentConfig config = agentConfigRepository.findByIsDefaultTrue().orElse(null);
            if (config == null) {
                log.warn("[import-stream] 无默认AgentConfig");
                return result;
            }

            String apiKey = agentConfigService.decrypt(config.getSecretKeyEnc());
            String baseUrl = config.getModelEndpoint();
            if (!baseUrl.endsWith("/v1")) {
                baseUrl = baseUrl.replaceAll("/+$", "") + "/v1";
            }

            String ext = sourceType.toLowerCase();
            String libHint = switch (ext) {
                case "excel", "xlsx", "xls" -> "使用 openpyxl 库读取 Excel 文件";
                case "owl", "rdf", "xml" -> "使用 xml.etree.ElementTree 或 rdflib 库解析 RDF/OWL XML 文件";
                case "swagger", "openapi" -> "使用 json 或 yaml 库解析 OpenAPI/Swagger 规范文件";
                case "json" -> "使用 json 库解析 JSON 文件";
                case "yaml", "yml" -> "使用 yaml 库解析 YAML 文件";
                default -> "使用合适的 Python 库解析文件";
            };

            String systemMsg = "你是一个代码生成器。只输出 Python 代码，不要输出任何解释、分析或推理过程。"
                    + "根据文件摘要信息，推断最合理的解析方式并直接输出代码。"
                    + "即使信息不完整，也要选择最合理的推断生成代码，不要提问。";

            List<Map<String, String>> messages = new ArrayList<>();
            messages.add(Map.of("role", "system", "content", systemMsg));

            if (session.llmMessages.isEmpty()) {
                String prompt = "你是一个 Python 专家。请编写 Python 代码来解析一个" + sourceType + "格式的文件，提取所有概念（业务实体/类）。\n\n"
                        + libHint + "\n\n"
                        + "文件路径在全局变量 _IMPORT_FILE_PATH 中。\n\n"
                        + "文件内容摘要：\n" + session.summary + "\n\n"
                        + "你的代码必须：\n"
                        + "1. 读取 _IMPORT_FILE_PATH 指向的文件\n"
                        + "2. 解析并提取所有概念\n"
                        + "3. 对每个概念提取：name（英文标识）、description（描述）、parentName（父概念，如有层级关系）、domain（所属域/分组，如 Excel 的 sheet 名称或分类名）、relations（关系列表，每项 { type: 关系类型, target: 目标概念名 }）\n"
                        + "4. 使用 print(json.dumps(concepts)) 输出 JSON 数组\n\n"
                        + "每个概念格式：{ \"name\": \"CamelCase\", \"description\": \"...\", \"parentName\": \"...\", \"domain\": \"...\", \"relations\": [{\"type\": \"关系类型\", \"target\": \"OtherConcept\", \"expression\": \"计算公式(可选)\", \"description\": \"关系描述(可选)\"}] }\n\n"
                        + "可用关系类型：\n"
                        + getRelationPromptString(session.industryId) + "\n"
                        + "以上为已有关系类型供参考。如果文件中出现的新关系类型不在上表中，也请原样提取，不要强行映射到已有类型\n\n"
                        + "重要规则：\n"
                        + "- 不要定义 _IMPORT_FILE_PATH，它已经存在，直接使用即可\n"
                        + "- 如果有多层级结构，提取父子关系，但只生成一条 PART_OF（子→父）关系，不要同时生成反向的 CONTAINS（父→子），避免冗余\n"
                        + "- 必须 import json\n"
                        + "- 代码中不要有 print 调试语句，只有最后的 print(json.dumps(concepts))\n"
                        + "- 如果文件为空或无有效数据，输出空数组 []\n"
                        + "- 注意 Python 语法：dict 键值对之间必须有逗号，函数参数之间必须有逗号\n"
                        + "- description 提取规则：每个概念都要提取描述，包括层级路径中的中间节点和被引用的来源概念，不要遗漏\n"
                        + "- 同名概念去重：如果同一概念在多个地方出现，合并为一个，保留第一个非空 description\n\n";

                if (sourceType != null && List.of("excel", "xlsx", "xls").contains(sourceType.toLowerCase())) {
                    prompt += "Excel 特有规则：\n"
                            + "- 只解析【数据Sheet】，跳过所有标注为【元数据Sheet】的封面/版权/说明页\n"
                            + "- 分析所有数据Sheet之间的关系：识别是否存在汇总Sheet（包含所有域数据）与子Sheet（按域拆分）的重复，选择一种策略避免重复导入同一概念\n"
                            + "- 域（domain）提取：如果层级路径中包含域前缀（如 Market Domain.Product ABE），从中提取域；否则用 Sheet 名作为域\n\n";
                }

                if (sourceType != null && List.of("owl", "rdf", "xml").contains(sourceType.toLowerCase())) {
                    prompt += "OWL/RDF XML 特有规则：\n"
                            + "- 这是一个 OWL 本体文件（TBox），需提取其中的类定义、层级关系、对象属性约束\n"
                            + "- First study the file summary to understand the actual structure and namespaces used in this specific file. Do NOT assume any fixed element names or attribute names — different tools serialize OWL differently.\n"
                            + "- Your code MUST implement TWO passes:\n"
                            + "\n"
                            + "=== PASS 1: Extract classes from owl:Class elements ===\n"
                            + "- For each owl:Class, extract: identifier (rdf:ID or rdf:about), label (rdfs:label), description (rdfs:comment), parent class (rdfs:subClassOf with rdf:resource pointing to another class)\n"
                            + "- Also extract embedded restrictions within each class (owl:Restriction inside rdfs:subClassOf or owl:intersectionOf):\n"
                            + "  * If the restriction has owl:onProperty + owl:someValuesFrom/owl:allValuesFrom pointing to another owl:Class → it is a RELATION (type = property name, target = class name)\n"
                            + "\n"
                            + "=== PASS 2: Scan elements outside class definitions that declare object properties ===\n"
                            + "- Many OWL files define properties as top-level elements, NOT nested inside classes. You MUST scan ALL non-class elements in the document.\n"
                            + "- Reasoning chain for Pass 2:\n"
                            + "  1. Iterate over all child elements of the root. Skip elements already processed as classes in Pass 1.\n"
                            + "  2. For each remaining element, check if it has rdfs:domain. If rdfs:domain is missing, skip it.\n"
                            + "  3. If rdfs:domain is present, extract the domain class name. This is the class that owns the property.\n"
                            + "  4. Extract the property's own identifier (rdf:ID or rdf:about) and its rdfs:label as description.\n"
                            + "  5. Check rdfs:range: if it resolves to a known class from Pass 1 → RELATION between domain class and range class. Add {type: property_id, target: range_class_name}.\n"
                            + "  6. If rdfs:range is absent or resolves to a datatype (XSD namespace), skip it — we only extract object properties (relations between classes).\n"
                            + "  7. Add extracted relations to the corresponding class in your concept map. If the class does not yet exist in the map, create it with just the relation data.\n"
                            + "- IMPORTANT: Pass 2 relations should be ADDED to the class data collected in Pass 1, not replace it.\n"
                            + "\n"
                            + "- Strip leading/trailing noise characters (parentheses, quotes, whitespace) from extracted names. Keep only clean identifiers.\n"
                            + "- Extract domain from top-level ontology metadata (e.g., ontology label), not hardcoded.\n\n";
                }

                prompt += "如果信息不足无法确定文件结构，根据已有信息做出最合理的推断并生成代码，"
                        + "不要输出问题或解释，直接输出可运行的 Python 代码。";
                messages.add(Map.of("role", "user", "content", prompt));
            } else {
                messages.addAll(session.llmMessages);
            }

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", config.getModelName());
            body.put("messages", messages);
            body.put("temperature", 0.2);
            body.put("max_tokens", 32768);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/chat/completions"))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(jsonMapper.writeValueAsString(body)))
                    .timeout(Duration.ofSeconds(120))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            log.info("[import-stream] LLM响应: HTTP {}", response.statusCode());

            if (response.statusCode() != 200) {
                log.warn("[import-stream] LLM响应体: {}", response.body());
                return result;
            }

            Map<String, Object> respBody = jsonMapper.readValue(response.body(), Map.class);
            List<Map<String, Object>> choices = (List<Map<String, Object>>) respBody.get("choices");
            if (choices == null || choices.isEmpty()) return result;

            Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
            String content = (String) message.get("content");
            if (content == null || content.isEmpty()) {
                content = (String) message.get("reasoning_content");
            }
            if (content == null || content.isEmpty()) return result;

            result.rawResponse = content;

            log.info("[import-stream] LLM响应长度: {} chars, 完整内容:\n{}",
                    content.length(), content);

            String trimmed = content.trim();

            // 检测是否为澄清问题
            if (trimmed.startsWith("Q:") || trimmed.startsWith("Q：") || trimmed.startsWith("q:")) {
                result.clarification = trimmed.replaceFirst("^[Qq][：:]\\s*", "").trim();
                session.llmMessages.add(Map.of("role", "user", "content", promptForHistory(session)));
                session.llmMessages.add(Map.of("role", "assistant", "content", content));
                return result;
            }

            // 检测是否包含代码块
            String code = extractCodeBlock(trimmed);
            if (code != null) {
                if (!code.contains("print(json.dumps(")) {
                    log.warn("[import-stream] 代码块缺少 print(json.dumps(...)), 代码长度: {} chars, 完整代码:\n{}",
                            code.length(), code);
                    result.clarification = "生成的代码不完整，请重试。";
                    session.llmMessages.add(Map.of("role", "user", "content", promptForHistory(session)));
                    session.llmMessages.add(Map.of("role", "assistant", "content", content));
                    return result;
                }
                result.code = code;
                return result;
            }

            // 如果响应看起来像问题（包含问号且没有代码特征）
            if (trimmed.contains("?") && !trimmed.contains("import ") && !trimmed.contains("def ")) {
                result.clarification = trimmed;
                session.llmMessages.add(Map.of("role", "user", "content", promptForHistory(session)));
                session.llmMessages.add(Map.of("role", "assistant", "content", content));
                return result;
            }

            result.code = code;
            return result;

        } catch (Exception e) {
            log.error("[import-stream] LLM调用异常: {}", e.getMessage(), e);
            return result;
        }
    }

    private String promptForHistory(ImportSession session) {
        return "你是一个 Python 专家。请编写 Python 代码来解析文件，提取所有概念（业务实体/类）。\n\n"
                + "文件路径在全局变量 _IMPORT_FILE_PATH 中，不要重新定义它。\n\n"
                + "文件内容摘要：\n" + session.summary + "\n\n"
                + "每个概念格式：{ \"name\": \"CamelCase\", \"description\": \"...\", \"parentName\": \"...\", \"domain\": \"...\", \"relations\": [...] }\n"
                + "使用 print(json.dumps(concepts)) 输出 JSON 数组。"
                + "注意 Python 语法：dict 和函数参数必须有逗号分隔。";
    }

    private String getRelationPromptString(Long industryId) {
        if (industryId != null) {
            return industryService.toPromptString(industryId);
        }
        return "";
    }
}