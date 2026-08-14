export interface Application {
  id: number;
  name: string;
  createdBy: number;
  slug: string;
  color: string;
  icon: string;
  defaultPageId: number;
  createdAt: string;
  updatedAt: string;
  workflowCount?: number;
  publishedWorkflowCount?: number;
}

export interface CreateAppRequest {
  name: string;
}