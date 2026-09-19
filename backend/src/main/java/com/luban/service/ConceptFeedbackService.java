package com.luban.service;

import com.luban.entity.ConceptFeedback;
import com.luban.repository.ChatMessageRepository;
import com.luban.repository.ConceptFeedbackRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.NoSuchElementException;

/**
 * 回答反馈（轻量信号采集）：用户在问数页对答案点 👍/👎 并可附一句话说明。
 *
 * 这里只负责采集与人工处理（忽略/删除）；不再做 LLM 分析、变更建议、预览应用——
 * 那条专家链路已废弃，本体变更统一走变更审核（问数 agent 的 ontology_action、
 * 建模 agent 的 propose）。反馈作为高优先级信号进入问题洞察（QuestionGapMiningService）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ConceptFeedbackService {

    private final ConceptFeedbackRepository feedbackRepository;
    private final ChatMessageRepository chatMessageRepository;

    @Transactional(readOnly = true)
    public List<ConceptFeedback> listBySession(String sessionId) {
        return feedbackRepository.findBySessionIdOrderByCreatedAtDesc(sessionId);
    }

    @Transactional(readOnly = true)
    public List<ConceptFeedback> listByStatus(String status) {
        return feedbackRepository.findByStatusOrderByCreatedAtDesc(status);
    }

    @Transactional(readOnly = true)
    public List<ConceptFeedback> listAll() {
        return feedbackRepository.findAllByOrderByCreatedAtDesc();
    }

    @Transactional(readOnly = true)
    public ConceptFeedback getById(Long id) {
        return feedbackRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("反馈记录不存在: " + id));
    }

    /**
     * 问数页问题反馈：快照当时的用户问题、回答与 SQL，作为坏答案的人工标记。
     */
    @Transactional
    public ConceptFeedback createProblemFeedback(String sessionId, String messageId,
                                                   String userDescription,
                                                   String userQuestion) {
        ConceptFeedback feedback = new ConceptFeedback();
        feedback.setSessionId(sessionId);
        feedback.setMessageId(messageId);
        feedback.setUserDescription(userDescription);
        feedback.setUserFeedback(userDescription);
        feedback.setFeedbackType("problem_feedback");
        feedback.setStatus("pending");

        chatMessageRepository.findByMessageIdAndRole(messageId, "user").ifPresent(userMsg -> {
            String content = userMsg.getContent();
            if (content != null && !content.isBlank()) {
                feedback.setUserQuestion(content);
            }
        });

        if (feedback.getUserQuestion() == null || feedback.getUserQuestion().isBlank()) {
            feedback.setUserQuestion(userQuestion != null ? userQuestion : "");
        }

        chatMessageRepository.findByMessageIdAndRole(messageId, "assistant").ifPresent(assistantMsg -> {
            if (assistantMsg.getContent() != null && !assistantMsg.getContent().isBlank()) {
                feedback.setLlmAnswer(assistantMsg.getContent());
            }
            if (assistantMsg.getNl2sql() != null && !assistantMsg.getNl2sql().isBlank()) {
                feedback.setGeneratedSql(assistantMsg.getNl2sql());
            }
        });

        return feedbackRepository.save(feedback);
    }

    @Transactional
    public ConceptFeedback ignore(Long id, String reviewedBy, String reviewComment) {
        ConceptFeedback feedback = getById(id);
        feedback.setStatus("ignored");
        feedback.setReviewedBy(reviewedBy);
        feedback.setReviewComment(reviewComment);
        return feedbackRepository.save(feedback);
    }

    @Transactional
    public void delete(Long id) {
        feedbackRepository.deleteById(id);
    }
}
