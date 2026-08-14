import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePageStore } from '@/stores/pageStore';
import { useAuthStore } from '@/stores/authStore';
import { EditorSidebar } from '@/components/EditorSidebar';
import { InteliPreview } from '@/components/InteliPreview';
import { InteliEditor } from '@/components/InteliEditor';
import { QueryEditor } from '@/components/QueryEditor';
import { AgentPanel } from '@/components/AgentPanel';
import ProcessList from '@/pages/workflow/ProcessList';
import WorkflowDesigner from '@/pages/workflow/WorkflowDesigner';
import MyWorkflow from '@/pages/workflow/MyWorkflow';
import FormList from '@/pages/workflow/FormList';
import FormPreview from '@/pages/workflow/FormPreview';
import InstanceDetail from '@/pages/workflow/InstanceDetail';
import Organization from '@/pages/workflow/Organization';
import { listPages, getApplication, listQueries } from '@/api';
import type { Page } from '@/types/page';
import type { Query } from '@/types/query';
import './AppEditorPage.css';

type EditingFile = 'html' | 'css' | 'js';

type SidebarTab = 'pages' | 'queries' | 'workflow' | 'datasources';

export type WorkflowView =
  | { view: 'processes' }
  | { view: 'designer'; processId?: number; formMode?: boolean; formId?: number }
  | { view: 'my-workflow' }
  | { view: 'forms' }
  | { view: 'form-preview'; formId: number }
  | { view: 'instance-detail'; instanceId: number }
  | { view: 'organization' };

const FILE_TABS: { key: EditingFile; label: string }[] = [
  { key: 'html', label: 'index.html' },
  { key: 'css', label: 'styles.css' },
  { key: 'js', label: 'script.js' },
];

