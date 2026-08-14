package com.luban.workflow.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

@RestController
@RequestMapping("/api/v1/files")
@RequiredArgsConstructor
public class FileUploadController {

    private static final String UPLOAD_DIR = System.getProperty("java.io.tmpdir") + File.separator + "luban-uploads";

    @PostMapping("/upload")
    public ResponseEntity<Map<String, Object>> upload(@RequestParam("file") MultipartFile file) {
        try {
            Path uploadPath = Paths.get(UPLOAD_DIR);
            if (!Files.exists(uploadPath)) {
                Files.createDirectories(uploadPath);
            }

            String fileId = UUID.randomUUID().toString();
            String originalName = file.getOriginalFilename();
            String extension = "";
            if (originalName != null && originalName.contains(".")) {
                extension = originalName.substring(originalName.lastIndexOf("."));
            }
            String storedName = fileId + extension;
            Path filePath = uploadPath.resolve(storedName);
            file.transferTo(filePath.toFile());

            String thumbnailUrl = null;
            String contentType = file.getContentType();
            if (contentType != null && contentType.startsWith("image/")) {
                thumbnailUrl = "/api/v1/files/thumbnail/" + storedName;
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("fileId", fileId);
            result.put("fileName", originalName);
            result.put("fileSize", file.getSize());
            result.put("fileType", contentType);
            result.put("fileUrl", "/api/v1/files/download/" + storedName);
            result.put("thumbnailUrl", thumbnailUrl);
            return ResponseEntity.ok(result);
        } catch (IOException e) {
            return ResponseEntity.internalServerError().body(Map.of("error", "文件上传失败: " + e.getMessage()));
        }
    }

    @GetMapping("/download/{fileName}")
    public ResponseEntity<byte[]> download(@PathVariable String fileName) {
        try {
            Path filePath = Paths.get(UPLOAD_DIR, fileName);
            if (!Files.exists(filePath)) {
                return ResponseEntity.notFound().build();
            }
            byte[] content = Files.readAllBytes(filePath);
            return ResponseEntity.ok()
                    .header("Content-Disposition", "attachment; filename=\"" + fileName + "\"")
                    .body(content);
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @GetMapping("/thumbnail/{fileName}")
    public ResponseEntity<byte[]> thumbnail(@PathVariable String fileName) {
        try {
            Path filePath = Paths.get(UPLOAD_DIR, fileName);
            if (!Files.exists(filePath)) {
                return ResponseEntity.notFound().build();
            }
            byte[] content = Files.readAllBytes(filePath);
            return ResponseEntity.ok()
                    .header("Content-Type", "image/jpeg")
                    .body(content);
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @DeleteMapping("/{fileName}")
    public ResponseEntity<Void> delete(@PathVariable String fileName) {
        try {
            Path filePath = Paths.get(UPLOAD_DIR, fileName);
            Files.deleteIfExists(filePath);
            return ResponseEntity.noContent().build();
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }
}