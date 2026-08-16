import { useState, useEffect } from 'react';
import MemberPicker from './MemberPicker';
import Select from './Select';
import styles from './WorkflowDesigner.module.css';

const APPROVER_TYPES = [
  { type: 'member', label: '指定人员' },
  { type: 'role', label: '指定角色' },
  { type: 'department_head', label: '部门负责人' },
  { type: 'leader', label: '直属上级' },
  { type: 'form_field', label: '表单字段' },
  { type: 'script', label: '动态脚本' },
];

const COLLABORATION_MODES = [
  { mode: 'all_pass', label: '会签', desc: '所有人同意' },
  { mode: 'any_pass', label: '或签', desc: '任一人同意' },
  { mode: 'ratio_pass', label: '按比例', desc: '达到比例通过' },
  { mode: 'sequential', label: '依次审批', desc: '按顺序审批' },
];

interface ApproverSelectorProps {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export default function ApproverSelector({ config, onChange }: ApproverSelectorProps) {
  const [activeType, setActiveType] = useState<string>((config.approverType as string) || 'member');
  const [selectedMembers, setSelectedMembers] = useState<string[]>(
    (config.approverIds as string[]) || [],
  );
  const [ratio, setRatio] = useState<number>((config.approvalRatio as number) || 50);

  useEffect(() => {
    setActiveType((config.approverType as string) || 'member');
  }, [config.approverType]);

  const handleTypeChange = (type: string) => {
    setActiveType(type);
    onChange('approverType', type);
  };

  useEffect(() => {
    let type = config.approverType as string | undefined;
    if (!type) {
      if ((config.approverIds as string[])?.length) {
        type = 'member';
        onChange('approverType', 'member');
      } else {
        onChange('approverCount', 0);
        return;
      }
    }
    if (type === 'member') {
      const ids = (config.approverIds as string[]) || [];
      onChange('approverCount', ids.length);
    } else {
      onChange('approverCount', 1);
    }
  }, [config.approverType, config.approverIds, onChange]);

  return (
    <div>
      <div className={styles.configGroup}>
        <label className={styles.configLabel}>审批人类型</label>
        <div className={styles.approverTypeList}>
          {APPROVER_TYPES.map((item) => (
            <button
              key={item.type}
              className={
                activeType === item.type ? styles.approverTypeTagActive : styles.approverTypeTag
              }
              onClick={() => handleTypeChange(item.type)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {activeType === 'member' && (
        <div className={styles.configGroup}>
          <label className={styles.configLabel}>选择人员</label>
          <MemberPicker
            value={selectedMembers}
            onChange={(ids) => {
              setSelectedMembers(ids);
              onChange('approverIds', ids);
            }}
            placeholder="搜索人员名称..."
          />
        </div>
      )}

      {activeType === 'role' && (
        <div className={styles.configGroup}>
          <label className={styles.configLabel}>选择角色</label>
          <MemberPicker
            value={config.roleIds ? (config.roleIds as string[]) : []}
            onChange={(ids) => {
              onChange('roleIds', ids);
            }}
            placeholder="搜索角色..."
          />
        </div>
      )}

      {activeType === 'department_head' && (
        <div className={styles.configGroup}>
          <label className={styles.configLabel}>部门来源</label>
          <Select
            value={(config.departmentSource as string) || 'initiator'}
            options={[
              { value: 'initiator', label: '发起人所在部门' },
              { value: 'specified', label: '指定部门' },
              { value: 'form_field', label: '从表单字段获取' },
            ]}
            onChange={(v) => onChange('departmentSource', v)}
          />
        </div>
      )}

      {activeType === 'leader' && (
        <div className={styles.configGroup}>
          <label className={styles.configLabel}>上级来源</label>
          <Select
            value={(config.leaderOf as string) || 'initiator'}
            options={[
              { value: 'initiator', label: '发起人的直属上级' },
              { value: 'specified', label: '指定人员' },
              { value: 'form_field', label: '从表单字段获取' },
            ]}
            onChange={(v) => onChange('leaderOf', v)}
          />
        </div>
      )}

      {activeType === 'form_field' && (
        <div className={styles.configGroup}>
          <label className={styles.configLabel}>表单字段 Key</label>
          <input
            className={styles.configInput}
            placeholder="如: direct_manager"
            value={(config.formFieldKey as string) || ''}
            onChange={(e) => onChange('formFieldKey', e.target.value)}
          />
        </div>
      )}

      {activeType === 'script' && (
        <div className={styles.configGroup}>
          <label className={styles.configLabel}>脚本（Groovy）</label>
          <textarea
            className={styles.configInput}
            rows={4}
            placeholder="return approverIds;"
            value={(config.script as string) || ''}
            onChange={(e) => onChange('script', e.target.value)}
            style={{ fontFamily: 'monospace', resize: 'vertical' }}
          />
        </div>
      )}

      <div className={styles.configGroup}>
        <label className={styles.configLabel}>审批模式</label>
        <Select
          value={(config.collaborationMode as string) || 'all_pass'}
          options={COLLABORATION_MODES.map((item) => ({
            value: item.mode,
            label: item.label,
            desc: item.desc,
          }))}
          onChange={(v) => onChange('collaborationMode', v)}
        />
      </div>

      {(config.collaborationMode as string) === 'ratio_pass' && (
        <div className={styles.configGroup}>
          <label className={styles.configLabel}>通过比例 (%)</label>
          <input
            className={styles.configInput}
            type="number"
            min={1}
            max={100}
            value={ratio}
            onChange={(e) => {
              setRatio(parseInt(e.target.value));
              onChange('approvalRatio', parseInt(e.target.value));
            }}
          />
        </div>
      )}
    </div>
  );
}