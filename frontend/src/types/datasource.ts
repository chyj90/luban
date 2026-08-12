export type DatasourceType = 'MySQL' | 'PostgreSQL' | 'REST_API';

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
  applicationId: number;
  name: string;
  type: DatasourceType;
  config: DatasourceConfig;
  status: 'pending' | 'connected' | 'error';
  createdAt: string;
}

export interface CreateDatasourceRequest {
  applicationId: number;
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