export type DatasourceType = string;

export type DatasourceSlug = 'APPLICATION' | 'PLATFORM' | 'REF';

export interface DriverInfo {
  id: number;
  name: string;
  displayName: string;
  description: string;
  category: string;
  driverClass: string;
  jdbcUrlTemplate: string;
  defaultPort: number;
  groupId: string;
  artifactId: string;
  version: string;
  classifier: string | null;
  installed: boolean;
  builtin: boolean;
  enabled: boolean;
  extraFields: ExtraField[] | null;
  hideStandardFields: boolean;
}

export interface ExtraField {
  name: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password' | 'select';
  required: boolean;
}

export interface InstallProgress {
  phase: 'DOWNLOADING' | 'REGISTERING' | 'COMPLETE' | 'ERROR';
  fileName: string;
  current: number;
  total: number;
  percent: number;
}

export interface DatasourceConfig {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  [key: string]: unknown;
}

export interface Datasource {
  id: number;
  ownerId?: number;
  slug: DatasourceSlug;
  name: string;
  type: DatasourceType;
  config: DatasourceConfig;
  status: 'pending' | 'connected' | 'error';
  createdAt: string;
}

export interface CreateDatasourceRequest {
  ownerId?: number;
  slug: DatasourceSlug;
  name: string;
  type: DatasourceType;
  config: DatasourceConfig;
}

export interface TestDatasourceResponse {
  success: boolean;
  message: string;
}

export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface TableStructure {
  name: string;
  columns: TableColumn[];
}

export interface DatasourceStructure {
  tables: TableStructure[];
}