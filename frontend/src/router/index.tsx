import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { ProtectedRoute, GuestRoute, PermissionGate, AnyPermissionGate, AppAccessGate, ModelingIndex } from './guards';
import { ReactFlowProvider } from '@xyflow/react';
import { AppLayout } from '@/pages/AppLayout';
import { ModelingLayout } from '@/pages/ModelingLayout';
import { PeopleLayout } from '@/pages/PeopleLayout';
import { WorkLayout } from '@/pages/WorkLayout';
import { LoginPage } from '@/pages/Login/LoginPage';
import { RegisterPage } from '@/pages/Login/RegisterPage';
import { AppHubPage } from '@/pages/AppHub/AppHubPage';
import { AppEntryPage } from '@/pages/AppEntry';
import WorkflowDesigner from '@/pages/workflow/WorkflowDesigner';
import MyWorkflow from '@/pages/workflow/MyWorkflow';
import InstanceDetail from '@/pages/workflow/InstanceDetail';
import FormPreview from '@/pages/workflow/FormPreview';
import SystemListPage from '@/pages/SystemListPage';
import ToolListPage from '@/pages/ToolListPage';
import GatewayPage from '@/pages/GatewayPage';
import AgentConfigPage from '@/pages/AgentConfigPage';
import ApiKeyPage from '@/pages/ApiKeyPage';
import ApiKeyPermissionPage from '@/pages/ApiKeyPermissionPage';
import AgentChatPage from '@/pages/AgentChatPage';
import ConceptEditorPage from '@/pages/ConceptEditorPage';
import ConceptFeedbackPage from '@/pages/ConceptFeedbackPage';
import ConceptSnapshotPage from '@/pages/ConceptSnapshotPage';
import ConceptEmbeddingPage from '@/pages/ConceptEmbeddingPage';
import BindingProfilePage from '@/pages/BindingProfilePage';
import OntologyRegressionPage from '@/pages/OntologyRegressionPage';
import UserListPage from '@/pages/UserListPage';
import RoleManagementPage from '@/pages/RoleManagementPage';
import OrgPage from '@/pages/OrgPage';
import WorkApprovalPage from '@/pages/WorkApprovalPage';
import WorkbenchDataPage from '@/pages/workbench/WorkbenchDataPage';
import { WorkAppPageViewer } from '@/pages/WorkAppPageViewer';

// 建模中心合并前的旧路径：带上 keyId 重定向到权限申请页，避免旧链接退回列表页
function KeyPermissionsRedirect() {
  const { keyId } = useParams();
  return <Navigate to={`/modeling/keys/${keyId}/permissions`} replace />;
}

