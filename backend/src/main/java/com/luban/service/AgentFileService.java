package com.luban.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luban.entity.AgentFile;
import com.luban.exception.BusinessException;
import com.luban.repository.AgentFileRepository;
import com.luban.security.appaccess.AppAccessService;
import com.luban.security.appaccess.AppAction;
import com.luban.service.parse.FileParser;
import com.luban.service.parse.ParsedFile;
import com.luban.service.parse.TextFileParser;
import lombok.extern.slf4j.Slf4j;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Agent 附件文件服务：上传校验（白名单/大小/magic number）→ 存储 → 一次解析 → 落库。
 * 解析失败即拒收，不落半成品。所有读取入口做归属校验（owner 或应用开发权限）。
 */
@Slf4j
@Service
public class AgentFileService {

    private static final Set<String> ALLOWED_EXTS = Set.of("docx", "txt", "md", "csv", "xlsx", "xls");
    private static final Set<String> OFFICE_EXTS = Set.of("docx", "xlsx", "xls");
    private static final long OFFICE_MAX_BYTES = 20L * 1024 * 1024;
    private static final long TEXT_MAX_BYTES = 10L * 1024 * 1024;
    /** 提取文本 ≤ 该长度时随上传响应返回 previewText，前端直接内联进对话 */
    public static final int INLINE_PREVIEW_CHARS = 8000;
    private static final long PARSE_TIMEOUT_SECONDS = 30;

