import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute, GuestRoute } from './guards';
import { ReactFlowProvider } from '@xyflow/react';
import { AppLayout } from '@/pages/AppLayout';
import { ConnectLayout } from '@/pages/ConnectLayout';
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
import AgentChatPage from '@/pages/AgentChatPage';
import ConceptEditorPage from '@/pages/ConceptEditorPage';
import UserListPage from '@/pages/UserListPage';
import RoleManagementPage from '@/pages/RoleManagementPage';
import OrgPage from '@/pages/OrgPage';
import MemberListPage from '@/pages/MemberListPage';
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
            path: '/connect',
            element: <ConnectLayout />,
            children: [
              { index: true, element: <Navigate to="/connect/systems" replace /> },
              { path: 'systems', element: <SystemListPage /> },
              { path: 'tools', element: <ToolListPage /> },
              { path: 'gateway', element: <GatewayPage /> },
              { path: 'keys', element: <ApiKeyPage /> },
              { path: 'agent', element: <AgentConfigPage /> },
              { path: 'concepts', element: <ReactFlowProvider><ConceptEditorPage /></ReactFlowProvider> },
            ],
          },
          {
            path: '/people',
            element: <PeopleLayout />,
            children: [
              { index: true, element: <Navigate to="/people/users" replace /> },
              { path: 'users', element: <UserListPage /> },
              { path: 'org', element: <OrgPage /> },
              { path: 'members', element: <MemberListPage /> },
              { path: 'roles', element: <RoleManagementPage /> },
            ],
          },
          {
            path: '/work',
            element: <WorkLayout />,
            children: [
              { index: true, element: <MyWorkflow /> },
              { path: 'approvals', element: <WorkApprovalPage /> },
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