export const router = createBrowserRouter([
  {
    element: <GuestRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            element: <PermissionGate permission="apps:read" />,
            children: [
              { path: '/apps', element: <AppHubPage /> },
              {
                element: <AppAccessGate />,
                children: [
                  { path: '/apps/:appId', element: <AppEntryPage /> },
                  { path: '/apps/:appId/designer/:id', element: <WorkflowDesigner /> },
                  { path: '/apps/:appId/designer', element: <WorkflowDesigner /> },
                  { path: '/apps/:appId/instances/:id', element: <InstanceDetail /> },
                  { path: '/apps/:appId/forms/:id/preview', element: <FormPreview /> },
                ],
              },
            ],
          },
          {
            // 建模中心：数据接入 + 概念图谱 + 凭据与大模型配置（原 /connect 与 /concept 合并）
            element: <AnyPermissionGate permissions={['connect:systems', 'connect:concepts']} />,
            children: [
              {
                path: '/modeling',
                element: <ModelingLayout />,
                children: [
                  { index: true, element: <ModelingIndex /> },
                  { path: 'systems', element: <SystemListPage /> },
                  { path: 'tools', element: <ToolListPage /> },
                  { path: 'gateway', element: <GatewayPage /> },
                  { path: 'keys', element: <ApiKeyPage /> },
                  { path: 'keys/:keyId/permissions', element: <ApiKeyPermissionPage /> },
                  { path: 'agent', element: <AgentConfigPage /> },
                  { path: 'ontology-groups', element: <Navigate to="/modeling/concepts" replace /> },
                  { path: 'concepts', element: <ReactFlowProvider><ConceptEditorPage /></ReactFlowProvider> },
                  { path: 'binding-profiles', element: <BindingProfilePage /> },
                  { path: 'ontology-regression', element: <OntologyRegressionPage /> },
                  { path: 'concept-feedback', element: <ConceptFeedbackPage /> },
                  // 快照/异步任务已收进语义运营流程，不再挂菜单；路由保留供排查深链访问
                  { path: 'concept-snapshots', element: <ConceptSnapshotPage /> },
                  { path: 'concept-embeddings', element: <ConceptEmbeddingPage /> },
                ],
              },
            ],
          },
          {
            // 三个子页各自校验 people:users / people:org / people:roles，入口任一即可
            element: <AnyPermissionGate permissions={['people:users', 'people:org', 'people:roles']} />,
            children: [
              {
                path: '/people',
                element: <PeopleLayout />,
                children: [
                  { index: true, element: <Navigate to="/people/users" replace /> },
                  { path: 'users', element: <UserListPage /> },
                  { path: 'org', element: <OrgPage /> },
                  { path: 'roles', element: <RoleManagementPage /> },
                ],
              },
            ],
          },
          {
            element: <PermissionGate permission="workbench:read" />,
            children: [
              {
                path: '/work',
                element: <WorkLayout />,
                children: [
                  { index: true, element: <MyWorkflow /> },
                  { path: 'approvals', element: <WorkApprovalPage /> },
                  { path: 'data', element: <WorkbenchDataPage /> },
                  { path: 'instances/:id', element: <InstanceDetail /> },
                  {
                    path: 'app',
                    element: <AppAccessGate />,
                    children: [
                      { path: ':appId/page/:pageId', element: <WorkAppPageViewer /> },
                    ],
                  },
                ],
              },
            ],
          },
          {
            element: <PermissionGate permission="ask:read" />,
            children: [
              { path: '/agent-chat', element: <AgentChatPage /> },
            ],
          },
        ],
      },
      { path: '/workspace', element: <Navigate to="/work" replace /> },
      { path: '/workflow/tasks', element: <Navigate to="/work" replace /> },
      { path: '/workflow/my-workflow', element: <Navigate to="/work" replace /> },
      { path: '/workflow/*', element: <Navigate to="/work" replace /> },
      // 建模中心合并后的旧路径兜底（/connect、/concept → /modeling）
      { path: '/connect', element: <Navigate to="/modeling" replace /> },
      { path: '/connect/systems', element: <Navigate to="/modeling/systems" replace /> },
      { path: '/connect/tools', element: <Navigate to="/modeling/tools" replace /> },
      { path: '/connect/gateway', element: <Navigate to="/modeling/gateway" replace /> },
      { path: '/connect/keys', element: <Navigate to="/modeling/keys" replace /> },
      { path: '/connect/keys/:keyId/permissions', element: <KeyPermissionsRedirect /> },
      { path: '/connect/agent', element: <Navigate to="/modeling/agent" replace /> },
      { path: '/connect/mcp', element: <Navigate to="/modeling/gateway" replace /> },
      { path: '/connect/concepts', element: <Navigate to="/modeling/concepts" replace /> },
      { path: '/connect/ontology-groups', element: <Navigate to="/modeling/concepts" replace /> },
      { path: '/connect/concept-feedback', element: <Navigate to="/modeling/concept-feedback" replace /> },
      { path: '/connect/concept-snapshots', element: <Navigate to="/modeling/concept-snapshots" replace /> },
      { path: '/connect/concept-embeddings', element: <Navigate to="/modeling/concept-embeddings" replace /> },
      { path: '/concept', element: <Navigate to="/modeling" replace /> },
      { path: '/concept/ontology-groups', element: <Navigate to="/modeling/concepts" replace /> },
      { path: '/concept/concepts', element: <Navigate to="/modeling/concepts" replace /> },
      { path: '/concept/concept-feedback', element: <Navigate to="/modeling/concept-feedback" replace /> },
      { path: '/concept/concept-snapshots', element: <Navigate to="/modeling/concept-snapshots" replace /> },
      { path: '/concept/concept-embeddings', element: <Navigate to="/modeling/concept-embeddings" replace /> },
      { path: '/people/departments', element: <Navigate to="/people/org" replace /> },
      { path: '/people/keys', element: <Navigate to="/modeling/keys" replace /> },
      { path: '/people/permissions', element: <Navigate to="/modeling/keys" replace /> },
      { path: '/people/approvals', element: <Navigate to="/work/approvals" replace /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/work" replace />,
  },
]);