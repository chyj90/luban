import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Select from '@/components/Select';
import { listOrchestrations } from '@/api/orchestration';
import { listQueries } from '@/api/query';
import { listAllApplicationTools } from '@/api/tool';
import styles from './WorkflowDesigner.module.css';

/**
 * 审批节点触发器配置：写入节点 config.triggers，
 * 与后端 WorkflowTriggerService / TriggerDispatcher 的契约对应：
 * { triggerId, on, target:{type, ref}, paramsMapping:[{to, from}], mode:'ASYNC', retry:{maxAttempts, backoffSeconds} }
 * 派发为异步（outbox），打断"流程→编排→流程"环；触发目标在流程保存/发布时即固化为授权清单。
 */

export const TRIGGER_EVENTS = [
  { value: 'APPROVED', label: '审批通过时' },
  { value: 'NODE_ENTERED', label: '节点进入时' },
  { value: 'REJECTED', label: '节点被驳回时' },
  { value: 'INSTANCE_COMPLETED', label: '整个流程完结时' },
  { value: 'INSTANCE_REJECTED', label: '整个流程被驳回时' },
];

const TARGET_TYPES = [
  { value: 'ORCHESTRATION', label: '编排' },
  { value: 'QUERY', label: '查询' },
  { value: 'TOOL', label: 'API 工具' },
];

const DEFAULT_BACKOFF_SECONDS = [30, 120, 600];

interface Trigger {
  triggerId: string;
  on: string;
  target: { type: string; ref: number };
  paramsMapping?: Array<{ to: string; from: string }>;
  mode?: string;
  retry?: { maxAttempts?: number; backoffSeconds?: number[] };
}

interface TargetOption {
  id: number;
  name: string;
  type: string;
}

interface NodeTriggerEditorProps {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  appId?: number;
}

