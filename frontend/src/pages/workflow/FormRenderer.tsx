import { useState, useEffect, useRef, useCallback } from 'react';
import type { FormDefinition } from '../../types/workflow';
import { formApi } from '../../api/workflow';
import styles from './FormRenderer.module.css';

interface FormRendererProps {
  formId: number;
  mode?: 'view' | 'edit' | 'submit';
  initialData?: Record<string, unknown>;
  hideHeader?: boolean;
  onSubmit?: (data: Record<string, unknown>) => void;
  onCancel?: () => void;
}

export default function FormRenderer({
  formId,
  mode = 'edit',
  initialData = {},
  hideHeader = false,
  onSubmit,
  onCancel,
}: FormRendererProps) {
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>(initialData);
  const [loading, setLoading] = useState(true);
  const _iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    formApi.get(formId)
      .then(setForm)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [formId]);

  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = () => {
    onSubmit?.(formData);
  };

  if (loading) {
    return <div className={styles.loading}>加载表单中...</div>;
  }

  if (!form) {
    return <div className={styles.error}>表单不存在</div>;
  }

  const schema = parseFieldsSchema(form.fields);

  const renderExcelRows = (field: FieldSchema, data: Record<string, unknown>) => {
    const rows = data[field.key] as Array<Record<string, unknown>> | undefined;
    if (!rows || rows.length === 0) {
      return (
        <tr>
          {field.columns.map((col) => (
            <td key={col.key} className={styles.excelPlaceholder}>&mdash;</td>
          ))}
        </tr>
      );
    }
    return rows.map((row, ri) => (
      <tr key={ri}>
        {field.columns.map((col) => (
          <td key={col.key}>{String(row[col.key] ?? '')}</td>
        ))}
      </tr>
    ));
  };

  return (
    <div className={styles.renderer}>
      {!hideHeader && (
        <div className={styles.formHeader}>
          <h2 className={styles.formTitle}>{form.name}</h2>
          {form.description && (
            <p className={styles.formDesc}>{form.description}</p>
          )}
        </div>
      )}

      <div className={styles.formBody}>
        {groupFieldsIntoRows(schema).map((row, ri) => (
          <div key={ri} className={styles.formRow}>
            {row.map((field) => (
              <div
                key={field.key}
                className={styles.fieldGroup}
                style={{ flex: field.colSpan || 4 }}
              >
            <label className={styles.fieldLabel}>
              {field.required && <span className={styles.required}>*</span>}
              {field.label}
            </label>

            {field.type === 'text' && (
              <input
                type="text"
                className={styles.fieldInput}
                value={(formData[field.key] as string) || ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                disabled={mode === 'view'}
                placeholder={field.placeholder}
              />
            )}

            {field.type === 'number' && (
              <input
                type="number"
                className={styles.fieldInput}
                value={(formData[field.key] as number) || ''}
                onChange={(e) => handleFieldChange(field.key, parseFloat(e.target.value))}
                disabled={mode === 'view'}
                placeholder={field.placeholder}
              />
            )}

            {field.type === 'textarea' && (
              <textarea
                className={styles.fieldTextarea}
                value={(formData[field.key] as string) || ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                disabled={mode === 'view'}
                placeholder={field.placeholder}
                rows={4}
              />
            )}

            {field.type === 'select' && (
              <select
                className={styles.fieldSelect}
                value={(formData[field.key] as string) || ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                disabled={mode === 'view'}
              >
                <option value="">请选择</option>
                {field.options?.map((opt: { value: string; label: string }) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}

            {field.type === 'date' && (
              <input
                type="date"
                className={styles.fieldInput}
                value={(formData[field.key] as string) || ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                disabled={mode === 'view'}
              />
            )}

            {field.type === 'file' && (
              <div className={styles.fileUpload}>
                <input
                  type="file"
                  disabled={mode === 'view'}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleFieldChange(field.key, { name: file.name, size: file.size });
                    }
                  }}
                />
                {formData[field.key] && (
                  <div className={styles.fileInfo}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style="vertical-align: middle; margin-right: 4px;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>{(formData[field.key] as { name: string }).name}
                  </div>
                )}
              </div>
            )}

            {field.type === 'computed' && (
              <div className={styles.computedField}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, flexShrink: 0, color: '#8b8b8b' }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                <span className={styles.computedLabel}>计算字段</span>
                <span className={styles.computedFormula}>
                  {mode === 'view' && formData[field.key] != null
                    ? String(formData[field.key])
                    : field.computedFrom || '(无公式)'}
                </span>
              </div>
            )}

            {field.type === 'excel' && (
              <div className={styles.excelField}>
                <div className={styles.excelUpload}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <span>上传 Excel 文件自动解析</span>
                </div>
                {field.columns && field.columns.length > 0 && (
                  <div className={styles.excelTableWrap}>
                    <table className={styles.excelTable}>
                      <thead>
                        <tr>
                          {field.columns.map((col) => (
                            <th key={col.key}>{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {renderExcelRows(field, formData)}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {field.type === 'detail_table' && (
              <div className={styles.detailTable}>
                {field.columns && field.columns.length > 0 && (
                  <div className={styles.excelTableWrap}>
                    <table className={styles.excelTable}>
                      <thead>
                        <tr>
                          {field.columns.map((col) => (
                            <th key={col.key}>{col.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {renderExcelRows(field, formData)}
                      </tbody>
                    </table>
                  </div>
                )}
                {mode !== 'view' && (
                  <button className={styles.addRowBtn} type="button">
                    + 添加行
                  </button>
                )}
              </div>
            )}

            {field.type === 'switch' && (
              <label className={styles.switchWrap}>
                <input
                  type="checkbox"
                  className={styles.switchInput}
                  checked={!!formData[field.key]}
                  onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                  disabled={mode === 'view'}
                />
                <span className={styles.switchSlider} />
              </label>
            )}

            {field.type === 'radio' && (
              <div className={styles.radioGroup}>
                {field.options?.map((opt) => (
                  <label key={opt.value} className={styles.radioItem}>
                    <input
                      type="radio"
                      name={field.key}
                      value={opt.value}
                      checked={formData[field.key] === opt.value}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      disabled={mode === 'view'}
                    />
                    <span>{opt.label}</span>
                  </label>
                )) || <span className={styles.configHint}>无选项</span>}
              </div>
            )}

            {field.type === 'checkbox' && (
              <label className={styles.checkboxItem}>
                <input
                  type="checkbox"
                  checked={!!formData[field.key]}
                  onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                  disabled={mode === 'view'}
                />
                <span>{field.label}</span>
              </label>
            )}

            {field.type === 'multi_select' && (
              <div className={styles.checkboxGroup}>
                {field.options?.map((opt) => (
                  <label key={opt.value} className={styles.checkboxItem}>
                    <input
                      type="checkbox"
                      checked={((formData[field.key] as string[]) || []).includes(opt.value)}
                      onChange={(e) => {
                        const prev = (formData[field.key] as string[]) || [];
                        const next = e.target.checked
                          ? [...prev, opt.value]
                          : prev.filter((v) => v !== opt.value);
                        handleFieldChange(field.key, next);
                      }}
                      disabled={mode === 'view'}
                    />
                    <span>{opt.label}</span>
                  </label>
                )) || <span className={styles.configHint}>无选项</span>}
              </div>
            )}

            {field.type === 'datetime' && (
              <input
                type="datetime-local"
                className={styles.fieldInput}
                value={(formData[field.key] as string) || ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                disabled={mode === 'view'}
              />
            )}

            {field.type === 'member' && (
              <div className={styles.placeholderField}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                选择成员
              </div>
            )}

            {field.type === 'department' && (
              <div className={styles.placeholderField}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                选择部门
              </div>
            )}
          </div>
            ))}
          </div>
        ))}
      </div>

      {mode !== 'view' && (
        <div className={styles.formActions}>
          {onCancel && (
            <button className={styles.cancelBtn} onClick={onCancel}>
              取消
            </button>
          )}
          <button className={styles.submitBtn} onClick={handleSubmit}>
            {mode === 'submit' ? '提交' : '保存'}
          </button>
        </div>
      )}
    </div>
  );
}

interface FieldSchema {
  key: string;
  type: string;
  label: string;
  required: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  columns?: { key: string; label: string; type: string }[];
  computedFrom?: string;
  colSpan?: number;
}

function parseFieldsSchema(schemaStr: string): FieldSchema[] {
  if (!schemaStr) return [];
  try {
    const parsed = JSON.parse(schemaStr);
    const raw = Array.isArray(parsed) ? parsed : parsed.fields || [];
    return raw.map((field: Record<string, unknown>) => ({
      ...field,
      label: (field.label as string) || (field.name as string) || '',
      options: (field.options as Array<Record<string, unknown>>)?.map((opt) => ({
        ...opt,
        label: (opt.label as string) || (opt.name as string) || '',
      })),
      columns: (field.columns as Array<Record<string, unknown>>)?.map((col) => ({
        ...col,
        label: (col.label as string) || (col.name as string) || '',
      })),
    })) as FieldSchema[];
  } catch {
    return [];
  }
}

function groupFieldsIntoRows(fields: FieldSchema[]): FieldSchema[][] {
  const rows: FieldSchema[][] = [];
  const rowSpans: number[] = [];

  for (const field of fields) {
    const span = field.colSpan || 4;
    let placed = false;

    for (let i = 0; i < rows.length; i++) {
      if (rowSpans[i] + span <= 4) {
        rows[i].push(field);
        rowSpans[i] += span;
        placed = true;
        break;
      }
    }

    if (!placed) {
      rows.push([field]);
      rowSpans.push(span);
    }
  }

  return rows;
}