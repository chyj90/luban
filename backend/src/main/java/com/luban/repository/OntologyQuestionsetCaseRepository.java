package com.luban.repository;

import com.luban.entity.OntologyQuestionsetCase;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface OntologyQuestionsetCaseRepository extends JpaRepository<OntologyQuestionsetCase, Long> {

    List<OntologyQuestionsetCase> findByPackageNameOrderByCreatedAtAsc(String packageName);

    List<OntologyQuestionsetCase> findByPackageNameAndQuestionIn(String packageName, Collection<String> questions);

    long countByPackageName(String packageName);
}