export default function NodeTriggerEditor({ config, onChange, appId }: NodeTriggerEditorProps) {
  const triggers = useMemo<Trigger[]>(
    () => (Array.isArray(config.triggers) ? (config.triggers as Trigger[]) : []),
    [config.triggers],
  );
  const [orchestrations, setOrchestrations] = useState<TargetOption[]>([]);
  const [queries, setQueries] = useState<TargetOption[]>([]);
  const [tools, setTools] = useState<TargetOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!appId) return;
      const [orchResult, queryResult, toolResult] = await Promise.allSettled([
        listOrchestrations(appId),
        listQueries(appId),
        listAllApplicationTools({ page: 1, size: 200 }),
      ]);
      if (cancelled) return;
      if (orchResult.status === 'fulfilled') {
        setOrchestrations(
          (orchResult.value.data || [])
            // 触发器按发布版本执行：草稿/已归档编排不可选
            .filter((o) => o.status === 'PUBLISHED')
            .map((o) => ({ id: o.id, name: o.name, type: 'ORCHESTRATION' })),
        );
      }
      if (queryResult.status === 'fulfilled') {
        setQueries(
          (queryResult.value.data || []).map((q) => ({ id: q.id, name: q.name, type: 'QUERY' })),
        );
      }
      if (toolResult.status === 'fulfilled') {
        setTools(
          ((toolResult.value.data?.tools || []) as Array<Record<string, unknown>>)
            .filter((t) => t.toolType !== 'ORCHESTRATION')
            .map((t) => ({ id: t.id as number, name: (t.displayName as string) || (t.name as string), type: 'TOOL' })),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  const updateTriggers = (next: Trigger[]) => onChange('triggers', next);

  const addTrigger = () => {
    updateTriggers([
      ...triggers,
      {
        triggerId: `tg_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
        on: 'APPROVED',
        target: { type: 'ORCHESTRATION', ref: 0 },
        paramsMapping: [],
        mode: 'ASYNC',
        retry: { maxAttempts: 3, backoffSeconds: DEFAULT_BACKOFF_SECONDS },
      },
    ]);
  };

  const patchTrigger = (index: number, patch: Partial<Trigger>) => {
    updateTriggers(triggers.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  const patchTarget = (index: number, type: string, ref: number) => {
    patchTrigger(index, { target: { type, ref } });
  };

  const removeTrigger = (index: number) => {
    updateTriggers(triggers.filter((_, i) => i !== index));
  };

  const patchMapping = (triggerIndex: number, rowIndex: number, field: 'to' | 'from', value: string) => {
    const t = triggers[triggerIndex];
    const next = (t.paramsMapping || []).map((m, i) => (i === rowIndex ? { ...m, [field]: value } : m));
    patchTrigger(triggerIndex, { paramsMapping: next });
  };

  const addMapping = (triggerIndex: number) => {
    const t = triggers[triggerIndex];
    patchTrigger(triggerIndex, { paramsMapping: [...(t.paramsMapping || []), { to: '', from: 'form.data' }] });
  };

  const removeMapping = (triggerIndex: number, rowIndex: number) => {
    const t = triggers[triggerIndex];
    patchTrigger(triggerIndex, { paramsMapping: (t.paramsMapping || []).filter((_, i) => i !== rowIndex) });
  };

  const optionsFor = (type: string): TargetOption[] =>
    type === 'ORCHESTRATION' ? orchestrations : type === 'QUERY' ? queries : tools;

  return (
    <div className={styles.configGroup}>
      <label className={styles.configLabel}>触发器（异步派发，不阻塞审批）</label>
      {triggers.length === 0 && (
        <div style={{ fontSize: 12, color: '#8c95a3', marginBottom: 6 }}>
          未配置。审批节点可在事件发生时自动调用编排 / 查询 / API 工具。
        </div>
      )}
      {triggers.map((trigger, index) => {
        const type = trigger.target?.type || 'ORCHESTRATION';
        const ref = trigger.target?.ref;
        const options = optionsFor(type);
        const targetOptions = [
          ...options.map((o) => ({ value: String(o.id), label: `${o.name}（ID:${o.id}）` })),
          ...(ref && !options.some((o) => o.id === ref)
            ? [{ value: String(ref), label: `ID:${ref}（未加载，请检查目标是否存在）` }]
            : []),
        ];
        return (
          <div key={trigger.triggerId || index} style={blockStyle}>
            <div style={rowStyle}>
              <div style={{ flex: 1 }}>
                <div style={fieldLabelStyle}>触发事件</div>
                <Select
                  value={trigger.on || 'APPROVED'}
                  options={TRIGGER_EVENTS}
                  onChange={(v) => patchTrigger(index, { on: v })}
                />
              </div>
              <div style={{ width: 96 }}>
                <div style={fieldLabelStyle}>目标类型</div>
                <Select
                  value={type}
                  options={TARGET_TYPES}
                  onChange={(v) => patchTarget(index, v, 0)}
                />
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={fieldLabelStyle}>调用目标</div>
              <Select
                value={ref ? String(ref) : ''}
                options={targetOptions}
                placeholder={options.length ? '请选择目标' : `暂无可选${labelOf(type)}，可先去创建`}
                onChange={(v) => patchTarget(index, type, Number(v))}
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={fieldLabelStyle}>
                参数映射（把流程数据映射为调用入参；来源：instance.id / instance.initiatorId / form.data /
                form.data.字段名 / task.comment / node.id）
              </div>
              {(trigger.paramsMapping || []).map((m, rowIndex) => (
                <div key={rowIndex} style={mappingRowStyle}>
                  <input
                    style={inputStyle}
                    value={m.to}
                    onChange={(e) => patchMapping(index, rowIndex, 'to', e.target.value)}
                    placeholder="入参名"
                  />
                  <span style={{ color: '#8c95a3' }}>=</span>
                  <input
                    style={inputStyle}
                    value={m.from}
                    onChange={(e) => patchMapping(index, rowIndex, 'from', e.target.value)}
                    placeholder="来源路径"
                  />
                  <button type="button" style={miniBtnStyle} onClick={() => removeMapping(index, rowIndex)}>
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" style={addMiniBtnStyle} onClick={() => addMapping(index)}>
                + 添加参数映射
              </button>
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#8c95a3' }}>失败重试次数</span>
              <input
                style={{ ...inputStyle, width: 64 }}
                type="number"
                min={0}
                max={10}
                value={trigger.retry?.maxAttempts ?? 3}
                onChange={(e) =>
                  patchTrigger(index, {
                    retry: {
                      maxAttempts: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                      backoffSeconds: trigger.retry?.backoffSeconds || DEFAULT_BACKOFF_SECONDS,
                    },
                  })
                }
              />
              <span style={{ fontSize: 12, color: '#8c95a3' }}>（超限进入死信并告警）</span>
            </div>
            <button type="button" style={deleteBtnStyle} onClick={() => removeTrigger(index)}>
              删除此触发器
            </button>
          </div>
        );
      })}
      <button type="button" style={addBtnStyle} onClick={addTrigger}>
        + 添加触发器
      </button>
    </div>
  );
}

function labelOf(type: string): string {
  return TARGET_TYPES.find((t) => t.value === type)?.label || '目标';
}

const blockStyle: CSSProperties = {
  border: '1px solid #e8edf3',
  borderRadius: 6,
  padding: 10,
  marginBottom: 8,
  background: '#fafbfd',
};

const rowStyle: CSSProperties = { display: 'flex', gap: 8 };

const fieldLabelStyle: CSSProperties = { fontSize: 12, color: '#5b6472', marginBottom: 4 };

const mappingRowStyle: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 };

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: '1px solid #e8edf3',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 12,
};

const miniBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#8c95a3',
  cursor: 'pointer',
  fontSize: 12,
};

const addMiniBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#1677ff',
  cursor: 'pointer',
  fontSize: 12,
  padding: '2px 0',
};

const addBtnStyle: CSSProperties = {
  width: '100%',
  border: '1px dashed #c9d4e0',
  borderRadius: 6,
  background: 'transparent',
  color: '#1677ff',
  cursor: 'pointer',
  padding: '6px 0',
  fontSize: 13,
};

const deleteBtnStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#e64340',
  cursor: 'pointer',
  fontSize: 12,
  padding: '4px 0 0',
};
