package com.luban.service;

import com.luban.entity.ConceptImportLog;
import com.luban.repository.ConceptImportLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptImportLogService {

    private final ConceptImportLogRepository importLogRepository;

    public List<ConceptImportLog> listLogs() {
        return importLogRepository.findAllByOrderByCreatedAtDesc();
    }
}