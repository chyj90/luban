import { useState, useRef, useEffect } from 'react';
import { createCodePage, deletePage, renamePage } from '@/api';
import { DatasourcePanel } from '@/components/DatasourcePanel';
import { QueryPanel } from '@/components/QueryPanel';
import type { Page } from '@/types/page';
import type { Query } from '@/types/query';
import './EditorSidebar.css';

type TabKey = 'pages' | 'datasources' | 'queries';

interface EditorSidebarProps {
  appId: number;
  currentPageId: number;
  workspaceId: number;
  pages: Page[];
  selectedQuery: Query | null;
  activeTab?: TabKey;
  onPageChange: (pageId: number) => void;
  onPagesChange: () => void;
  onQuerySelect: (query: Query | null) => void;
}

export function EditorSidebar({ appId, currentPageId, workspaceId, pages, selectedQuery, activeTab: controlledActiveTab, onPageChange, onPagesChange, onQuerySelect }: EditorSidebarProps) {
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

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'pages', label: '页面', icon: '📄' },
    { key: 'queries', label: '查询', icon: '⚡' },
    { key: 'datasources', label: '数据源', icon: '🗄️' },
  ];

  return (
    <div className="editor-sidebar">
      <div className="editor-sidebar-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`editor-sidebar-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => {
            setActiveTab(tab.key);
            if (tab.key !== 'queries') onQuerySelect(null);
          }}
            title={tab.label}
          >
            <span className="editor-sidebar-tab-icon">{tab.icon}</span>
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
                  <span className="editor-sidebar-item-icon">{page.isDefault ? '🏠' : '📄'}</span>
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
                        ✓
                      </button>
                      <button
                        className="editor-sidebar-item-rename-cancel"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenaming(null);
                        }}
                      >
                        ✕
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
                        <button className="danger" onClick={(e) => handleDeletePage(e, page)}>删除</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'datasources' && (
          <DatasourcePanel applicationId={appId} />
        )}

        {activeTab === 'queries' && (
          <QueryPanel
            applicationId={appId}
            selectedQuery={selectedQuery}
            onQuerySelect={onQuerySelect}
          />
        )}
      </div>
    </div>
  );
}