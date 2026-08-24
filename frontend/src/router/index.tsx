import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute, GuestRoute, PermissionGate } from './guards';
import { ReactFlowProvider } from '@xyflow/react';
import { AppLayout } from '@/pages/AppLayout';
import { ConnectLayout } from '@/pages/ConnectLayout';
import { ConceptLayout } from '@/pages/ConceptLayout';
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
import OntologyGroupPage from '@/pages/OntologyGroupPage';
import ConceptFeedbackPage from '@/pages/ConceptFeedbackPage';
import ConceptSnapshotPage from '@/pages/ConceptSnapshotPage';
import ConceptEmbeddingPage from '@/pages/ConceptEmbeddingPage';
import UserListPage from '@/pages/UserListPage';
import RoleManagementPage from '@/pages/RoleManagementPage';
import OrgPage from '@/pages/OrgPage';
import WorkApprovalPage from '@/pages/WorkApprovalPage';

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
          { path: '/apps', element: <AppHubPage /> },
          { path: '/apps/:appId', element: <AppEntryPage /> },
          { path: '/apps/:appId/designer/:id', element: <WorkflowDesigner /> },
          { path: '/apps/:appId/designer', element: <WorkflowDesigner /> },
          { path: '/apps/:appId/instances/:id', element: <InstanceDetail /> },
          { path: '/apps/:appId/forms/:id/preview', element: <FormPreview /> },
          {
            element: <PermissionGate permission="connect:systems" />,
            children: [
              {
                path: '/connect',
                element: <ConnectLayout />,
                children: [
                  { index: true, element: <Navigate to="/connect/systems" replace /> },
                  { path: 'systems', element: <SystemListPage /> },
                  { path: 'tools', element: <ToolListPage /> },
                  { path: 'gateway', element: <GatewayPage /> },
                  { path: 'keys', element: <ApiKeyPage /> },
                  { path: 'keys/:keyId/permissions', element: <ApiKeyPermissionPage /> },
                  { path: 'agent', element: <AgentConfigPage /> },
                ],
              },
            ],
          },
          {
            element: <PermissionGate permission="connect:concepts" />,
            children: [
              {
                path: '/concept',
                element: <ConceptLayout />,
                children: [
                  { index: true, element: <Navigate to="/concept/ontology-groups" replace /> },
                  { path: 'ontology-groups', element: <OntologyGroupPage /> },
                  { path: 'concepts', element: <ReactFlowProvider><ConceptEditorPage /></ReactFlowProvider> },
                  { path: 'concept-feedback', element: <ConceptFeedbackPage /> },
                  { path: 'concept-snapshots', element: <ConceptSnapshotPage /> },
                  { path: 'concept-embeddings', element: <ConceptEmbeddingPage /> },
                ],
              },
            ],
          },
          {
            element: <PermissionGate permission="people:users" />,
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
                ],
              },
            ],
          },
          { path: '/agent-chat', element: <AgentChatPage /> },
        ],
      },
      { path: '/workspace', element: <Navigate to="/apps" replace /> },
      { path: '/workflow/tasks', element: <Navigate to="/work" replace /> },
      { path: '/workflow/my-workflow', element: <Navigate to="/work" replace /> },
      { path: '/workflow/*', element: <Navigate to="/apps" replace /> },
      { path: '/connect/mcp', element: <Navigate to="/connect/gateway" replace /> },
      { path: '/connect/concepts', element: <Navigate to="/concept/concepts" replace /> },
      { path: '/connect/ontology-groups', element: <Navigate to="/concept/ontology-groups" replace /> },
      { path: '/connect/concept-feedback', element: <Navigate to="/concept/concept-feedback" replace /> },
      { path: '/connect/concept-snapshots', element: <Navigate to="/concept/concept-snapshots" replace /> },
      { path: '/connect/concept-embeddings', element: <Navigate to="/concept/concept-embeddings" replace /> },
      { path: '/people/departments', element: <Navigate to="/people/org" replace /> },
      { path: '/people/keys', element: <Navigate to="/connect/keys" replace /> },
      { path: '/people/permissions', element: <Navigate to="/connect/keys" replace /> },
      { path: '/people/approvals', element: <Navigate to="/work/approvals" replace /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/apps" replace />,
  },
]);