    private final AgentFileRepository repository;
    private final com.luban.storage.FileStorage storage;
    private final AppAccessService appAccessService;
    private final ObjectMapper objectMapper;
    private final List<FileParser> parsers;
    /** 解析专用线程池：解析失败/超时不占用请求线程池 */
    private final ExecutorService parseExecutor = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "agent-file-parse");
        t.setDaemon(true);
        return t;
    });

    public AgentFileService(AgentFileRepository repository,
                            com.luban.storage.FileStorage storage,
                            AppAccessService appAccessService,
                            ObjectMapper objectMapper,
                            List<FileParser> parsers) {
        this.repository = repository;
        this.storage = storage;
        this.appAccessService = appAccessService;
        this.objectMapper = objectMapper;
        this.parsers = parsers;
    }

    // ------------------------------------------------------------------ upload

    public AgentFile upload(MultipartFile file, Long appId, Long userId) {
        if (appId != null) {
            appAccessService.assertAccess(userId, appId, AppAction.DEVELOP);
        }

        String ext = extractExt(file.getOriginalFilename());
        validateSize(ext, file.getSize());
        byte[] bytes = readBytes(file);
        validateMagic(ext, bytes);

        String fileKey = UUID.randomUUID().toString();
        String storagePath = fileKey + "." + ext;
        storage.store(new ByteArrayInputStream(bytes), bytes.length, storagePath);

        try {
            ParsedFile parsed = parseWithTimeout(ext, bytes);
            if ("csv".equals(ext)) {
                enrichCsvMeta(parsed);
            }
            AgentFile entity = new AgentFile();
            entity.setFileKey(fileKey);
            entity.setOwnerUserId(userId);
            entity.setAppId(appId);
            entity.setOriginalName(trimName(file.getOriginalFilename()));
            entity.setExt(ext);
            entity.setFileType(fileTypeOf(ext));
            entity.setMimeType(file.getContentType());
            entity.setSizeBytes(file.getSize());
            entity.setStoragePath(storagePath);
            entity.setParseStatus("success");
            entity.setTextContent(parsed.textContent());
            entity.setContentChars(parsed.textContent() == null ? 0 : parsed.textContent().length());
            entity.setTruncated(parsed.truncated());
            entity.setMetaJson(toJson(parsed.meta()));
            return repository.save(entity);
        } catch (Exception e) {
            storage.delete(storagePath);
            log.warn("Agent 文件解析失败，拒收: name={}, ext={}", file.getOriginalFilename(), ext, e);
            throw new BusinessException("文件解析失败: " + e.getMessage(), e);
        }
    }

    private ParsedFile parseWithTimeout(String ext, byte[] bytes) throws Exception {
        FileParser parser = parsers.stream().filter(p -> p.supports(ext)).findFirst()
                .orElseThrow(() -> new BusinessException("不支持的文件类型: " + ext));
        Future<ParsedFile> future = parseExecutor.submit(() -> parser.parse(new ByteArrayInputStream(bytes), bytes.length));
        try {
            return future.get(PARSE_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (java.util.concurrent.TimeoutException e) {
            future.cancel(true);
            throw new BusinessException("解析超时（>" + PARSE_TIMEOUT_SECONDS + "s）");
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof IllegalArgumentException iae) throw iae;
            throw new IOException(cause.getMessage(), cause);
        }
    }

    private void enrichCsvMeta(ParsedFile parsed) {
        // 解析器产出的是可变 LinkedHashMap，直接补 CSV 表头
        parsed.meta().put("headers", TextFileParser.csvHeaders(parsed.textContent()));
    }

    // ------------------------------------------------------------------ query / read

    public List<AgentFile> listByApp(Long appId, Long userId) {
        appAccessService.assertAccess(userId, appId, AppAction.DEVELOP);
        return repository.findByAppIdOrderByCreatedAtDesc(appId);
    }

    public AgentFile getByKey(String fileKey) {
        return repository.findByFileKey(fileKey)
                .orElseThrow(() -> new BusinessException("文件不存在: " + fileKey));
    }

    public void assertCanRead(AgentFile file, Long userId) {
        if (file.getOwnerUserId() != null && file.getOwnerUserId().equals(userId)) return;
        if (appAccessService.isSuperAdmin(userId)) return;
        if (file.getAppId() != null) {
            appAccessService.assertAccess(userId, file.getAppId(), AppAction.VIEW);
            return;
        }
        throw new BusinessException("无权访问该文件");
    }

    /** 提取文本分页读取（word/txt/csv） */
    public Map<String, Object> readText(String fileKey, Long userId, int offset, int limit) {
        AgentFile file = getByKey(fileKey);
        assertCanRead(file, userId);
        String text = file.getTextContent() == null ? "" : file.getTextContent();
        int off = Math.max(0, offset);
        int lim = Math.min(Math.max(1, limit), 20000);
        int end = Math.min(text.length(), off + lim);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("fileKey", fileKey);
        result.put("fileType", file.getFileType());
        result.put("totalChars", text.length());
        result.put("offset", off);
        result.put("limit", lim);
        result.put("content", text.substring(off, end));
        result.put("nextOffset", end < text.length() ? end : null);
        return result;
    }

    /** Excel 明细行分页读取：按请求从原始文件重开工作簿，默认 100 行/次，上限 500 */
    public Map<String, Object> readSheet(String fileKey, Long userId, String sheetName, int startRow, int maxRows) {
        AgentFile file = getByKey(fileKey);
        assertCanRead(file, userId);
        if (!"excel".equals(file.getFileType())) {
            throw new BusinessException("该文件不是 Excel 类型");
        }
        int from = Math.max(0, startRow);
        int rows = Math.min(Math.max(1, maxRows), 500);

        DataFormatter formatter = new DataFormatter();
        Path path = storage.resolve(file.getStoragePath());
        try (Workbook wb = WorkbookFactory.create(Files.newInputStream(path))) {
            Sheet sheet = sheetName != null && !sheetName.isBlank()
                    ? wb.getSheet(sheetName)
                    : wb.getSheetAt(0);
            if (sheet == null) {
                throw new BusinessException("工作表不存在: " + sheetName);
            }
            int lastRowNum = sheet.getLastRowNum();
            int cols = sheet.getRow(from) != null && sheet.getRow(from).getLastCellNum() > 0
                    ? sheet.getRow(from).getLastCellNum() : 0;
            List<List<String>> data = new ArrayList<>();
            int end = Math.min(lastRowNum, from + rows - 1);
            for (int r = from; r <= end; r++) {
                List<String> row = new ArrayList<>();
                for (int c = 0; c < cols; c++) {
                    row.add(cellString(sheet, r, c, formatter));
                }
                data.add(row);
            }
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("fileKey", fileKey);
            result.put("sheetName", sheet.getSheetName());
            result.put("totalRows", lastRowNum + 1);
            result.put("startRow", from);
            result.put("rows", data);
            result.put("nextStartRow", end < lastRowNum ? end + 1 : null);
            return result;
        } catch (BusinessException e) {
            throw e;
        } catch (Exception e) {
            throw new BusinessException("读取 Excel 失败: " + e.getMessage(), e);
        }
    }

    private static String cellString(Sheet sheet, int r, int c, DataFormatter formatter) {
        Row row = sheet.getRow(r);
        if (row == null) return "";
        org.apache.poi.ss.usermodel.Cell cell = row.getCell(c);
        if (cell == null) return "";
        String v = formatter.formatCellValue(cell).strip();
        return v.length() > 500 ? v.substring(0, 500) + "…" : v;
    }

    // ------------------------------------------------------------------ delete

    public void delete(String fileKey, Long userId) {
        AgentFile file = getByKey(fileKey);
        // 删除与上传同权：owner 或应用开发权限
        if (!file.getOwnerUserId().equals(userId)) {
            if (!appAccessService.isSuperAdmin(userId)) {
                if (file.getAppId() == null) {
                    throw new BusinessException("无权删除该文件");
                }
                appAccessService.assertAccess(userId, file.getAppId(), AppAction.DEVELOP);
            }
        }
        storage.delete(file.getStoragePath());
        repository.delete(file);
    }

    // ------------------------------------------------------------------ helpers

    /** 供控制器/注入块构建上传响应（不含大字段文本） */
    public Map<String, Object> toResponse(AgentFile file) {
        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("fileKey", file.getFileKey());
        resp.put("name", file.getOriginalName());
        resp.put("ext", file.getExt());
        resp.put("fileType", file.getFileType());
        resp.put("size", file.getSizeBytes());
        resp.put("parseStatus", file.getParseStatus());
        resp.put("contentChars", file.getContentChars());
        resp.put("truncated", file.getTruncated());
        resp.put("summary", buildSummary(file));
        resp.put("meta", fromJson(file.getMetaJson()));
        resp.put("previewText",
                file.getContentChars() != null && file.getContentChars() <= INLINE_PREVIEW_CHARS
                        ? file.getTextContent() : null);
        return resp;
    }

    private String buildSummary(AgentFile file) {
        Map<String, Object> meta = fromJson(file.getMetaJson());
        return switch (file.getFileType()) {
            case "excel" -> {
                Object sheets = meta.get("sheets");
                if (!(sheets instanceof List<?> list) || list.isEmpty()) yield "空工作簿";
                StringBuilder sb = new StringBuilder(list.size() + " 个工作表：");
                int shown = 0;
                for (Object o : list) {
                    if (shown >= 3) {
                        sb.append(" 等");
                        break;
                    }
                    if (shown > 0) sb.append("；");
                    if (o instanceof Map<?, ?> s) {
                        sb.append("「").append(s.get("name")).append("」")
                          .append(s.get("rows")).append("行×").append(s.get("cols")).append("列");
                    }
                    shown++;
                }
                yield sb.toString();
            }
            case "word" -> "正文约 " + file.getContentChars() + " 字，" + meta.getOrDefault("tables", 0) + " 个表格";
            default -> "共 " + meta.getOrDefault("lines", 0) + " 行";
        };
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> fromJson(String json) {
        if (json == null || json.isEmpty()) return Map.of();
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (JsonProcessingException e) {
            return Map.of();
        }
    }

    private static String fileTypeOf(String ext) {
        return switch (ext) {
            case "docx" -> "word";
            case "xlsx", "xls" -> "excel";
            default -> "text";
        };
    }

    private static String extractExt(String name) {
        if (name == null) throw new BusinessException("缺少文件名");
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) throw new BusinessException("文件缺少扩展名");
        String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        if (!ALLOWED_EXTS.contains(ext)) {
            throw new BusinessException("不支持的文件类型: " + ext + "（支持 docx/txt/md/csv/xlsx/xls）");
        }
        return ext;
    }

    private static void validateSize(String ext, long size) {
        long max = OFFICE_EXTS.contains(ext) ? OFFICE_MAX_BYTES : TEXT_MAX_BYTES;
        if (size > max) {
            throw new BusinessException(String.format("文件过大（%.1fMB > %.0fMB 限制）",
                    size / 1024.0 / 1024, max / 1024.0 / 1024));
        }
    }

    private static byte[] readBytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw new BusinessException("读取上传内容失败: " + e.getMessage(), e);
        }
    }

    /** office 格式 magic number 抽查：docx/xlsx 是 zip 头，xls 是 OLE2 头 */
    private static void validateMagic(String ext, byte[] bytes) {
        if (!OFFICE_EXTS.contains(ext)) return;
        if (bytes.length < 8) throw new BusinessException("文件内容过短或已损坏");
        if ("xls".equals(ext)) {
            boolean ole2 = (bytes[0] & 0xFF) == 0xD0 && (bytes[1] & 0xFF) == 0xCF
                    && (bytes[2] & 0xFF) == 0x11 && (bytes[3] & 0xFF) == 0xE0;
            if (!ole2) throw new BusinessException("文件内容与 .xls 格式不符");
            return;
        }
        boolean zip = bytes[0] == 'P' && bytes[1] == 'K' && bytes[2] == 3 && bytes[3] == 4;
        if (!zip) throw new BusinessException("文件内容与 ." + ext + " 格式不符（缺少 zip 头）");
    }

    private static String trimName(String name) {
        String n = name == null ? "unnamed" : name;
        return n.length() > 500 ? n.substring(n.length() - 500) : n;
    }

    private String toJson(Object meta) {
        try {
            return objectMapper.writeValueAsString(meta);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }
}
