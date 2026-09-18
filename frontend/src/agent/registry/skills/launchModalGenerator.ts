/**
 * 发起流程脚手架代码生成器（纯函数）。
 *
 * 设计决策（2026-09-18 修订）：不再从表单 schema 静态生成弹窗 HTML——那是把表单设计器的
 * 工作在页面侧重做一遍（重复劳动），且 excel 上传解析、detail_table 等复杂控件无法静态复刻。
 * 平台在桥接层开放了真实 FormRenderer 弹窗（window.__LUBAN__.startWorkflowWithForm），
 * 表单 UI 由父窗口按流程表单定义渲染，字段/必填/控件随表单设计自动生效，页面零表单代码；
 * 服务端 startWorkflow 仍按表单 schema 校验 formData（必填/类型），契约双层兜底。
 */
import { formApi } from '@/api/workflow';
import type { FormDefinition } from '@/types/workflow';

export interface LaunchFormField {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
}

export interface LaunchSnippetOptions {
  workflowId: number;
  formId: number;
  formName: string;
  /** 业务记录落库的 INSERT 查询：提交后执行，insertId 写入 formData.id（触发器回写定位键） */
  insertQueryName?: string;
  insertQueryId?: number;
}

export interface LaunchSnippet {
  js: string;
  notes: string[];
}

/** 解析表单 fields JSON（兼容数组与 {fields:[...]} 两种存放形态），非法条目跳过 */
export function parseLaunchFormFields(fieldsJson: string): LaunchFormField[] {
  if (!fieldsJson || !fieldsJson.trim()) return [];
  try {
    const parsed = JSON.parse(fieldsJson);
    const raw = Array.isArray(parsed) ? parsed : parsed.fields || [];
    return (raw as Array<Record<string, unknown>>)
      .map((f) => ({
        key: String(f.key ?? f.name ?? '').trim(),
        label: String(f.label ?? f.name ?? '').trim(),
        type: String(f.type ?? 'text').trim(),
        required: Boolean(f.required),
      }))
      .filter((f) => f.key !== '');
  } catch {
    return [];
  }
}

/** 按绑定表单拉取 schema（校验表单存在 + 必填字段报告）；独立导出便于复用与 mock */
export async function fetchFormFields(formId: number): Promise<{ definition: FormDefinition; fields: LaunchFormField[] }> {
  const definition = await formApi.get(formId);
  return { definition, fields: parseLaunchFormFields(String(definition.fields || '[]')) };
}

function esc(s: string): string {
  return s.replace(/'/g, "\\'");
}

/** 生成 startWorkflowWithForm 调用代码（页面只需要一个入口函数 + 一个按钮） */
export function buildLaunchBridgeSnippet(opts: LaunchSnippetOptions): LaunchSnippet {
  const optionArgs = [
    `formId: ${opts.formId}`,
    opts.insertQueryName ? `insertQueryName: '${esc(opts.insertQueryName)}'` : '',
    opts.insertQueryId ? `insertQueryId: ${opts.insertQueryId}` : '',
  ].filter(Boolean).join(', ');

  const chainDesc = opts.insertQueryName
    ? `提交后先以 INSERT 查询 ${opts.insertQueryName} 落库，携带 insertId 发起流程`
    : '提交后直接发起流程（未提供 INSERT 查询，formData 不含业务记录 id）';

  const js = `// ===== 发起流程（平台表单弹窗）：表单 UI 由平台按绑定表单「${opts.formName}」真实渲染
//（含 excel 上传解析、detail_table 等全部控件），页面零表单代码；${chainDesc}。
// 服务端会按表单契约校验 formData（必填/类型），字段变更随表单设计自动生效 =====
var LAUNCH_WORKFLOW_ID = ${opts.workflowId};

function openLaunchModal() {
  window.__LUBAN__.startWorkflowWithForm(LAUNCH_WORKFLOW_ID, { ${optionArgs} })
    .then(function(res) {
      var instanceId = res && (res.id || res.instanceId);
      LubanUI.toast.success('已提交' + (instanceId ? '，流程实例 ' + instanceId : '') + '，审批中');
      if (typeof searchData === 'function') searchData();
    })
    .catch(function(err) {
      if (err && err.cancelled) return; // 用户关闭弹窗，不是错误
      LubanUI.toast.error('提交失败: ' + (err && err.message ? err.message : err));
    });
}`;

  const notes = [
    `发起链路已接入：openLaunchModal() 调用 window.__LUBAN__.startWorkflowWithForm(${opts.workflowId}, {...})，表单 UI 由平台渲染（零表单代码），${chainDesc}`,
  ];
  if (!opts.insertQueryName) {
    notes.push('⚠️ 未提供 insertQueryName——formData 不含业务记录 id；若流程触发器回写引用 form.data.id，请补传 INSERT 查询参数后重新生成');
  }
  notes.push('给页面入口按钮挂 onclick="openLaunchModal()" 即可；后续在表单设计器里增删字段，页面无需改代码');
  return { js, notes };
}
