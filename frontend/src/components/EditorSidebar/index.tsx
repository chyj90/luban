import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DatasourcePanel } from '@/components/DatasourcePanel';
import { QueryPanel } from '@/components/QueryPanel';
import { createCodePage, deletePage, renamePage } from '@/api';
import type { Page } from '@/types/page';
import type { Query } from '@/types/query';
import type { WorkflowView } from '@/pages/AppEditor/AppEditorPage';
import './EditorSidebar.css';

type TabKey = 'pages' | 'queries' | 'workflow' | 'datasources';

interface EditorSidebarProps {
  appId: number;
  currentPageId: number;
  workspaceId: number;
  pages: Page[];
  selectedQuery: Query | null;
  activeTab?: TabKey;
  workflowView?: WorkflowView;
  onPageChange: (pageId: number) => void;
  onPagesChange: () => void;
  onQuerySelect: (query: Query | null) => void;
  onWorkflowNavigate: (view: WorkflowView) => void;
  onTabChange: (tab: TabKey) => void;
}

export function EditorSidebar({ appId, currentPageId, workspaceId, pages, selectedQuery, activeTab: controlledActiveTab, workflowView, onPageChange, onPagesChange, onQuerySelect, onWorkflowNavigate, onTabChange }: EditorSidebarProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>(controlledActiveTab || 'pages');
  const [newPageName, setNewPageName] = useState('');
  const [showNewPage, setShowNewPage] = useState(false);
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameName, setRenameName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (controlledActiveTab) {
      setActiveTab(controlledActiveTab);
    }
  }, [controlledActiveTab]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCreatePage = async () => {
    if (!newPageName.trim()) return;
    try {
      await createCodePage({ applicationId: appId, name: newPageName.trim() });
      setNewPageName('');
      setShowNewPage(false);
      onPagesChange();
    } catch { /* ignore */ }
  };

  const handleDeletePage = async (e: React.MouseEvent, page: Page) => {
    e.stopPropagation();
    setMenuOpen(null);
    if (!confirm(`确定删除页面「${page.name}」？此操作不可撤销。`)) return;
    try {
      await deletePage(page.id);
      onPagesChange();
    } catch { /* ignore */ }
  };

  const handleRenameStart = (e: React.MouseEvent, page: Page) => {
    e.stopPropagation();
    setMenuOpen(null);
    setRenaming(page.id);
    setRenameName(page.name);
  };

  const handleRenameSubmit = async (pageId: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await renamePage(pageId, trimmed);
      setRenaming(null);
      onPagesChange();
    } catch { /* ignore */ }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'pages', label: '页面' },
    { key: 'queries', label: '查询' },
    { key: 'workflow', label: '流程' },
    { key: 'datasources', label: '数据源' },
  ];

  const tabIcon = (key: TabKey) => {
    switch (key) {
      case 'pages':
        return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>;
      case 'queries':
        return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>;
      case 'workflow':
        return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8v8H8z"/></svg>;
      case 'datasources':
        return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7v10c0 2 1.79 3 4 3h8c2.21 0 4-1 4-3V7"/><path d="M4 7c0 2 1.79 4 4 4h8c2.21 0 4-2 4-4"/><path d="M4 7c0-2 1.79-4 4-4h8c2.21 0 4 2 4 4"/></svg>;
    }
  };

  return (
    <div className="editor-sidebar">
      <div className="editor-sidebar-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`editor-sidebar-tab ${activeTab === tab.key ? 'active' : ''} ${tab.key === 'datasources' ? 'editor-sidebar-tab-bottom' : ''}`}
            onClick={() => {
            setActiveTab(tab.key);
            onTabChange(tab.key);
            if (tab.key !== 'queries' && tab.key !== 'workflow') onQuerySelect(null);
          }}
            title={tab.label}
          >
            <span className="editor-sidebar-tab-icon">{tabIcon(tab.key)}</span>
            <span className="editor-sidebar-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="editor-sidebar-panel">
        {activeTab === 'pages' && (
          <div className="editor-sidebar-section">
            <div className="editor-sidebar-section-header">
              <span>页面列表</span>
              <button
                className="editor-sidebar-add-btn"
                onClick={() => setShowNewPage(!showNewPage)}
              >
                +
              </button>
            </div>
            {showNewPage && (
              <div className="editor-sidebar-new-form">
                <input
                  value={newPageName}
                  onChange={(e) => setNewPageName(e.target.value)}
                  placeholder="页面名称"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreatePage()}
                  autoFocus
                />
                <button onClick={handleCreatePage}>创建</button>
              </div>
            )}
            <div className="editor-sidebar-list">
              {pages.map((page) => (
                <div
                  key={page.id}
                  className={`editor-sidebar-item ${page.id === currentPageId ? 'active' : ''} ${renaming === page.id ? 'renaming' : ''}`}
                  onClick={() => onPageChange(page.id)}
                >
                  <span className="editor-sidebar-item-icon">
                    {page.isDefault ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    )}
                  </span>
                  {renaming === page.id ? (
                    <>
                      <input
                        className="editor-sidebar-item-rename-input"
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSubmit(page.id, renameName);
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                      <button
                        className="editor-sidebar-item-rename-ok"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameSubmit(page.id, renameName);
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                      </button>
                      <button
                        className="editor-sidebar-item-rename-cancel"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenaming(null);
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </>
                  ) : (
                    <span className="editor-sidebar-item-name">{page.name}</span>
                  )}
                  <div className="editor-sidebar-item-menu" ref={menuOpen === page.id ? menuRef : null}>
                    <button
                      className="editor-sidebar-item-dots"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(menuOpen === page.id ? null : page.id);
                      }}
                    >
                      ⋯
                    </button>
                    {menuOpen === page.id && (
                      <div className="editor-sidebar-item-dropdown">
                        <button onClick={(e) => handleRenameStart(e, page)}>重命名</button>
                        <button className="danger" onClick={(e) => handleDeletePage(e, page)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                        删除
                      </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'queries' && (
          <QueryPanel
            applicationId={appId}
            selectedQuery={selectedQuery}
            onQuerySelect={onQuerySelect}
          />
        )}

        {activeTab === 'workflow' && (
          <div className="editor-sidebar-section">
            <div className="editor-sidebar-section-header">
              <span>流程管理</span>
            </div>
            <div className="editor-sidebar-list">
              <div
                className={`editor-sidebar-item ${workflowView?.view === 'processes' ? 'active' : ''}`}
                onClick={() => onWorkflowNavigate({ view: 'processes' })}
              >
                <span className="editor-sidebar-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8v8H8z"/></svg>
              </span>
              <span className="editor-sidebar-item-name">流程定义</span>
              </div>
              <div
                className={`editor-sidebar-item ${workflowView?.view === 'forms' || workflowView?.view === 'form-preview' ? 'active' : ''}`}
                onClick={() => onWorkflowNavigate({ view: 'forms' })}
              >
                <span className="editor-sidebar-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </span>
              <span className="editor-sidebar-item-name">表单管理</span>
              </div>
              <div
                className={`editor-sidebar-item ${workflowView?.view === 'my-workflow' || workflowView?.view === 'instance-detail' ? 'active' : ''}`}
                onClick={() => onWorkflowNavigate({ view: 'my-workflow' })}
              >
                <span className="editor-sidebar-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
              </span>
              <span className="editor-sidebar-item-name">我的工作</span>
              </div>
              <div
                className={`editor-sidebar-item ${workflowView?.view === 'organization' ? 'active' : ''}`}
                onClick={() => onWorkflowNavigate({ view: 'organization' })}
              >
                <span className="editor-sidebar-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </span>
              <span className="editor-sidebar-item-name">组织架构</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'datasources' && (
          <DatasourcePanel applicationId={appId} />
        )}
      </div>
    </div>
  );
}