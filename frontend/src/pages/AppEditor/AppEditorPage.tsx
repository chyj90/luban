import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { usePageStore } from '@/stores/pageStore';
import { useAuthStore } from '@/stores/authStore';
import { useLoadingStore } from '@/stores/loadingStore';
import { useAgentStore } from '@/stores/agentStore';
import { EditorSidebar } from '@/components/EditorSidebar';
import { InteliPreview } from '@/components/InteliPreview';
import { InteliEditor } from '@/components/InteliEditor';
import { QueryEditor } from '@/components/QueryEditor';
import { AgentPanel } from '@/components/AgentPanel';
import { DevToolbar } from '@/components/DevToolbar';
import ProcessList from '@/pages/workflow/ProcessList';
import WorkflowDesigner from '@/pages/workflow/WorkflowDesigner';
import MyWorkflow from '@/pages/workflow/MyWorkflow';
import FormList from '@/pages/workflow/FormList';
import FormPreview from '@/pages/workflow/FormPreview';
import InstanceDetail from '@/pages/workflow/InstanceDetail';
import Organization from '@/pages/workflow/Organization';
import { listPages, listQueries } from '@/api';
import type { Page } from '@/types/page';
import type { Query } from '@/types/query';
import './AppEditorPage.css';

type EditingFile = 'html' | 'css' | 'js';

type SidebarTab = 'pages' | 'queries' | 'workflow' | 'datasources';

export type WorkflowView =
  | { view: 'processes'; appId?: number }
  | { view: 'designer'; processId?: number; formMode?: boolean; formId?: number; appId?: number }
  | { view: 'my-workflow'; appId?: number }
  | { view: 'forms'; appId?: number }
  | { view: 'form-preview'; formId: number; appId?: number }
  | { view: 'instance-detail'; instanceId: number; appId?: number }
  | { view: 'organization'; appId?: number };

const FILE_TABS: { key: EditingFile; label: string }[] = [
  { key: 'html', label: 'index.html' },
  { key: 'css', label: 'styles.css' },
  { key: 'js', label: 'script.js' },
];

export function AppEditorPage() {
  const { appId } = useParams<{ appId: string }>();
  const { currentPage, loading, fetchPage } = usePageStore();
  const setGlobalLoading = useLoadingStore((s) => s.setLoading);
  const user = useAuthStore((s) => s.user);
  const [pages, setPages] = useState<Page[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('pages');
  const [selectedQuery, setSelectedQuery] = useState<Query | null>(null);
  const [workflowView, setWorkflowView] = useState<WorkflowView>({ view: 'processes', appId: Number(appId) });
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
      loadPages();
    }
  }, [appId, loadPages]);

  const setAppId = useAgentStore((s) => s.setAppId);
  useEffect(() => {
    if (appId) {
      setAppId(Number(appId));
    }
  }, [appId, setAppId]);

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

  const refreshQueries = useCallback(() => {
    listQueries(Number(appId)).then((res) => setQueries(res.data)).catch(() => setQueries([]));
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
    setWorkflowView({ ...view, appId: view.appId ?? Number(appId) });
    setEditingFile(null);
    setSelectedQuery(null);
    setSidebarTab('workflow');
  }, [appId]);

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

  useEffect(() => {
    setGlobalLoading(loading);
  }, [loading, setGlobalLoading]);

  if (loading || !appId) return null;

  if (!currentPage && sidebarTab !== 'workflow') return null;

  return (
    <div className="app-editor">
      <DevToolbar appId={Number(appId)} />

      <div className="app-editor-body">
        <EditorSidebar
          appId={Number(appId)}
          currentPageId={currentPage?.id ?? 0}
          pages={pages}
          selectedQuery={selectedQuery}
          activeTab={sidebarTab}
          workflowView={workflowView}
          queries={queries}
          onQueriesChange={refreshQueries}
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
                  onBack={() => setWorkflowView({ view: workflowView.formMode ? 'forms' : 'processes', appId: Number(appId) })}
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
                  onBack={() => setWorkflowView({ view: 'forms', appId: Number(appId) })}
                />
              )}
              {workflowView.view === 'instance-detail' && (
                <InstanceDetail
                  embedded
                  instanceId={workflowView.instanceId}
                  onBack={() => setWorkflowView({ view: 'my-workflow', appId: Number(appId) })}
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
              onQueriesChange={refreshQueries}
              onWorkflowNavigate={handleWorkflowNavigate}
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