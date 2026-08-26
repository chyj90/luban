package com.luban.repository;

import com.luban.entity.ChatDatasourceSelection;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface ChatDatasourceSelectionRepository extends JpaRepository<ChatDatasourceSelection, Long> {

    Optional<ChatDatasourceSelection> findByMessageId(String messageId);

    List<ChatDatasourceSelection> findBySessionId(String sessionId);

    void deleteBySessionId(String sessionId);
}