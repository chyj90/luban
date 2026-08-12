export interface Application {
  id: number;
  name: string;
  workspaceId: number;
  slug: string;
  color: string;
  icon: string;
  defaultPageId: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppRequest {
  workspaceId: number;
  name: string;
}