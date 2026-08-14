import { useState, useEffect } from 'react';
import MemberPicker from './MemberPicker';
import styles from './FieldPermissionGrid.module.css';

interface FieldPermission {
  fieldKey: string;
  fieldLabel: string;
  visible: boolean;
  editable: boolean;
  required: boolean;
  visibleTo: string[];
  editableBy: string[];
}

interface FieldPermissionGridProps {
  fields: Array<{ key: string; label: string }>;
  permissions?: FieldPermission[];
  onChange?: (permissions: FieldPermission[]) => void;
}

export default function FieldPermissionGrid({
  fields,
  permissions: initialPermissions,
  onChange,
}: FieldPermissionGridProps) {
  const [permissions, setPermissions] = useState<FieldPermission[]>(() => {
    if (initialPermissions && initialPermissions.length > 0) return initialPermissions;
    return fields.map((f) => ({
      fieldKey: f.key,
      fieldLabel: f.label,
      visible: true,
      editable: true,
      required: false,
      visibleTo: [],
      editableBy: [],
    }));
  });
  const [expandedField, setExpandedField] = useState<string | null>(null);

  useEffect(() => {
    onChange?.(permissions);
  }, [permissions, onChange]);

  const updateField = (key: string, update: Partial<FieldPermission>) => {
    setPermissions((prev) =>
      prev.map((p) => (p.fieldKey === key ? { ...p, ...update } : p)),
    );
  };

  return (
    <div className={styles.grid}>
      <div className={styles.header}>
        <div className={styles.colField}>字段</div>
        <div className={styles.colCheck}>可见</div>
        <div className={styles.colCheck}>可编辑</div>
        <div className={styles.colCheck}>必填</div>
        <div className={styles.colAction}>高级</div>
      </div>

      {permissions.map((perm) => (
        <div key={perm.fieldKey} className={styles.row}>
          <div className={styles.colField}>
            <span className={styles.fieldLabel}>{perm.fieldLabel}</span>
            <span className={styles.fieldKey}>{perm.fieldKey}</span>
          </div>
          <div className={styles.colCheck}>
            <input
              type="checkbox"
              checked={perm.visible}
              onChange={(e) => updateField(perm.fieldKey, { visible: e.target.checked })}
            />
          </div>
          <div className={styles.colCheck}>
            <input
              type="checkbox"
              checked={perm.editable}
              disabled={!perm.visible}
              onChange={(e) => updateField(perm.fieldKey, { editable: e.target.checked })}
            />
          </div>
          <div className={styles.colCheck}>
            <input
              type="checkbox"
              checked={perm.required}
              disabled={!perm.visible}
              onChange={(e) => updateField(perm.fieldKey, { required: e.target.checked })}
            />
          </div>
          <div className={styles.colAction}>
            <button
              className={styles.advancedBtn}
              onClick={() =>
                setExpandedField(expandedField === perm.fieldKey ? null : perm.fieldKey)
              }
            >
              {expandedField === perm.fieldKey ? '收起' : '高级'}
            </button>
          </div>

          {expandedField === perm.fieldKey && (
            <div className={styles.expanded}>
              <div className={styles.expandedSection}>
                <div className={styles.expandedLabel}>可见范围（指定人员/角色）</div>
                <MemberPicker
                  value={perm.visibleTo}
                  onChange={(ids) => updateField(perm.fieldKey, { visibleTo: ids })}
                  placeholder="选择可见人员"
                />
              </div>
              <div className={styles.expandedSection}>
                <div className={styles.expandedLabel}>可编辑人员（指定人员/角色）</div>
                <MemberPicker
                  value={perm.editableBy}
                  onChange={(ids) => updateField(perm.fieldKey, { editableBy: ids })}
                  placeholder="选择可编辑人员"
                />
              </div>
            </div>
          )}
        </div>
      ))}

      {permissions.length === 0 && (
        <div className={styles.empty}>暂无字段</div>
      )}
    </div>
  );
}