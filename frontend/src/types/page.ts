export interface Page {
  id: number;
  name: string;
  applicationId: number;
  slug: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CodePageData {
  html: string;
  css: string;
  js: string;
  libraries: string[];
  queryIds: number[];
}

export interface CodePage extends Page {
  codePage: CodePageData;
}

export interface CreateCodePageRequest {
  applicationId: number;
  name: string;
  html?: string;
  css?: string;
  js?: string;
  libraries?: string[];
  queryIds?: number[];
}

export interface UpdateCodePageRequest {
  html?: string;
  css?: string;
  js?: string;
  libraries?: string[];
  queryIds?: number[];
}