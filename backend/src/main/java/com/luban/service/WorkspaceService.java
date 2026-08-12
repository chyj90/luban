package com.luban.service;

import com.luban.entity.Workspace;
import com.luban.repository.WorkspaceRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class WorkspaceService {

    private final WorkspaceRepository workspaceRepository;

    public WorkspaceService(WorkspaceRepository workspaceRepository) {
        this.workspaceRepository = workspaceRepository;
    }

    public List<Workspace> listByOwner(Long ownerId) {
        return workspaceRepository.findByOwnerId(ownerId);
    }

    public Workspace create(String name, Long ownerId) {
        Workspace workspace = new Workspace();
        workspace.setName(name);
        workspace.setOwnerId(ownerId);
        return workspaceRepository.save(workspace);
    }
}