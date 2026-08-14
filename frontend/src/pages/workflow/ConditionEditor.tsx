import { useState } from 'react';
import styles from './ConditionEditor.module.css';

interface ConditionEditorProps {
  value?: string;
  onChange?: (expression: string) => void;
  placeholder?: string;
}

const COMMON_VARIABLES = [
  { key: 'amount', label: '金额' },
  { key: 'days', label: '请假天数' },
  { key: 'type', label: '类型' },
  { key: 'urgency', label: '紧急程度' },
  { key: 'department', label: '部门' },
  { key: 'level', label: '级别' },
];

const OPERATORS = [
  { value: '==', label: '等于' },
  { value: '!=', label: '不等于' },
  { value: '>', label: '大于' },
  { value: '<', label: '小于' },
  { value: '>=', label: '大于等于' },
  { value: '<=', label: '小于等于' },
  { value: 'includes', label: '包含' },
  { value: 'notIncludes', label: '不包含' },
  { value: 'isEmpty', label: '为空' },
];

export default function ConditionEditor({ value = '', onChange, placeholder = '请输入条件表达式' }: ConditionEditorProps) {
  const [mode, setMode] = useState<'visual' | 'code'>('visual');
  const [selectedVar, setSelectedVar] = useState('');
  const [selectedOp, setSelectedOp] = useState('==');
  const [compareValue, setCompareValue] = useState('');

  const handleAddCondition = () => {
    if (!selectedVar) return;
    let expr: string;
    if (selectedOp === 'isEmpty') {
      expr = `!data.${selectedVar}`;
    } else {
      const val = Number(compareValue);
      expr = `data.${selectedVar} ${selectedOp} ${isNaN(val) ? `'${compareValue}'` : compareValue}`;
    }
    const newExpr = value ? `${value} && ${expr}` : expr;
    onChange?.(newExpr);
    setSelectedVar('');
    setCompareValue('');
  };

  const handleAddOr = () => {
    if (!selectedVar) return;
    let expr: string;
    if (selectedOp === 'isEmpty') {
      expr = `!data.${selectedVar}`;
    } else {
      const val = Number(compareValue);
      expr = `data.${selectedVar} ${selectedOp} ${isNaN(val) ? `'${compareValue}'` : compareValue}`;
    }
    const newExpr = value ? `${value} || ${expr}` : expr;
    onChange?.(newExpr);
    setSelectedVar('');
    setCompareValue('');
  };

  return (
    <div className={styles.editor}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${mode === 'visual' ? styles.tabActive : ''}`}
          onClick={() => setMode('visual')}
        >
          可视化
        </button>
        <button
          className={`${styles.tab} ${mode === 'code' ? styles.tabActive : ''}`}
          onClick={() => setMode('code')}
        >
          表达式
        </button>
      </div>

      {mode === 'visual' ? (
        <div className={styles.visual}>
          <div className={styles.conditionRow}>
            <select
              className={styles.select}
              value={selectedVar}
              onChange={(e) => setSelectedVar(e.target.value)}
            >
              <option value="">选择字段</option>
              {COMMON_VARIABLES.map((v) => (
                <option key={v.key} value={v.key}>{v.label}</option>
              ))}
            </select>

            <select
              className={styles.select}
              value={selectedOp}
              onChange={(e) => setSelectedOp(e.target.value)}
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>

            {selectedOp !== 'isEmpty' && (
              <input
                className={styles.input}
                type="text"
                placeholder="比较值"
                value={compareValue}
                onChange={(e) => setCompareValue(e.target.value)}
              />
            )}
          </div>

          <div className={styles.actions}>
            <button className={styles.andBtn} onClick={handleAddCondition} disabled={!selectedVar}>
              + 且 (AND)
            </button>
            <button className={styles.orBtn} onClick={handleAddOr} disabled={!selectedVar}>
              + 或 (OR)
            </button>
          </div>

          {value && (
            <div className={styles.preview}>
              <div className={styles.previewLabel}>当前表达式:</div>
              <code className={styles.previewCode}>{value}</code>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.codeMode}>
          <textarea
            className={styles.codeArea}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder={placeholder}
            rows={6}
          />
          <div className={styles.codeHint}>
            支持 JavaScript 表达式，使用 <code>data</code> 访问表单数据
          </div>
        </div>
      )}
    </div>
  );
}