/**
 * 平台表单弹窗宿主：把真实的 FormRenderer（表单设计器的运行时渲染器，含 excel 上传
 * 解析、detail_table 等全部控件）以弹窗形式提供给代码页面（iframe）使用。
 *
 * 背景：代码页面是裸 HTML iframe，无法直接渲染 React 组件；此前页面发起流程要么手写
 * 弹窗（与表单设计器重复劳动、复杂控件无法复刻、字段 key 漂移），要么没有发起入口。
 * 桥接层（useQueryBridge）是纯 JS，走不了 React 渲染树，因此宿主以单例挂到 document.body，
 * 由桥接层命令式调起（openWorkflowFormModal），提交/取消通过 onDone 回传给桥接层，
 * 再经 postMessage 结算页面侧的 Promise。
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import FormRenderer from '../pages/workflow/FormRenderer';
import styles from './WorkflowFormModal.module.css';

export interface WorkflowFormModalRequest {
  formId: number;
  formName?: string;
  /** 提交/关闭后回传；桥接层持有 Promise resolve，页面侧 Promise 随之结算 */
  onDone: (result: { cancelled: true } | { cancelled: false; formData: Record<string, unknown> }) => void;
}

let hostRoot: Root | null = null;
let setStateRef: ((req: WorkflowFormModalRequest | null) => void) | null = null;
let pendingReq: WorkflowFormModalRequest | null = null;

function ensureHost() {
  if (hostRoot) return;
  let el = document.getElementById('luban-form-modal-host');
  if (!el) {
    el = document.createElement('div');
    el.id = 'luban-form-modal-host';
    document.body.appendChild(el);
  }
  hostRoot = createRoot(el);
  hostRoot.render(<Host />);
}

/** 桥接层入口：打开平台表单弹窗 */
export function openWorkflowFormModal(req: WorkflowFormModalRequest) {
  pendingReq = req;
  ensureHost();
  // 宿主已挂载时直接更新状态；首次挂载时 Host 的 useState 初值会读到 pendingReq
  setStateRef?.(req);
}

function Host() {
  const [req, setReq] = useState<WorkflowFormModalRequest | null>(pendingReq);
  const prevRef = useRef<WorkflowFormModalRequest | null>(null);

  useEffect(() => {
    setStateRef = setReq;
    return () => { setStateRef = null; };
  }, []);

  // 弹窗被新请求顶掉时，旧请求按"取消"结算，避免页面 Promise 永久悬挂
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = req;
    if (prev && prev !== req) prev.onDone({ cancelled: true });
  }, [req]);

  if (!req) return null;

  const close = (result: { cancelled: true } | { cancelled: false; formData: Record<string, unknown> }) => {
    setReq(null);
    req.onDone(result);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>{req.formName || '流程表单'}</span>
          <button className={styles.closeBtn} title="关闭" onClick={() => close({ cancelled: true })}>
            ×
          </button>
        </div>
        <div className={styles.body}>
          <FormRenderer
            formId={req.formId}
            mode="submit"
            hideHeader
            onSubmit={(data) => close({ cancelled: false, formData: data })}
            onCancel={() => close({ cancelled: true })}
          />
        </div>
      </div>
    </div>
  );
}
