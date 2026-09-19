package com.luban.repository;

import com.luban.entity.FederationBridge;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FederationBridgeRepository extends JpaRepository<FederationBridge, Long> {
    List<FederationBridge> findByLeftDatasourceIdOrRightDatasourceId(Long leftId, Long rightId);
}