export function AppEditorPage() {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const { currentPage, loading, fetchPage } = usePageStore();
  const user = useAuthStore((s) => s.user);
  const [pages, setPages] = useState<Page[]>([]);
  const [workspaceId, setWorkspaceId] = useState<number>(0);
  const [appName, setAppName] = useState('');
  const [agentOpen, setAgentOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('pages');
  const [selectedQuery, setSelectedQuery] = useState<Query | null>(null);
  const [workflowView, setWorkflowView] = useState<WorkflowView>({ view: 'processes' });
  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [queries, setQueries] = useState<Query[]>([]);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);

  const loadPages = useCallback(() => {
    if (appId) {
      listPages(Number(appId)).then((res) => {
        const pageList = res.data.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        setPages(pageList);
        if (pageList.length > 0) {
          const defaultPage = pageList.find((p) => p.isDefault) || pageList[0];
          listQueries(Number(appId)).then((res) => {
            setQueries(res.data);
            fetchPage(defaultPage.id);
          }).catch(() => {
            setQueries([]);
            fetchPage(defaultPage.id);
          });
        }
      });
    }
  }, [appId, fetchPage]);

  useEffect(() => {
    if (appId) {
      getApplication(Number(appId)).then((res) => {
        setAppName(res.data.name);
        setWorkspaceId(res.data.workspaceId);
      }).catch((err) => {
        console.error('获取应用失败:', err.response?.status, err.response?.data);
      });
      loadPages();
    }
  }, [appId, loadPages]);

  const handleQuerySelect = useCallback((query: { id: number; name: string }) => {
    setEditingFile(null);
    listQueries(Number(appId)).then((res) => {
      const found = res.data.find((q) => q.id === query.id);
      if (found) {
        setSelectedQuery(found);
      }
    }).catch(() => {});
    setSidebarTab('queries');
  }, [appId]);

  const handlePageChange = (pageId: number) => {
    setEditingFile(null);
    setSelectedQuery(null);
    setSidebarTab('pages');
    listQueries(Number(appId)).then((res) => {
      setQueries(res.data);
      fetchPage(pageId);
    }).catch(() => {
      setQueries([]);
      fetchPage(pageId);
    });
  };

  const handleCodeChange = (type: 'html' | 'css' | 'js', value: string) => {
    if (!currentPage) return;
    usePageStore.getState().updatePage(currentPage.id, { [type]: value });
  };

  const handleWorkflowNavigate = useCallback((view: WorkflowView) => {
    setWorkflowView(view);
    setEditingFile(null);
    setSelectedQuery(null);
    setSidebarTab('workflow');
  }, []);

  const handleSidebarTabChange = useCallback((tab: SidebarTab) => {
    setSidebarTab(tab);
    if (tab !== 'workflow') {
      setEditingFile(null);
    }
    if (tab === 'queries') {
      listQueries(Number(appId)).then((res) => {
        setQueries(res.data);
        if (res.data.length > 0 && !selectedQuery) {
          setSelectedQuery(res.data[0]);
        }
      }).catch(() => setQueries([]));
    }
  }, [appId, selectedQuery]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewFullscreen) {
        setPreviewFullscreen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewFullscreen]);

  if (loading || !workspaceId) {
    return (
      <div className="editor-loading">
        <div className="editor-loading-spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  if (!currentPage && sidebarTab !== 'workflow') {
    return (
      <div className="editor-loading">
        <div className="editor-loading-spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="app-editor">
      <header className="app-editor-header">
        <div className="app-editor-header-left">
          <button className="app-editor-back" onClick={() => navigate('/workspace')} title="返回工作区">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="app-editor-logo">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5Z" stroke="#1677ff" fill="#e6f4ff" />
              <path d="M2 17l10 5 10-5" stroke="#1677ff" strokeWidth="2" />
              <path d="M2 12l10 5 10-5" stroke="#1677ff" strokeWidth="2" />
            </svg>
            <span className="app-editor-logo-text">鲁班</span>
          </div>
          <span className="app-editor-breadcrumb-sep">/</span>
          <span className="app-editor-app-name">{appName}</span>
        </div>
        <div className="app-editor-spacer" />
        {user && (
          <div className="app-editor-user">
            <span className="app-editor-user-name">{user.name}</span>
            <div className="app-editor-user-avatar">
              {user.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
          </div>
        )}
      </header>

      <div className="app-editor-body">
        <EditorSidebar
          appId={Number(appId)}
          currentPageId={currentPage?.id ?? 0}
          workspaceId={workspaceId}
          pages={pages}
          selectedQuery={selectedQuery}
          activeTab={sidebarTab}
          workflowView={workflowView}
          onPageChange={handlePageChange}
          onPagesChange={loadPages}
          onQuerySelect={setSelectedQuery}
          onWorkflowNavigate={handleWorkflowNavigate}
          onTabChange={handleSidebarTabChange}
        />

        <div className="app-editor-main">
          {sidebarTab === 'workflow' ? (
            <div className="app-editor-workflow-panel">
              {workflowView.view === 'processes' && (
                <ProcessList
                  embedded
                  appId={Number(appId)}
                  onNavigate={handleWorkflowNavigate}
                />
              )}
              {workflowView.view === 'designer' && (
                <WorkflowDesigner
                  embedded
                  processId={workflowView.processId}
                  formMode={workflowView.formMode}
                  formId={workflowView.formId}
                  appId={Number(appId)}
                  onBack={() => setWorkflowView({ view: workflowView.formMode ? 'forms' : 'processes' })}
                />
              )}
              {workflowView.view === 'my-workflow' && (
                <MyWorkflow
                  embedded
                  onNavigate={handleWorkflowNavigate}
                />
              )}
              {workflowView.view === 'forms' && (
                <FormList
                  embedded
                  appId={Number(appId)}
                  onNavigate={handleWorkflowNavigate}
                />
              )}
              {workflowView.view === 'form-preview' && (
                <FormPreview
                  embedded
                  formId={workflowView.formId}
                  onBack={() => setWorkflowView({ view: 'forms' })}
                />
              )}
              {workflowView.view === 'instance-detail' && (
                <InstanceDetail
                  embedded
                  instanceId={workflowView.instanceId}
                  onBack={() => setWorkflowView({ view: 'my-workflow' })}
                />
              )}
              {workflowView.view === 'organization' && (
                <Organization embedded />
              )}
            </div>
          ) : selectedQuery ? (
            <QueryEditor
              query={selectedQuery}
              applicationId={Number(appId)}
              onQueryUpdate={setSelectedQuery}
            />
          ) : sidebarTab === 'queries' ? (
            <div className="app-editor-query-empty">
              <div className="app-editor-query-empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
              </div>
              <span className="app-editor-query-empty-text">暂无 Query</span>
              <span className="app-editor-query-empty-hint">点击左侧 + 创建查询</span>
            </div>
          ) : editingFile ? (
            <div className="app-editor-code-panel">
              <div className="app-editor-code-header">
                {FILE_TABS.map((tab) => (
                  <div
                    key={tab.key}
                    className={`app-editor-file-tab ${editingFile === tab.key ? 'active' : ''}`}
                  >
                    <span
                      className="app-editor-file-tab-label"
                      onClick={() => setEditingFile(tab.key)}
                    >
                      {tab.label}
                    </span>
                    <button
                      className="app-editor-file-tab-close"
                      onClick={() => setEditingFile(null)}
                      title="关闭"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <div className="app-editor-code-body">
                <InteliEditor
                  activeFile={editingFile}
                  codePage={currentPage.codePage}
                  onCodeChange={handleCodeChange}
                />
              </div>
            </div>
          ) : (
            <div className="app-editor-preview-panel">
              <div className="app-editor-preview-header">
                <span className="app-editor-preview-label">预览</span>
                <div className="app-editor-preview-tabs">
                  {FILE_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      className="app-editor-preview-file-btn"
                      onClick={() => setEditingFile(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="app-editor-preview-spacer" />
                <button
                  className="app-editor-preview-fullscreen-btn"
                  onClick={() => setPreviewFullscreen(true)}
                  title="全屏预览"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </button>
              </div>
              <InteliPreview
                codePage={currentPage.codePage}
                queries={queries}
                userInfo={user ? { id: user.id, name: user.name, email: user.email } : null}
                allPages={pages.map((p) => ({ id: p.id, name: p.name }))}
                onNavigate={handlePageChange}
              />
            </div>
          )}
        </div>
      </div>

      <button
        className={`app-editor-agent-fab ${agentOpen ? 'active' : ''}`}
        onClick={() => setAgentOpen(!agentOpen)}
        title="AI 助手"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </button>

      {agentOpen && currentPage && (
        <>
          <div className="app-editor-agent-backdrop" onClick={() => setAgentOpen(false)} />
          <div className="app-editor-agent-overlay">
            <AgentPanel
              appId={appId || ''}
              currentPageId={currentPage.id}
              currentPageName={currentPage.name}
              onPagesChange={loadPages}
              onPageChange={handlePageChange}
              onQuerySelect={handleQuerySelect}
              onQueriesChange={() => {
                listQueries(Number(appId)).then((res) => setQueries(res.data)).catch(() => setQueries([]));
              }}
            />
          </div>
        </>
      )}

      {previewFullscreen && currentPage && (
        <div className="app-editor-fullscreen-overlay">
          <InteliPreview
            codePage={currentPage.codePage}
            queries={queries}
            userInfo={user ? { id: user.id, name: user.name, email: user.email } : null}
            allPages={pages.map((p) => ({ id: p.id, name: p.name }))}
            onNavigate={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}