import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import Select from '@/components/Select';
import './index.css';

export interface Column<T> {
  key: string;
  title: string;
  className?: string;
  render: (item: T, index: number) => React.ReactNode;
}

export interface PaginationConfig {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (item: T, index: number) => string | number;
  loading?: boolean;
  emptyText?: string;
  pagination?: PaginationConfig;
  className?: string;
}

export default function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyText = '暂无数据',
  pagination,
  className,
}: DataTableProps<T>) {
  return (
    <div className={`data-table ${className || ''}`}>
      <div className="data-table__header">
        {columns.map((col) => (
          <span key={col.key} className={`data-table__col ${col.className || ''}`}>
            {col.title}
          </span>
        ))}
      </div>
      <div className="data-table__body">
        {loading && data.length > 0 && (
          <div className="data-table__loading-overlay">
            <Loader2 className="data-table__loading-icon" />
          </div>
        )}
        {data.length === 0 ? (
          <div className="data-table__empty">{emptyText}</div>
        ) : (
          data.map((item, index) => (
            <div key={rowKey(item, index)} className="data-table__row">
              {columns.map((col) => (
                <span key={col.key} className={`data-table__col ${col.className || ''}`}>
                  {col.render(item, index)}
                </span>
              ))}
            </div>
          ))
        )}
      </div>
      {pagination && (
        <div className="data-table__pagination">
          <div className="data-table__pagination-left">
            <span className="data-table__pagination-size-label">每页</span>
            <Select
              value={String(pagination.pageSize)}
              options={(pagination.pageSizeOptions || [5, 10, 20]).map((n) => ({
                value: String(n),
                label: String(n),
              }))}
              onChange={(v) => {
                pagination.onPageSizeChange(Number(v));
                pagination.onPageChange(1);
              }}
              className="data-table__pagination-size-select"
            />
            <span className="data-table__pagination-size-label">条</span>
          </div>
          <div className="data-table__pagination-center">
            <button
              className="data-table__page-btn"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(Math.max(1, pagination.page - 1))}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="data-table__page-info">
              {pagination.page} / {pagination.totalPages || 1}
            </span>
            <button
              className="data-table__page-btn"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => pagination.onPageChange(Math.min(pagination.totalPages, pagination.page + 1))}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="data-table__pagination-right">
            <span className="data-table__pagination-total">共 {pagination.total} 条</span>
          </div>
        </div>
      )}
    </div>
  );
}