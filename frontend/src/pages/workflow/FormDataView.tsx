import { useMemo } from 'react';
import styles from './FormDataView.module.css';

interface FormDataViewProps {
  formData: string;
  fields?: string;
}

interface FieldSchema {
  key: string;
  label: string;
  type: string;
  options?: { value: string; label: string }[];
}

function parseFieldsSchema(schemaStr: string): FieldSchema[] {
  if (!schemaStr) return [];
  try {
    const parsed = JSON.parse(schemaStr);
    return Array.isArray(parsed) ? parsed : parsed.fields || [];
  } catch {
    return [];
  }
}

function parseFormData(dataStr: string): Record<string, unknown> {
  if (!dataStr) return {};
  try {
    return JSON.parse(dataStr);
  } catch {
    return {};
  }
}

function formatValue(value: unknown, fieldType?: string, options?: { value: string; label: string }[]): string {
  if (value === null || value === undefined || value === '') return '-';

  if (fieldType === 'select' || fieldType === 'radio') {
    const opt = options?.find((o) => o.value === String(value));
    return opt ? opt.label : String(value);
  }

  if (fieldType === 'multi_select' || fieldType === 'checkbox') {
    if (Array.isArray(value)) {
      return value
        .map((v) => {
          const opt = options?.find((o) => o.value === v);
          return opt ? opt.label : v;
        })
        .join(', ');
    }
    return String(value);
  }

  if (fieldType === 'switch') {
    return value ? '是' : '否';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

export default function FormDataView({ formData, fields }: FormDataViewProps) {
  const fieldSchemas = useMemo(() => parseFieldsSchema(fields || ''), [fields]);
  const data = useMemo(() => parseFormData(formData), [formData]);

  const _fieldMap = useMemo(() => {
    const map = new Map<string, FieldSchema>();
    fieldSchemas.forEach((f) => map.set(f.key, f));
    return map;
  }, [fieldSchemas]);

  const entries = useMemo(() => {
    if (fieldSchemas.length > 0) {
      return fieldSchemas
        .filter((f) => data[f.key] !== undefined)
        .map((f) => ({
          key: f.key,
          label: f.label,
          value: formatValue(data[f.key], f.type, f.options),
        }));
    }
    return Object.entries(data).map(([key, value]) => ({
      key,
      label: key,
      value: formatValue(value),
    }));
  }, [data, fieldSchemas]);

  if (entries.length === 0) {
    return <div className={styles.empty}>暂无表单数据</div>;
  }

  return (
    <table className={styles.table}>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.key} className={styles.row}>
            <td className={styles.label}>{entry.label}</td>
            <td className={styles.value}>{entry.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}