# luban-workflow — AI 驱动的工作流引擎 需求文档

> **模块名称**：luban-workflow
> **定位**：鲁班平台的企业级工作流子系统，通过 AI Agent 对话式设计表单、生成审批流程，将表单与工作流灵活关联，实现从"填单"到"审批"到"归档"的完整业务闭环
> **核心原则**：沿袭鲁班"AI 驱动、所见即所得"的设计理念，工作流配置通过自然语言驱动，降低企业级流程搭建门槛
> **人员组织**：组织架构与人员维护不在本应用内，通过外部接口（LDAP/API/钉钉/企业微信）同步，本模块只做引用

---

## 一、产品全景

### 1.1 用户角色

| 角色 | 职责 | 备注 |
|------|------|------|
| **普通用户** | 发起申请、查看自己的流程进度、处理待办 | 组织中所有成员 |
| **流程设计者** | 通过 AI 对话或可视化编辑器设计表单和审批流程，将表单与流程关联 | 通常为业务专家、管理员或 IT 人员 |
| **管理员** | 维护组织架构、管理流程模板、强制干预运行中的流程 | 系统管理员 |

### 1.2 核心链路

```
组织架构同步（外部） → 表单设计（AI生成/手动） → 流程设计（AI生成/手动）
                                                      ↓
                                              表单与流程关联
                                                      ↓
                                         用户发起申请（填表单）
                                                      ↓
                                         流程流转（审批/驳回/加签...）
                                                      ↓
                                               流程结束归档
```

### 1.3 与现有鲁班平台的关系

#### 1.3.1 后端：独立模块，可插拔

- luban-workflow 后端作为**独立的 Maven 子模块**（`backend/luban-workflow/`），与主模块（`backend/luban-core/`）平级
- 通过 Spring Boot **自动配置（Auto-Configuration）** 实现可插拔：当 `luban-workflow` 依赖存在时自动加载工作流功能，不存在时主应用正常运行不受影响
- 主模块通过 `pom.xml` 中**可选依赖（optional）** 引入，部署时按需打入 classpath
- 共用同一进程、同一端口启动，不拆分微服务
- 复用主模块的认证体系（JWT + Spring Security）、数据库连接（共享 DataSource）、工作区（Workspace）隔离

```
backend/
├── luban-core/              # 主模块（现有代码迁移至此）
│   ├── pom.xml
│   └── src/main/java/com/luban/
│       ├── config/          # 安全、CORS 等公共配置
│       ├── controller/      # 现有 API 控制器
│       ├── entity/          # 现有实体
│       ├── service/         # 现有服务
│       └── LubanApplication.java
│
├── luban-workflow/          # 工作流模块（新增，可插拔）
│   ├── pom.xml              # 依赖 luban-core
│   └── src/main/java/com/luban/workflow/
│       ├── config/          # 工作流自动配置
│       ├── controller/      # 工作流 API 控制器
│       ├── entity/          # 工作流实体
│       ├── service/         # 工作流服务（含流程引擎）
│       └── WorkflowAutoConfiguration.java  # 自动配置入口
│
└── pom.xml                  # 父 POM，聚合 luban-core + luban-workflow
```

#### 1.3.2 前端：统一整合，不拆分

- 前端**不拆分**独立包，所有工作流页面和组件直接放在现有 `frontend/src/` 下
- 原因：前端拆分独立包加重维护负担（版本同步、公共组件共享、路由整合），价值不高
- 工作流相关代码按现有目录结构归位：

```
frontend/src/
├── pages/
│   ├── Workflow/            # 工作流管理、流程设计器、待办等页面
│   └── ...                  # 现有页面
├── components/
│   ├── FormDesigner/        # 表单设计器组件
│   ├── WorkflowDesigner/    # 流程设计器组件
│   └── ...                  # 现有组件
├── api/
│   ├── workflow.ts          # 工作流 API 封装
│   └── ...                  # 现有 API
├── stores/
│   ├── workflowStore.ts     # 工作流状态管理
│   └── ...                  # 现有 stores
├── types/
│   ├── workflow.ts          # 工作流类型定义
│   └── ...                  # 现有 types
└── agent/
    ├── tools/
    │   ├── workflowTools.ts # 工作流 Agent 工具
    │   └── ...              # 现有工具
    └── skills/
        ├── workflowSkill.ts # 工作流 Agent 技能
        └── ...              # 现有技能
```

#### 1.3.3 复用关系总结

| 能力 | 后端 | 前端 |
|------|------|------|
| 认证 | 复用 JWT + Spring Security | 复用 authStore |
| 工作区 | 数据库级隔离 | 复用 workspaceStore |
| AI Agent | — | 复用 Agent 框架，新增工作流 Tool/Skill |
| 数据库 | 共享 DataSource，新增工作流表 | — |
| 路由 | — | 统一 React Router，新增工作流路由 |

---

## 二、表单设计模块

> **设计原则**：不使用拖拽式表单设计器。拖拽式表单的样式难以精确控制，PC/移动端适配困难，且与鲁班"代码即所见"的核心理念冲突。
> 表单采用 **Agent 直接生成 HTML/CSS/JS 代码** 的方式，与现有 CodePage 机制一致，样式完全可控，一套代码适配 PC 和移动两端。

### 2.1 表单的组成：代码 + 数据契约

一个完整的表单由两部分组成：

| 组成部分 | 存储方式 | 说明 |
|---------|---------|------|
| **表单代码** | CodePage（HTML/CSS/JS） | 表单的视觉呈现，由 Agent 按规范生成，复用现有 CodePage 存储和渲染机制 |
| **字段 Schema** | JSON（存储在 `form_definitions.fields` 字段） | 表单的数据契约，描述每个字段的 key、类型、校验规则，供工作流引擎读取 |

两者通过 `data-field` 属性关联：HTML 中每个表单控件通过 `data-field="字段key"` 标记，运行时平台根据 Schema 和字段权限控制其行为和显隐。

### 2.2 字段 Schema 定义（数据契约）

字段 Schema 是表单与工作流之间的桥梁。工作流引擎不解析 HTML，只读取 Schema 来了解表单有哪些字段、字段类型、如何校验。

```typescript
// 字段 Schema 完整定义
interface FormFieldSchema {
  key: string;                    // 字段唯一标识，如 "reimbursement_amount"
  type: FieldType;                // 字段类型（17 种，含 excel、detail_table 等）
  label: string;                  // 字段标签，如 "报销金额"
  placeholder?: string;           // 占位提示
  defaultValue?: unknown;         // 默认值
  required: boolean;              // 是否必填
  validation?: FieldValidation;   // 校验规则
  options?: FieldOption[];        // 下拉/单选/多选的选项
  queryBinding?: string;          // 动态数据源：绑定的查询名称（如 "部门列表"）
  queryBindingConfig?: {          // 动态数据源配置
    queryName: string;            // 查询名称
    labelField: string;           // 显示字段（如 "name"）
    valueField: string;           // 值字段（如 "id"）
  };
  computedFrom?: string;          // 计算公式来源（如 "end_date - start_date"）
  visibleWhen?: string;           // 显示条件表达式（如 "type === 'other'"）
  sensitiveMask?: string;         // 脱敏规则
  autoFill?: AutoFillConfig;      // 动态带入配置（详见 2.5）
  excelConfig?: ExcelFieldConfig; // Excel 上传解析配置（type=excel 时，详见 2.8）
}

interface AutoFillConfig {
  source: AutoFillSource;        // 带入来源
  sourceKey?: string;            // 来源键（如 current_user 的 "department_name"）
  sourceQuery?: string;          // 查询名称（source=query 时使用）
  sourceQueryParams?: Record<string, string>;  // 查询参数，支持 {{field.字段key}} 引用表单字段值，{{context.xxx}} 引用平台上下文
  formula?: string;              // 公式表达式（source=formula 时使用）
  overwritable: boolean;         // 带入后是否允许用户修改（默认 true）
  triggerOn?: string;            // 联动触发：当指定字段变化时重新带入
  fallback?: 'manual' | 'hide' | 'default';  // 平台缺失该字段时的降级策略（默认 'manual'）
}

type AutoFillSource =
  | 'current_user'    // 当前登录用户信息
  | 'current_time'    // 当前系统时间
  | 'query'           // 查询结果
  | 'formula'         // 公式计算
  | 'fixed';          // 固定值（等同于 defaultValue）

type FieldType =
  | 'text'           // 单行文本
  | 'textarea'       // 多行文本
  | 'number'         // 数字
  | 'amount'         // 金额（带货币符号）
  | 'select'         // 下拉选择
  | 'multi_select'   // 多选下拉
  | 'radio'          // 单选按钮组
  | 'checkbox'       // 复选框
  | 'date'           // 日期
  | 'datetime'       // 日期时间
  | 'switch'         // 开关
  | 'file'           // 附件上传
  | 'excel'          // Excel 上传解析
  | 'member'         // 人员选择
  | 'department'     // 部门选择
  | 'detail_table'   // 明细表（子表格）
  | 'computed'       // 计算字段（只读，自动计算）
  | 'reference';     // 关联表单引用

interface FieldValidation {
  min?: number;                  // 最小值（数字/日期）
  max?: number;                  // 最大值（数字/日期）
  minLength?: number;            // 最小长度（文本）
  maxLength?: number;            // 最大长度（文本）
  pattern?: string;              // 正则表达式
  patternMessage?: string;       // 正则校验失败提示
  customRule?: string;           // 自定义校验函数名（JS 中定义）
  acceptedFileTypes?: string[];  // 允许的文件类型（附件）
  maxFileSize?: number;          // 最大文件大小（MB）
  maxFileCount?: number;         // 最大上传数量（附件，默认 1）
}

interface FieldOption {
  label: string;
  value: string;
}
```

### 2.3 表单代码规范（Agent 生成规则）

Agent 生成的表单代码必须严格遵守以下规范，确保平台能正确解析、渲染、提取数据。

#### 2.3.1 HTML 结构规范

```html
<!-- 每个表单页面的根元素必须包含 id="workflow-form" -->
<div id="workflow-form">
  
  <!-- 表单分组：用 <fieldset> 包裹，data-group 标识分组名称 -->
  <fieldset data-group="基本信息">
    <legend>基本信息</legend>
    
    <!-- 每个字段区域：<div class="form-field"> 包裹 -->
    <!-- data-field 属性值必须与 Schema 中的 key 一致 -->
    <div class="form-field" data-field="applicant_name">
      <label class="form-label">
        申请人 <span class="required-mark">*</span>
      </label>
      <!-- 表单控件：必须有 name 属性，值与 data-field 一致 -->
      <input type="text" 
             name="applicant_name" 
             placeholder="请输入申请人姓名"
             class="form-input" />
      <!-- 校验提示区：class="field-error" -->
      <span class="field-error"></span>
    </div>
    
    <!-- 下拉选择 -->
    <div class="form-field" data-field="expense_type">
      <label class="form-label">报销类型 <span class="required-mark">*</span></label>
      <select name="expense_type" class="form-select">
        <option value="">请选择</option>
        <option value="travel">差旅费</option>
        <option value="office">办公用品费</option>
        <option value="other">其他费用</option>
      </select>
      <span class="field-error"></span>
    </div>
    
    <!-- 条件显示：Agent 在 JS 中监听 change 事件控制显隐 -->
    <!-- data-visible-when 仅为标记，实际逻辑由 JS 处理 -->
    <div class="form-field" data-field="other_reason" 
         data-depends-on="expense_type" data-visible-when="other">
      <label class="form-label">其他费用说明 <span class="required-mark">*</span></label>
      <textarea name="other_reason" class="form-textarea" rows="3"></textarea>
      <span class="field-error"></span>
    </div>
  </fieldset>
  
  <fieldset data-group="费用明细">
    <legend>费用明细</legend>
    <!-- 明细表：用 <table> 实现，data-field="detail_table" -->
    <div class="form-field" data-field="expense_details">
      <table class="detail-table" id="expense_details_table">
        <thead>
          <tr>
            <th>日期</th>
            <th>费用项目</th>
            <th>金额</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <!-- 动态行由 JS 渲染 -->
        </tbody>
      </table>
      <button type="button" class="btn-add-row" onclick="addDetailRow()">+ 添加一行</button>
    </div>
  </fieldset>
  
  <!-- 提交按钮 -->
  <div class="form-actions">
    <button type="button" class="btn-submit" onclick="submitForm()">提交</button>
    <button type="button" class="btn-save-draft" onclick="saveDraft()">保存草稿</button>
  </div>
</div>
```

**HTML 强制规则**：

| 规则 | 说明 |
|------|------|
| 根元素 `id="workflow-form"` | 平台根据此 ID 定位表单容器 |
| 字段容器 `class="form-field"` | 每个字段必须包裹在此容器中 |
| `data-field` 属性 | 值必须与 Schema 中的 `key` 完全一致，平台据此提取数据 |
| `name` 属性 | 与 `data-field` 保持一致 |
| `class="form-label"` | 标签样式类 |
| `class="form-input"` / `form-select` / `form-textarea` | 表单控件统一样式类 |
| `class="field-error"` | 校验错误提示区域 |
| `class="required-mark"` | 必填标识 `*` |
| `<fieldset data-group="分组名">` | 字段分组容器 |
| 明细表 `class="detail-table"` | 子表格标识 |
| 按钮 `onclick` 绑定 JS 函数 | 与现有 CodePage 事件绑定方式一致 |

#### 2.3.2 CSS 响应式规范（一套代码适配 PC/移动两端）

```css
/* ===== 设计变量（与现有 designSpec 一致） ===== */
:root {
  --color-primary: #3B82F6;
  --color-bg: #F7F8FA;
  --color-card: #FFFFFF;
  --color-text: #1E293B;
  --color-text-secondary: #64748B;
  --color-border: #E2E8F0;
  --color-danger: #EF4444;
  --color-success: #10B981;
  --radius: 8px;
  --shadow: 0 1px 2px rgba(0,0,0,0.04);
  --input-height: 40px;  /* 触屏友好，比普通页面高 4px */
  --font-size: 15px;     /* 表单字体略大 */
}

/* ===== 表单容器 ===== */
#workflow-form {
  max-width: 720px;          /* PC 端最大宽度 */
  margin: 0 auto;
  padding: 24px 20px;
  background: var(--color-bg);
  min-height: 100vh;
  box-sizing: border-box;
}

/* ===== 字段分组 ===== */
.form-group {
  background: var(--color-card);
  border-radius: var(--radius);
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: var(--shadow);
}

.form-group legend {
  font-size: 17px;
  font-weight: 600;
  color: var(--color-text);
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
  width: 100%;
}

/* ===== 字段行 ===== */
.form-field {
  margin-bottom: 16px;
}

.form-field:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
  margin-bottom: 6px;
}

.required-mark {
  color: var(--color-danger);
  margin-left: 2px;
}

/* ===== 表单控件统一样式 ===== */
.form-input,
.form-select,
.form-textarea {
  width: 100%;
  height: var(--input-height);
  padding: 0 12px;
  font-size: var(--font-size);
  color: var(--color-text);
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
  -webkit-appearance: none;  /* 移除 iOS 默认样式 */
}

.form-textarea {
  height: auto;
  min-height: 80px;
  padding: 10px 12px;
  resize: vertical;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

/* 校验错误态 */
.form-field.has-error .form-input,
.form-field.has-error .form-select,
.form-field.has-error .form-textarea {
  border-color: var(--color-danger);
}

.field-error {
  display: none;
  font-size: 12px;
  color: var(--color-danger);
  margin-top: 4px;
}

.form-field.has-error .field-error {
  display: block;
}

/* ===== 只读态（审批查看时） ===== */
.form-field.readonly .form-input,
.form-field.readonly .form-select,
.form-field.readonly .form-textarea {
  background: #F1F5F9;
  color: var(--color-text-secondary);
  cursor: not-allowed;
  border-style: dashed;
}

/* ===== 隐藏态（无权限查看时） ===== */
.form-field.hidden {
  display: none;
}

/* ===== 脱敏态 ===== */
.form-field.masked .form-input {
  -webkit-text-security: disc;  /* 显示为圆点 */
}

/* ===== 明细表 ===== */
.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.detail-table th {
  background: #F8FAFC;
  padding: 10px 8px;
  text-align: left;
  font-weight: 500;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
}

.detail-table td {
  padding: 8px;
  border-bottom: 1px solid var(--color-border);
}

.detail-table .form-input,
.detail-table .form-select {
  height: 34px;
  font-size: 13px;
}

/* ===== 按钮 ===== */
.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding: 0 20px 32px;
}

.btn-submit,
.btn-save-draft,
.btn-add-row {
  height: 44px;
  padding: 0 24px;
  font-size: 15px;
  font-weight: 500;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.2s;
}

.btn-submit {
  flex: 1;
  background: var(--color-primary);
  color: #FFFFFF;
  box-shadow: 0 1px 2px rgba(0,0,0,0.16), 0 8px 20px rgba(59,130,246,0.26);
}

.btn-submit:active {
  transform: scale(0.98);
}

.btn-save-draft {
  background: var(--color-card);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-add-row {
  height: 34px;
  padding: 0 16px;
  font-size: 13px;
  background: transparent;
  color: var(--color-primary);
  border: 1px dashed var(--color-primary);
  margin-top: 8px;
}

/* ===== 移动端适配 ===== */
@media (max-width: 768px) {
  #workflow-form {
    padding: 16px 12px;
  }
  
  .form-group {
    padding: 16px;
    margin-bottom: 12px;
  }
  
  .form-group legend {
    font-size: 16px;
    padding-bottom: 10px;
    margin-bottom: 12px;
  }
  
  .form-input,
  .form-select {
    font-size: 16px;  /* iOS 禁止缩放的最小字号 */
  }
  
  .form-actions {
    flex-direction: column;
    padding: 0 12px 24px;
  }
  
  .btn-submit,
  .btn-save-draft {
    width: 100%;
  }
  
  /* 明细表在移动端横向滚动 */
  .detail-table-wrapper {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  .detail-table {
    min-width: 600px;
  }
}
```

**CSS 强制规则**：

| 规则 | 说明 |
|------|------|
| 断点 `768px` | 移动端以 768px 为界，小于等于时切换为移动端布局 |
| 表单控件高度 ≥ 40px | 触屏友好，确保手指点击区域足够大（iOS HIG 建议 ≥ 44px，留 4px 给 padding） |
| 移动端字体 ≥ 16px | 禁止 iOS Safari 自动缩放输入框 |
| 只读态 `background: #F1F5F9` + `border-style: dashed` | 视觉上区分可编辑和不可编辑 |
| 隐藏态 `display: none` | 无权限字段彻底隐藏 |
| 按钮 `onclick` 绑定 | 与现有 CodePage 规范一致，不使用 `addEventListener` |

#### 2.3.3 JavaScript 规范

```javascript
// ===== 平台注入的全局对象 =====
// window.__LUBAN_USER__ = { id, name, email }        // 当前登录用户（已有）
// window.__LUBAN_WORKFLOW__                          // 工作流上下文（新增）

// ===== 表单数据提取 =====
// 平台根据 data-field 属性自动提取表单数据
// Agent 也可手动调用：
function getFormData() {
  return window.__LUBAN_WORKFLOW__.getFormData();
  // 返回: { applicant_name: "张三", expense_type: "travel", ... }
}

// ===== 表单数据回填（驳回后重新填写、草稿恢复） =====
// 平台自动调用 setFormData 回填数据
// Agent 无需手动处理，但需确保 data-field 属性正确

// ===== 字段权限控制 =====
// 平台根据当前节点自动应用字段权限，Agent 无需手动处理
// 权限效果：
//   - 可编辑：正常显示
//   - 只读：添加 .readonly 类 + disabled 属性
//   - 隐藏：添加 .hidden 类
//   - 脱敏：添加 .masked 类

// ===== 表单校验 =====
function validateField(fieldKey) {
  // 平台提供校验函数，根据 Schema 中的 validation 规则自动校验
  return window.__LUBAN_WORKFLOW__.validateField(fieldKey);
  // 返回: { valid: boolean, message: string }
}

function validateForm() {
  return window.__LUBAN_WORKFLOW__.validateAllFields();
  // 返回: { valid: boolean, errors: { fieldKey: string } }
}

// ===== 表单提交 =====
function submitForm() {
  // 1. 校验
  var validation = validateForm();
  if (!validation.valid) {
    // 平台已自动显示错误提示
    return;
  }
  
  // 2. 提取数据
  var formData = getFormData();
  
  // 3. 提交（通过平台 API）
  window.__LUBAN_WORKFLOW__.submit(formData).then(function(result) {
    if (result.success) {
      window.__LUBAN__.navigateToPageByName('提交成功');
    }
  });
}

// ===== 保存草稿 =====
function saveDraft() {
  var formData = getFormData();
  window.__LUBAN_WORKFLOW__.saveDraft(formData);
}

// ===== 条件显示（联动逻辑） =====
// Agent 在 JS 中监听表单控件变化，控制关联字段的显隐
document.addEventListener('change', function(e) {
  var target = e.target;
  
  // 示例：报销类型选择"其他"时显示补充说明
  if (target.name === 'expense_type') {
    var otherField = document.querySelector('[data-field="other_reason"]');
    if (otherField) {
      otherField.style.display = target.value === 'other' ? 'block' : 'none';
    }
  }
});

// ===== 明细表操作 =====
var detailRowIndex = 0;

function addDetailRow() {
  var tbody = document.querySelector('#expense_details_table tbody');
  var row = document.createElement('tr');
  row.setAttribute('data-row-index', detailRowIndex);
  row.innerHTML = 
    '<td><input type="date" name="detail_date_' + detailRowIndex + '" class="form-input" /></td>' +
    '<td><input type="text" name="detail_item_' + detailRowIndex + '" class="form-input" /></td>' +
    '<td><input type="number" name="detail_amount_' + detailRowIndex + '" class="form-input" onchange="updateTotalAmount()" /></td>' +
    '<td><input type="text" name="detail_remark_' + detailRowIndex + '" class="form-input" /></td>' +
    '<td><button type="button" class="btn-delete-row" onclick="deleteDetailRow(this)">删除</button></td>';
  tbody.appendChild(row);
  detailRowIndex++;
}

function deleteDetailRow(btn) {
  btn.closest('tr').remove();
  updateTotalAmount();
}

// ===== 计算字段 =====
function updateTotalAmount() {
  var amounts = document.querySelectorAll('[name^="detail_amount_"]');
  var total = 0;
  amounts.forEach(function(input) {
    total += parseFloat(input.value) || 0;
  });
  var totalField = document.querySelector('[data-field="total_amount"]');
  if (totalField) {
    totalField.value = total.toFixed(2);
  }
}
```

**JS 强制规则**：

| 规则 | 说明 |
|------|------|
| 函数定义必须用 `function` 声明 | 不使用箭头函数，确保与 `onclick` 属性兼容 |
| 使用 `var` 声明变量 | 与现有 CodePage 规范一致，保持 ES5 兼容 |
| 事件绑定通过 `onclick` 属性 | 不使用 `addEventListener`（与 CodePage 规范一致） |
| 数据提取依赖 `data-field` 属性 | 平台自动扫描 `data-field` 属性提取数据，Agent 无需手动序列化 |
| 不操作字段权限 | 字段权限由平台根据节点配置自动应用，Agent 代码中不涉及 |
| 不直接调用后端 API | 提交、保存草稿等操作通过 `window.__LUBAN_WORKFLOW__` 代理 |

#### 2.3.4 附件上传字段规范（type: `file`）

附件上传字段用于上传**不需要解析**的文件（如 Word、PDF、图片、压缩包等），与 `excel` 字段（上传后解析入库）不同，附件字段仅做文件存储，不解析内容。

##### 2.3.4.1 与 Excel 字段的区别

| 维度 | 附件字段 (`type: 'file'`) | Excel 字段 (`type: 'excel'`) |
|------|--------------------------|---------------------------|
| 文件类型 | Word、PDF、图片、压缩包、音视频等 | 仅 .xlsx / .xls / .csv |
| 是否解析 | 否，原样存储 | 是，解析为结构化数据展示 |
| 存储方式 | 文件系统/OSS，数据库存路径引用 | `excel_imports` + `excel_import_rows` 表 |
| 预览 | 图片/PDF 缩略图预览 | 表格预览，可编辑 |
| 典型场景 | 合同附件、发票扫描件、资质证明 | 采购清单、报销明细、人员名单 |

##### 2.3.4.2 Schema 配置

```json
{
  "key": "contract_file",
  "type": "file",
  "label": "合同附件",
  "required": true,
  "placeholder": "请上传合同文件（支持 PDF、Word 格式）",
  "validation": {
    "acceptedFileTypes": [".pdf", ".doc", ".docx"],
    "maxFileSize": 20,           // 单位 MB
    "maxFileCount": 3            // 最多上传 3 个文件
  }
}
```

**配置项说明**：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `acceptedFileTypes` | `string[]` | `[]`（不限制） | 允许的文件扩展名，如 `[".pdf", ".docx", ".jpg", ".png"]` |
| `maxFileSize` | `number` | `10` | 单个文件最大大小（MB） |
| `maxFileCount` | `number` | `1` | 最大上传数量，设为 `1` 时仅允许上传单个文件 |

##### 2.3.4.3 HTML 结构

```html
<!-- 单文件上传（maxFileCount=1） -->
<div class="form-field" data-field="contract_file">
  <label class="form-label">
    合同附件 <span class="required-mark">*</span>
  </label>
  
  <!-- 上传按钮 -->
  <div class="file-upload-area" id="upload_contract_file">
    <label class="file-upload-btn">
      <svg class="file-upload-icon">...</svg>
      <span>上传文件</span>
      <input type="file"
             name="contract_file"
             accept=".pdf,.doc,.docx"
             hidden
             onchange="handleFileUpload(event, 'contract_file')">
    </label>
    <span class="file-upload-hint">支持 PDF、Word 格式，最大 20MB</span>
  </div>
  
  <!-- 已上传文件列表 -->
  <div class="file-list" id="filelist_contract_file" style="display:none;">
    <!-- 动态渲染 -->
  </div>
  
  <span class="field-error"></span>
</div>

<!-- 多文件上传（maxFileCount > 1） -->
<div class="form-field" data-field="certificate_files">
  <label class="form-label">
    资质证明 <span class="required-mark">*</span>
  </label>
  
  <!-- 拖拽上传区域 -->
  <div class="file-upload-area file-upload-multi" id="upload_certificate_files">
    <div class="file-upload-dropzone"
         ondragover="handleDragOver(event, 'certificate_files')"
         ondragleave="handleDragLeave(event, 'certificate_files')"
         ondrop="handleDrop(event, 'certificate_files')">
      <svg class="file-upload-icon">...</svg>
      <span class="file-upload-text">将文件拖拽到此处，或</span>
      <label class="file-upload-btn">
        <span>点击选择文件</span>
        <input type="file"
               name="certificate_files"
               accept=".pdf,.jpg,.png,.zip"
               multiple
               hidden
               onchange="handleFileUpload(event, 'certificate_files')">
      </label>
    </div>
    <span class="file-upload-hint">支持 PDF、图片、压缩包，单个最大 10MB，最多 5 个文件</span>
  </div>
  
  <!-- 已上传文件列表 -->
  <div class="file-list" id="filelist_certificate_files" style="display:none;">
    <!-- 动态渲染 -->
  </div>
  
  <span class="field-error"></span>
</div>
```

**文件列表项 HTML 模板**（JS 动态生成）：

```html
<div class="file-item" data-file-id="upload_1234567890">
  <!-- 文件图标 -->
  <div class="file-item-icon">
    <!-- 根据文件类型显示不同图标 -->
    <svg class="file-icon-pdf">...</svg>  <!-- PDF -->
    <svg class="file-icon-word">...</svg>  <!-- Word -->
    <svg class="file-icon-image">...</svg>  <!-- 图片 -->
    <svg class="file-icon-default">...</svg>  <!-- 其他 -->
  </div>
  
  <!-- 文件信息 -->
  <div class="file-item-info">
    <span class="file-item-name">合同附件_v2.pdf</span>
    <span class="file-item-size">2.3 MB</span>
  </div>
  
  <!-- 上传进度条（上传中时显示） -->
  <div class="file-item-progress" style="display:none;">
    <div class="file-item-progress-bar" style="width: 75%;"></div>
  </div>
  
  <!-- 操作按钮 -->
  <div class="file-item-actions">
    <button type="button" class="file-action-preview" 
            onclick="previewFile('contract_file', 'upload_1234567890')"
            title="预览">
      <svg>...</svg>
    </button>
    <button type="button" class="file-action-delete" 
            onclick="deleteFile('contract_file', 'upload_1234567890')"
            title="删除">
      <svg>...</svg>
    </button>
  </div>
</div>
```

##### 2.3.4.4 CSS 样式

```css
/* ===== 上传区域 ===== */
.file-upload-area {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 20px;
  background: #FAFBFC;
  transition: border-color 0.2s, background 0.2s;
}
.file-upload-dropzone {
  text-align: center;
  padding: 12px;
  cursor: pointer;
}
.file-upload-dropzone.drag-over {
  border-color: var(--color-primary);
  background: #EFF6FF;
}
.file-upload-area:hover {
  border-color: var(--color-primary);
}

.file-upload-icon {
  width: 40px;
  height: 40px;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}
.file-upload-text {
  display: block;
  color: var(--color-text-secondary);
  font-size: 14px;
  margin-bottom: 8px;
}

/* 上传按钮 */
.file-upload-btn {
  display: inline-block;
  padding: 8px 20px;
  background: var(--color-primary);
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}
.file-upload-btn:hover {
  background: #2563EB;
}

.file-upload-hint {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* ===== 文件列表 ===== */
.file-list {
  margin-top: 12px;
}

.file-item {
  display: flex;
  align-items: center;
  padding: 12px;
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  margin-bottom: 8px;
  gap: 12px;
  transition: border-color 0.2s;
}
.file-item:last-child {
  margin-bottom: 0;
}
.file-item:hover {
  border-color: var(--color-primary);
}
.file-item.uploading {
  border-color: #93C5FD;
  background: #EFF6FF;
}
.file-item.upload-error {
  border-color: #FECACA;
  background: #FEF2F2;
}

/* 文件图标 */
.file-item-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.file-item-icon svg {
  width: 32px;
  height: 32px;
}
.file-icon-pdf { color: #EF4444; }
.file-icon-word { color: #3B82F6; }
.file-icon-image { color: #10B981; }
.file-icon-default { color: #64748B; }

/* 文件信息 */
.file-item-info {
  flex: 1;
  min-width: 0;
}
.file-item-name {
  display: block;
  font-size: 14px;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-item-size {
  display: block;
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-top: 2px;
}

/* 上传进度条 */
.file-item-progress {
  width: 120px;
  height: 4px;
  background: #E2E8F0;
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
}
.file-item-progress-bar {
  height: 100%;
  background: var(--color-primary);
  border-radius: 2px;
  transition: width 0.3s ease;
}

/* 操作按钮 */
.file-item-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.file-action-preview,
.file-action-delete {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  transition: background 0.2s, color 0.2s;
}
.file-action-preview:hover {
  background: #EFF6FF;
  color: var(--color-primary);
}
.file-action-delete:hover {
  background: #FEF2F2;
  color: var(--color-danger);
}
.file-action-preview svg,
.file-action-delete svg {
  width: 16px;
  height: 16px;
}

/* 多文件上传：上传区域常驻（不同于单文件替换） */
.file-upload-multi .file-upload-area {
  /* 已有文件后仍显示上传区域 */
}

/* 移动端适配 */
@media (max-width: 768px) {
  .file-item {
    flex-wrap: wrap;
  }
  .file-item-progress {
    width: 100%;
    order: 3;
  }
  .file-item-actions {
    order: 2;
  }
  .file-upload-area {
    padding: 16px;
  }
}
```

##### 2.3.4.5 JS 方法

Agent 需在表单 JS 中实现以下方法：

```javascript
// ===== 文件上传 =====
function handleFileUpload(event, fieldKey) {
  // 事件触发：input[type=file] 的 onchange 事件
  // 校验：文件类型（acceptedFileTypes）、文件大小（maxFileSize）、数量上限（maxFileCount）
  // 调用平台 API 上传文件
  // 上传成功后渲染文件列表
}

function handleDragOver(event, fieldKey) {
  // 拖拽悬停：高亮上传区域
  event.preventDefault();
  document.querySelector('#upload_' + fieldKey + ' .file-upload-dropzone').classList.add('drag-over');
}

function handleDragLeave(event, fieldKey) {
  // 拖拽离开：取消高亮
  document.querySelector('#upload_' + fieldKey + ' .file-upload-dropzone').classList.remove('drag-over');
}

function handleDrop(event, fieldKey) {
  // 拖拽释放：获取文件列表，触发上传
  event.preventDefault();
  document.querySelector('#upload_' + fieldKey + ' .file-upload-dropzone').classList.remove('drag-over');
  var files = event.dataTransfer.files;
  uploadFiles(fieldKey, files);
}

// ===== 文件上传核心 =====
function uploadFiles(fieldKey, files) {
  // 1. 校验文件数量（已有文件 + 新文件 ≤ maxFileCount）
  // 2. 逐个校验文件类型和大小
  // 3. 调用 window.__LUBAN_WORKFLOW__.uploadFile(fieldKey, file) 上传
  // 4. 监听上传进度，更新进度条
  // 5. 上传完成后添加到文件列表
}

// ===== 文件操作 =====
function deleteFile(fieldKey, fileId) {
  // 从文件列表中移除指定文件
  // 如果 fieldKey 是 required，删除最后一个文件时显示校验错误
}

function previewFile(fieldKey, fileId) {
  // 图片：在新窗口打开
  // PDF：使用浏览器内置 PDF 查看器或平台预览组件
  // 其他：触发下载
}

function getFileList(fieldKey) {
  // 返回当前已上传的文件 ID 列表
  // 供 submitForm 调用
}

// ===== 文件类型图标映射 =====
var FILE_ICON_MAP = {
  'pdf': 'file-icon-pdf',
  'doc': 'file-icon-word',
  'docx': 'file-icon-word',
  'jpg': 'file-icon-image',
  'jpeg': 'file-icon-image',
  'png': 'file-icon-image',
  'gif': 'file-icon-image',
  'xls': 'file-icon-excel',
  'xlsx': 'file-icon-excel',
  'zip': 'file-icon-zip',
  'rar': 'file-icon-zip',
  '7z': 'file-icon-zip'
};

function getFileIconClass(fileName) {
  var ext = fileName.split('.').pop().toLowerCase();
  return FILE_ICON_MAP[ext] || 'file-icon-default';
}
```

##### 2.3.4.6 平台上传 API

`window.__LUBAN_WORKFLOW__` 新增文件上传相关方法：

```typescript
interface LubanWorkflowAPI {
  // ... 已有方法 ...
  
  // ===== 文件上传 =====
  uploadFile(fieldKey: string, file: File): Promise<{
    fileId: string;           // 上传后的文件唯一 ID
    fileName: string;         // 原始文件名
    fileSize: number;         // 文件大小（字节）
    fileType: string;         // MIME 类型
    fileUrl: string;          // 文件访问 URL（用于预览/下载）
    thumbnailUrl?: string;    // 缩略图 URL（图片类型时）
  }>;
  // 上传单个文件，返回文件信息
  // 自动处理：文件存储（本地/OSS）、文件名去重、缩略图生成（图片）
  
  deleteFile(fileId: string): Promise<void>;
  // 删除已上传的文件（表单提交前调用，用于清理用户删除的文件）
  
  getFileList(fieldKey: string): Promise<FileInfo[]>;
  // 获取指定字段的已上传文件列表（回填时使用）
}
```

##### 2.3.4.7 存储机制

```
┌─────────────────────────────────────────────────────────────────┐
│                    附件存储架构                                    │
│                                                                 │
│  编辑阶段（上传文件）                                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 用户选择文件 → 前端校验 → 上传到临时目录                     │   │
│  │ 路径：/tmp/attachments/{workspaceId}/{uuid}/{filename}     │   │
│  │ 返回 fileId，前端维护文件列表在内存中                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│           │                                                     │
│           │ 用户提交表单                                          │
│           ↓                                                     │
│  提交阶段                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. 将临时文件移动到正式目录                                  │   │
│  │    路径：/attachments/{workspaceId}/{formId}/{instanceId}/  │   │
│  │ 2. 在 form_data 中记录文件引用                              │   │
│  │    { "contract_file": [                                   │   │
│  │      { "fileId": "a1b2c3", "fileName": "合同.pdf",         │   │
│  │        "fileSize": 2410000, "fileType": "application/pdf" }│   │
│  │    ]}                                                     │   │
│  │ 3. 清理未提交的临时文件（定时任务）                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│           │                                                     │
│           │ 流程结束                                              │
│           ↓                                                     │
│  归档阶段                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 文件随流程实例数据保留，按 retentionDays 策略清理             │   │
│  │ 支持管理员手动清理或导出                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**关键设计决策**：

| 决策 | 说明 |
|------|------|
| **编辑阶段存临时目录** | 用户上传后到提交前，文件存临时目录，避免产生孤儿文件 |
| **提交时移动** | 提交时原子操作：移动文件 + 创建流程实例 + 记录 form_data |
| **临时文件清理** | 定时任务清理超过 24 小时的临时文件 |
| **文件去重** | 同名文件自动添加序号后缀（`合同(1).pdf`） |
| **缩略图** | 图片类型自动生成缩略图（200×200），用于文件列表预览 |

##### 2.3.4.8 校验规则

| 校验项 | 时机 | 处理 |
|--------|------|------|
| 文件类型 | 前端选择文件时 | 不在 `acceptedFileTypes` 中则拒绝，提示"不支持的文件类型，仅支持：.pdf, .docx" |
| 文件大小 | 前端选择文件时 | 超过 `maxFileSize` 则拒绝，提示"文件大小不能超过 XX MB" |
| 文件数量 | 前端选择文件时 | 已有文件数 + 新文件数 > `maxFileCount` 时拒绝，提示"最多上传 X 个文件" |
| 必填校验 | 提交时 | `required=true` 且文件列表为空时，提交失败，提示"请上传附件" |
| 空文件 | 前端选择文件时 | 文件大小为 0 时拒绝，提示"文件为空，请重新选择" |

##### 2.3.4.9 完整配置示例

```json
// 场景 1：合同附件（单文件）
{
  "key": "contract_file",
  "type": "file",
  "label": "合同附件",
  "required": true,
  "placeholder": "请上传签署后的合同文件",
  "validation": {
    "acceptedFileTypes": [".pdf"],
    "maxFileSize": 20,
    "maxFileCount": 1
  }
}

// 场景 2：发票附件（多文件）
{
  "key": "invoice_files",
  "type": "file",
  "label": "发票附件",
  "required": true,
  "placeholder": "请上传发票扫描件或照片",
  "validation": {
    "acceptedFileTypes": [".pdf", ".jpg", ".jpeg", ".png"],
    "maxFileSize": 10,
    "maxFileCount": 10
  }
}

// 场景 3：资质证明（非必填，多文件）
{
  "key": "certificate_files",
  "type": "file",
  "label": "资质证明（选填）",
  "required": false,
  "placeholder": "可上传相关资质证书、获奖证明等",
  "validation": {
    "acceptedFileTypes": [".pdf", ".jpg", ".png", ".zip"],
    "maxFileSize": 50,
    "maxFileCount": 5
  }
}
```

### 2.4 平台注入对象 `window.__LUBAN_WORKFLOW__`

平台在渲染表单页面时，向全局注入 `window.__LUBAN_WORKFLOW__` 对象，提供以下能力：

```typescript
interface LubanWorkflowAPI {
  // ===== 数据读写 =====
  getFormData(): Record<string, unknown>;
  // 扫描所有 [data-field] 元素，提取值，返回 { fieldKey: value }
  // 明细表返回数组：[{ date: "2026-01-01", item: "餐费", amount: 100 }, ...]
  
  setFormData(data: Record<string, unknown>): void;
  // 回填数据到表单（驳回后重新填写、草稿恢复时调用）
  
  // ===== 自动带入 =====
  autoFill(): Promise<void>;
  // 根据 Schema 中所有字段的 autoFill 配置，自动填充表单
  // 平台渲染表单时自动调用，Agent 无需关心
  // 带入顺序：先 fixed → current_user → current_time → formula → query（依赖最重的最后执行）
  
  getUserContext(): UserContext;
  // 返回当前登录用户的完整上下文信息（来自身份提供商，详见 2.5.10）
  // 供 autoFill 和 Agent 代码使用
  
  // ===== 校验 =====
  validateField(fieldKey: string): { valid: boolean; message: string };
  // 根据 Schema 中的 validation 规则校验单个字段
  
  validateAllFields(): { valid: boolean; errors: Record<string, string> };
  // 校验所有字段，自动标记 .has-error 类
  
  // ===== 文件上传（附件字段，详见 2.3.4） =====
  uploadFile(fieldKey: string, file: File): Promise<{
    fileId: string;           // 上传后的文件唯一 ID
    fileName: string;         // 原始文件名
    fileSize: number;         // 文件大小（字节）
    fileType: string;         // MIME 类型
    fileUrl: string;          // 文件访问 URL（用于预览/下载）
    thumbnailUrl?: string;    // 缩略图 URL（图片类型时）
  }>;
  // 上传单个文件到临时目录，返回文件信息
  // 文件在提交时才移动到正式目录
  
  deleteUploadedFile(fileId: string): Promise<void>;
  // 删除已上传的临时文件（用户删除文件列表中的文件时调用）
  
  getUploadedFiles(fieldKey: string): Promise<FileInfo[]>;
  // 获取指定字段的已上传文件列表（回填/草稿恢复时使用）
  
  // ===== 提交 =====
  submit(formData: Record<string, unknown>): Promise<{ success: boolean; instanceId?: number }>;
  // 提交表单数据，创建流程实例
  
  saveDraft(formData: Record<string, unknown>): Promise<void>;
  // 保存草稿
  
  // ===== 权限 =====
  applyFieldPermissions(permissions: FieldPermission[]): void;
  // 根据当前节点权限配置，自动设置字段的 .readonly / .hidden / .masked 类
  // 审批页面渲染时由平台自动调用，Agent 无需关心
  
  // ===== 上下文 =====
  getContext(): {
    instanceId?: number;      // 流程实例 ID（审批/查看时有值）
    taskId?: number;          // 任务 ID（审批处理时有值）
    currentNodeId?: string;   // 当前节点 ID
    workspaceId: number;      // 当前工作区 ID
    applicationId: number;    // 当前应用 ID
    mode: 'create' | 'approve' | 'view';  // 页面模式
  };
}

interface UserContext {
  // ===== 身份标识 =====
  id: string;                  // 用户在鲁班内的唯一 ID（映射自外部平台）
  provider: 'dingtalk' | 'feishu' | 'wecom' | 'ldap' | 'oidc' | 'custom';
                               // 用户来源平台

  // ===== 基础字段（所有平台必有的最小集合） =====
  name: string;                // 姓名/昵称
  avatar?: string;             // 头像 URL

  // ===== 可选字段（取决于平台是否提供） =====
  email?: string;              // 邮箱
  mobile?: string;             // 手机号
  employeeNo?: string;         // 工号
  position?: string;           // 职位/岗位
  hireDate?: string;           // 入职日期

  // ===== 组织信息（可选） =====
  departmentId?: string;       // 部门 ID
  departmentName?: string;     // 部门名称
  departmentPath?: string;     // 部门路径（如 "总公司/研发部/前端组"）
  leaderId?: string;           // 直属上级 ID
  leaderName?: string;         // 直属上级姓名

  // ===== 角色与权限 =====
  roles: string[];             // 角色列表（如 ["admin", "approver"]）

  // ===== 平台原始数据 =====
  raw: Record<string, unknown>;  // 平台返回的原始用户对象，供 Agent 代码访问平台特有字段
}
```

### 2.5 字段动态带入（Auto-Fill）

企业级表单中，大量字段不需要用户手动填写，应根据当前登录用户或系统上下文自动带入。例如：申请人姓名自动带入当前用户、申请日期默认今天、所属部门自动带入用户部门、部门预算根据所选部门自动查询。

#### 2.5.1 五种带入来源

| 来源 | 说明 | 适用场景 |
|------|------|---------|
| **`current_user`** | 当前登录用户信息 | 申请人、工号、部门、职位、直属上级、手机号、入职日期 |
| **`current_time`** | 当前系统时间 | 申请日期、提交时间 |
| **`query`** | 查询结果 | 根据其他字段查数据库（如选择部门后查部门预算、选择项目后查项目负责人） |
| **`formula`** | 公式计算 | 结束日期 = 开始日期 + N 天、合计 = 单价 × 数量 |
| **`fixed`** | 固定默认值 | 请假类型默认"年假"、币种默认"人民币" |

#### 2.5.2 Schema 配置示例

```json
{
  "fields": [
    {
      "key": "applicant_name",
      "type": "text",
      "label": "申请人",
      "required": true,
      "autoFill": {
        "source": "current_user",
        "sourceKey": "name",
        "overwritable": false
      }
    },
    {
      "key": "department",
      "type": "text",
      "label": "所在部门",
      "required": true,
      "autoFill": {
        "source": "current_user",
        "sourceKey": "departmentName",
        "overwritable": false
      }
    },
    {
      "key": "apply_date",
      "type": "date",
      "label": "申请日期",
      "required": true,
      "autoFill": {
        "source": "current_time",
        "formula": "today",
        "overwritable": true
      }
    },
    {
      "key": "end_date",
      "type": "date",
      "label": "结束日期",
      "required": true,
      "autoFill": {
        "source": "formula",
        "formula": "start_date + 3",
        "overwritable": true,
        "triggerOn": "start_date"
      }
    },
    {
      "key": "department_budget",
      "type": "amount",
      "label": "部门年度预算",
      "autoFill": {
        "source": "query",
        "sourceQuery": "GetDepartmentBudget",
        "sourceQueryParams": { "dept_id": "{{field.department}}" },
        "overwritable": false,
        "triggerOn": "department"
      }
    }
  ]
}
```

#### 2.5.3 `current_user` 可用的 sourceKey 列表

| sourceKey | 类型 | 必返回 | 说明 | 平台差异 |
|-----------|------|--------|------|---------|
| `name` | string | ✅ 所有平台 | 用户姓名/昵称 | 所有平台均有 |
| `email` | string | ⚠️ 部分平台 | 邮箱 | 飞书、LDAP 有；钉钉、企微可能无 |
| `mobile` | string | ⚠️ 部分平台 | 手机号 | 钉钉、企微有；飞书需单独授权 |
| `departmentName` | string | ⚠️ 部分平台 | 部门名称 | 所有平台有，但钉钉可能返回数组取第一个 |
| `departmentPath` | string | ⚠️ 部分平台 | 部门完整路径 | 企微、LDAP 有完整路径；钉钉/飞书需拼接 |
| `position` | string | ⚠️ 部分平台 | 职位/岗位 | 所有平台均有，但字段名不同 |
| `leaderName` | string | ⚠️ 部分平台 | 直属上级姓名 | 钉钉、企微、LDAP 有；飞书需额外 API 查询 |
| `employeeNo` | string | ⚠️ 部分平台 | 工号 | LDAP 通常有；钉钉/飞书/企微可能无 |
| `hireDate` | string | ⚠️ 部分平台 | 入职日期 | LDAP 可能有；其他平台通常无 |
| `id` | string | ✅ 所有平台 | 用户 ID（鲁班内部 ID） | 所有平台均有 |
| `departmentId` | string | ⚠️ 部分平台 | 部门 ID（鲁班内部 ID） | 所有平台有，但格式不同 |
| `leaderId` | string | ⚠️ 部分平台 | 直属上级 ID（鲁班内部 ID） | 钉钉、企微、LDAP 有 |

**空值行为**：当某个 sourceKey 在当前平台不可用时，`autoFill` 返回空字符串 `""`，Agent 应在 Schema 中将该字段的 `overwritable` 设为 `true`（允许用户手动填写），避免带入空白值且无法修改。

**跨平台兼容写法**（Agent 生成 Schema 时应注意）：

```json
// 推荐：always 检查 availability，不存在时降级为手动填写
{
  "key": "employee_no",
  "type": "text",
  "label": "工号",
  "autoFill": {
    "source": "current_user",
    "sourceKey": "employeeNo",
    "overwritable": true  // 注意：大部分平台无工号，必须设为 true
  }
}

// 不推荐：直接设为不可修改，万一平台无此字段导致空白无法修改
{
  "key": "employee_no",
  "autoFill": {
    "source": "current_user",
    "sourceKey": "employeeNo",
    "overwritable": false  // ❌ 风险：钉钉/飞书可能无工号，用户无法手动填写
  }
}
```

#### 2.5.4 `current_time` 公式

| 公式 | 说明 | 输出示例 |
|------|------|---------|
| `today` | 当天日期 | `2026-08-12` |
| `now` | 当前日期时间 | `2026-08-12 14:30:00` |
| `today+7` | 7 天后 | `2026-08-19` |
| `today-3` | 3 天前 | `2026-08-09` |
| `first_day_of_month` | 当月第一天 | `2026-08-01` |
| `last_day_of_month` | 当月最后一天 | `2026-08-31` |
| `first_day_of_year` | 当年第一天 | `2026-01-01` |

#### 2.5.5 带入时机与执行顺序

平台在渲染表单时，按以下顺序执行带入：

```
1. fixed       → 固定值，无条件先执行
2. current_user → 用户信息，同步获取无依赖
3. current_time → 系统时间，同步获取无依赖
4. formula     → 公式计算，依赖其他字段值（如 end_date = start_date + 3）
5. query       → 查询结果，可能有 HTTP 请求，需要异步等待
```

**执行规则**：

- 同一优先级的字段**并行**带入
- 不同优先级的字段**串行**带入，确保依赖数据已就绪
- 如果字段的 `triggerOn` 指定了依赖字段，当依赖字段值变化时**重新执行带入**
- 带入完成后，触发表单校验（重新校验已带入的字段）
- 如果 `overwritable: false`，字段同时被设为**只读**（添加 `.readonly` 类），用户无法修改

#### 2.5.6 不可覆盖字段的视觉表现

**CSS 新增规则**：

```css
/* 自动带入且不可覆盖的字段 */
.form-field.auto-filled .form-input,
.form-field.auto-filled .form-select,
.form-field.auto-filled .form-textarea {
  background: #F0F7FF;          /* 浅蓝背景，区分于普通只读的灰色 */
  color: var(--color-text);
  border-style: solid;
  border-color: #93C5FD;        /* 蓝色边框 */
  cursor: default;
}

/* 自动带入且可覆盖的字段：正常样式，不需要特殊标记 */
/* 平台在带入后触发一次闪烁动画，提示用户"这个值已自动填入" */
.form-field.auto-filled-just-now .form-input,
.form-field.auto-filled-just-now .form-select {
  animation: autoFillHighlight 1.5s ease-out;
}

@keyframes autoFillHighlight {
  0%   { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }
  100% { border-color: var(--color-border); box-shadow: none; }
}
```

同时更新 HTML 强制规则表：

| 规则 | 说明 |
|------|------|
| `.auto-filled` 类 | 平台自动添加到不可覆盖的自动带入字段上 |
| `.auto-filled-just-now` 类 | 平台自动添加，1.5 秒后自动移除，产生闪烁提示效果 |

#### 2.5.7 Agent 代码中的自动带入

Agent 在 JS 代码中**无需手动处理自动带入**，平台在 `FormRenderer` 加载表单后自动调用 `window.__LUBAN_WORKFLOW__.autoFill()`。Agent 只需确保：

- 每个需要自动带入的字段在 Schema 中正确配置 `autoFill`
- 如果字段类型是 `member` 或 `department`，`autoFill.sourceKey` 返回的是 ID 值，Agent 需在 HTML 中使用 `<input type="hidden">` 存 ID，`<input type="text">` 显示名称
- 不覆盖用户手动修改的值（平台通过 `overwritable` 字段判断）

**Agent 代码中可用的用户上下文**：

```javascript
// Agent 可直接使用 window.__LUBAN_USER__（已有）
// 扩展后可用的完整上下文：
var user = window.__LUBAN_WORKFLOW__.getUserContext();
// user.name, user.departmentName, user.position, user.leaderName, ...

// 示例：在 JS 中基于用户信息做额外逻辑
function initForm() {
  var user = window.__LUBAN_WORKFLOW__.getUserContext();
  // 如果当前用户是总监级别，自动显示"总监审批意见"字段
  if (user.position.indexOf('总监') !== -1) {
    document.querySelector('[data-field="director_comment"]').style.display = 'block';
  }
}
```

#### 2.5.8 常见场景配置速查

| 场景 | autoFill 配置 | 效果 |
|------|-------------|------|
| 申请人自动带入当前用户 | `{ source: "current_user", sourceKey: "name", overwritable: false }` | 不可修改，蓝底 |
| 申请日期默认今天 | `{ source: "current_time", formula: "today", overwritable: true }` | 可修改，加载时闪烁提示 |
| 结束日期=开始日期+3天 | `{ source: "formula", formula: "start_date + 3", overwritable: true, triggerOn: "start_date" }` | 开始日期变化时自动重算 |
| 选部门后自动查预算 | `{ source: "query", sourceQuery: "GetBudget", sourceQueryParams: {"dept_id": "{{field.department}}"}, overwritable: false, triggerOn: "department" }` | 不可修改，蓝底 |
| 根据当前用户查历史审批 | `{ source: "query", sourceQuery: "GetUserHistory", sourceQueryParams: {"user_id": "{{context.current_user_id}}"}, overwritable: false }` | 不可修改，蓝底 |
| 币种默认"人民币" | `{ source: "fixed", formula: "CNY", overwritable: true }` | 可修改，等同于 `defaultValue` |

#### 2.5.9 上下文变量引用（`sourceQueryParams` 可用变量）

`sourceQueryParams` 中的参数值除了写死常量外，还可以引用**表单字段值**和**平台上下文变量**。平台在执行查询带入时，自动解析并替换这些变量。

**变量语法**：

| 语法 | 含义 | 示例 |
|------|------|------|
| `{{field.字段key}}` | 引用表单中某个字段的当前值 | `{{field.department}}` → 取表单中 department 字段的值 |
| `{{context.current_user_id}}` | 当前登录用户 ID | `{{context.current_user_id}}` → `42` |
| `{{context.current_user_name}}` | 当前登录用户姓名 | `{{context.current_user_name}}` → `"张三"` |
| `{{context.current_user_provider}}` | 当前用户来源平台 | `{{context.current_user_provider}}` → `"feishu"` |
| `{{context.current_user_department_id}}` | 当前用户部门 ID | `{{context.current_user_department_id}}` → `5` |
| `{{context.current_user_department_name}}` | 当前用户部门名称 | `{{context.current_user_department_name}}` → `"研发部"` |
| `{{context.instance_id}}` | 当前流程实例 ID（审批/查看模式时有值） | `{{context.instance_id}}` → `128` |
| `{{context.task_id}}` | 当前任务 ID（审批处理时有值） | `{{context.task_id}}` → `305` |
| `{{context.workspace_id}}` | 当前工作区 ID | `{{context.workspace_id}}` → `1` |
| `{{context.application_id}}` | 当前应用 ID | `{{context.application_id}}` → `7` |
| `{{context.now}}` | 当前时间戳（ISO 格式） | `{{context.now}}` → `"2026-08-12T14:30:00"` |

**规则**：

- **解析顺序**：先解析 `{{context.xxx}}`（平台上下文），再解析 `{{field.xxx}}`（表单字段）
- **字段依赖**：如果引用了 `{{field.xxx}}`，该字段应作为 `triggerOn` 的值，确保字段变化时查询重新执行
- **空值处理**：如果引用的变量不存在或为空，传入 `null`，由后端查询自行处理
- **审批模式**：`instance_id` 和 `task_id` 仅在审批/查看模式下有值，创建模式下为 `null`

**完整示例**：

```json
// 场景：发起报销时，自动查询当前用户本月的报销总额
{
  "key": "current_month_total",
  "type": "amount",
  "label": "本月已报销总额",
  "autoFill": {
    "source": "query",
    "sourceQuery": "GetMonthlyExpense",
    "sourceQueryParams": {
      "user_id": "{{context.current_user_id}}",
      "year_month": "{{context.now}}"
    },
    "overwritable": false,
    "triggerOn": null
  }
}

// 场景：审批时，自动查询当前流程实例关联的合同信息
{
  "key": "contract_info",
  "type": "text",
  "label": "关联合同",
  "autoFill": {
    "source": "query",
    "sourceQuery": "GetContractByInstance",
    "sourceQueryParams": {
      "instance_id": "{{context.instance_id}}"
    },
    "overwritable": false
  }
}
```

**`current_user` 可作为上下文变量的 sourceKey 速查**：

除 `source: "current_user"` 直接带入外，`sourceQueryParams` 中也可引用当前用户的任意属性：

| 变量 | 等价于 |
|------|--------|
| `{{context.current_user_id}}` | `source: "current_user", sourceKey: "id"` |
| `{{context.current_user_name}}` | `source: "current_user", sourceKey: "name"` |
| `{{context.current_user_department_id}}` | `source: "current_user", sourceKey: "departmentId"` |
| `{{context.current_user_department_name}}` | `source: "current_user", sourceKey: "departmentName"` |
| `{{context.current_user_leader_id}}` | `source: "current_user", sourceKey: "leaderId"` |
| `{{context.current_user_position}}` | `source: "current_user", sourceKey: "position"` |

#### 2.5.10 用户身份与第三方平台对接

> **核心原则**：鲁班不维护自己的用户体系。用户身份完全来自外部平台（钉钉、飞书、企业微信、LDAP、OIDC 等），鲁班只做**身份映射**和**标准化投影**。

##### 2.5.10.1 身份架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      用户身份适配层                                │
│                                                                  │
│  外部平台                       鲁班内部                           │
│  ┌──────────┐                 ┌──────────────────┐               │
│  │ 钉钉      │──┐              │  UserContext      │               │
│  │ userid    │  │   Identity   │  ┌─────────────┐  │               │
│  │ name      │  │   Provider   │  │ id: string  │  │               │
│  │ avatar    │──┼──────────────→│  │ name: string│  │               │
│  │ mobile    │  │   适配器       │  │ provider    │  │               │
│  │ dept_id[] │  │              │  │ email?      │  │               │
│  └──────────┘  │              │  │ mobile?     │  │               │
│                │              │  │ ...         │  │               │
│  ┌──────────┐  │              │  │ raw: {...}  │  │  ┌──────────┐ │
│  │ 飞书      │──┤              │  └─────────────┘  │  │ autoFill │ │
│  │ open_id   │  │              └──────────────────┘  │  │ 带入引擎  │ │
│  │ name      │  │                        │           │  └──────────┘ │
│  │ email     │──┤                        │ 取值       │               │
│  │ avatar    │  │                        ↓           │  ┌──────────┐ │
│  │ dept_ids  │  │              ┌──────────────────┐  │  │ Agent    │ │
│  └──────────┘  │              │ sourceKey 映射     │  │  │ 代码     │ │
│                │              │ "name" → name      │  │  └──────────┘ │
│  ┌──────────┐  │              │ "email" → email    │  │               │
│  │ 企业微信   │──┤              │ "mobile" → mobile  │  │               │
│  │ userid    │  │              │ "employeeNo" → ""  │  │               │
│  │ name      │  │              │ (飞书无此字段)      │  │               │
│  │ position  │──┘              └──────────────────┘  │               │
│  │ mobile    │                                        │               │
│  └──────────┘                                        │               │
└──────────────────────────────────────────────────────────────────┘
```

##### 2.5.10.2 各平台字段映射

| 鲁班 UserContext 字段 | 钉钉 (DingTalk) | 飞书 (Feishu) | 企业微信 (WeCom) | LDAP | OIDC |
|----------------------|-----------------|---------------|-----------------|------|------|
| `id` | `userid` | `open_id` | `userid` | `uid` / `sAMAccountName` | `sub` |
| `name` | `name` | `name` | `name` | `cn` / `displayName` | `name` / `preferred_username` |
| `avatar` | `avatar` | `avatar_url` / `avatar_thumb` | `avatar` | — | `picture` |
| `email` | `email`（可能为空） | `email` | `email`（可能为空） | `mail` | `email` |
| `mobile` | `mobile` | `mobile`（需 `contact:mobile` 权限） | `mobile` | `mobile` / `telephoneNumber` | `phone_number` |
| `employeeNo` | — | `employee_no`（需 `contact:employee_no` 权限） | — | `employeeNumber` | `employee_number` |
| `position` | `title` | `job_title` | `position` | `title` | `job_title` |
| `departmentId` | `department`（数组，取第一个） | `department_ids`（数组，取第一个） | `department`（数组，取第一个） | `departmentNumber` | `department_id` |
| `departmentName` | 需额外 API 查询 | 需额外 API 查询 | `main_department` 再查名称 | 需组织架构树拼接 | `department_name` |
| `departmentPath` | `department` 所有 ID 拼接 | `department_ids` 所有 ID 拼接 | 可通过 `department` + 递归查询拼接 | 从 DN 解析 | — |
| `leaderId` | 需 `contact:leader` 权限 | 需 `contact:leader` 权限 | `direct_leader.userid` | `manager` DN | `manager_id` |
| `leaderName` | 需 `contact:leader` 权限 | 需 `contact:leader` 权限 | `direct_leader.name` | `manager` CN | `manager_name` |
| `hireDate` | — | — | — | `hireDate`（自定义属性） | `hire_date` |
| `roles` | 需从钉钉角色 API 获取 | 需从飞书用户组 API 获取 | 需从企微标签 API 获取 | `memberOf` 组映射 | `groups` / `roles` |

##### 2.5.10.3 平台缺失字段的降级策略

当某字段在平台不可用时，遵循以下降级规则：

| 降级级别 | 策略 | 示例 |
|---------|------|------|
| **L1: 返回空值** | 返回 `""`（字符串）或 `null`（对象），`autoFill` 不填入 | 钉钉无 `employeeNo` → `""` |
| **L2: 返回默认值** | 返回平台预设的默认值 | 部门名称取"未分配部门" |
| **L3: 返回空 + 标记** | 返回空值，同时设置字段 `overwritable: true` 让用户手动填写 | 工号字段在钉钉平台允许手动输入 |
| **L4: 隐藏字段** | 如果字段无值且不可手动填写，平台自动隐藏该字段 | 入职日期字段在钉钉平台自动隐藏 |

**Agent 生成 Schema 时的最佳实践**：

```json
// 方式一：声明式降级（推荐）
// 在 autoFill 中配置 fallback，平台自动处理
{
  "key": "employee_no",
  "type": "text",
  "label": "工号",
  "autoFill": {
    "source": "current_user",
    "sourceKey": "employeeNo",
    "overwritable": true,
    "fallback": "manual"  // 平台无此字段时，允许用户手动填写
  }
}

// 方式二：Agent 在 JS 中主动检测
// Agent 代码中通过 getUserContext() 检测字段是否存在
var user = window.__LUBAN_WORKFLOW__.getUserContext();
if (!user.employeeNo) {
  // 工号不存在，显示手动输入框
  document.querySelector('[data-field="employee_no"]').classList.add('manual-input');
}
```

##### 2.5.10.4 平台特有字段的访问

不同平台可能提供鲁班标准 `UserContext` 之外的字段，Agent 可通过 `UserContext.raw` 访问：

```javascript
var user = window.__LUBAN_WORKFLOW__.getUserContext();

// 钉钉特有：获取用户的企业信息
if (user.provider === 'dingtalk') {
  var corpId = user.raw.corpId;       // 钉钉企业 ID
  var isAdmin = user.raw.isAdmin;     // 是否企业管理员
}

// 飞书特有：获取用户的国际化设置
if (user.provider === 'feishu') {
  var locale = user.raw.locale;       // 语言偏好（zh_cn / en_us）
  var isApplicationAdmin = user.raw.is_tenant_manager;
}

// 企业微信特有：获取用户的外部联系人标识
if (user.provider === 'wecom') {
  var externalPosition = user.raw.external_position;
  var gender = user.raw.gender;       // 1=男, 2=女
}
```

**Agent 在生成表单时**，可以基于 `provider` 做平台差异化处理：

```javascript
// 根据平台决定是否显示某些字段
var user = window.__LUBAN_WORKFLOW__.getUserContext();
if (user.provider === 'ldap') {
  // LDAP 用户通常有工号，显示工号字段
  document.querySelector('[data-field="employee_no"]').style.display = 'block';
} else {
  // 钉钉/飞书用户可能没有工号，隐藏
  document.querySelector('[data-field="employee_no"]').style.display = 'none';
}
```

##### 2.5.10.5 身份认证流程

```
用户访问鲁班
    │
    ↓
鲁班检测：是否有有效的 JWT Session？
    │
    ├── 有 → 解析 JWT，提取 UserContext → 渲染页面
    │
    └── 无 → 跳转到身份提供商登录页
              │
              ├── 钉钉：钉钉扫码 / 钉钉内免登
              ├── 飞书：飞书 OAuth 2.0 授权
              ├── 企业微信：企微 OAuth 2.0 授权
              ├── LDAP：用户名密码表单
              └── OIDC：通用 OIDC 流程
              │
              ↓
         身份提供商返回用户身份
              │
              ↓
         鲁班 IdentityProvider 适配器：
         1. 解析平台返回的用户信息
         2. 映射为 UserContext 标准格式
         3. 生成 JWT（包含 UserContext）
         4. 存入 Session / Cookie
              │
              ↓
         渲染页面，autoFill 可用
```

##### 2.5.10.6 身份配置（管理员视角）

管理员在鲁班系统设置中配置身份提供商：

```
系统设置 → 身份认证 → 选择提供商

┌─ 钉钉 ─────────────────────────────────────┐
│  AppKey:        [                    ]      │
│  AppSecret:     [                    ]      │
│  CorpId:        [                    ]      │
│  AgentId:       [                    ]      │
│  ┌ 权限范围 ──────────────────────────┐     │
│  │ ☑ 通讯录读取（必须）               │     │
│  │ ☑ 手机号（可选）                   │     │
│  │ ☑ 邮箱（可选）                     │     │
│  │ ☑ 部门信息（可选）                 │     │
│  │ ☐ 智能人事（可选，需额外授权）      │     │
│  └────────────────────────────────────┘     │
│  同步周期:  [每 30 分钟 ▼]                   │
│  [测试连接]  [保存]                          │
└─────────────────────────────────────────────┘
```

**配置项说明**：

| 配置项 | 说明 |
|--------|------|
| **平台凭证** | AppKey/AppSecret/CorpId 等，由平台管理员在钉钉/飞书/企微后台获取 |
| **权限范围** | 勾选需要从平台获取的用户字段，未勾选的字段在 UserContext 中返回空 |
| **同步周期** | 组织架构和人员信息的定时同步间隔（默认 30 分钟，可设为 0 关闭定时同步） |
| **测试连接** | 验证凭证是否有效，能否成功获取用户信息 |

##### 2.5.10.7 多平台共存

一个鲁班实例可能同时对接多个身份提供商（如总部用 LDAP，子公司用钉钉）：

```
应用 A → 钉钉
应用 B → 飞书
应用 C → 企业微信 + LDAP（混合模式）
```

- 每个**应用**绑定一个身份提供商
- 应用创建时选择身份提供商，后续不可更改
- 同一企业的不同部门如果使用不同平台，应创建不同应用
- 混合模式（如企微 + LDAP）用于部分人员用 LDAP 认证、部分用企微认证的场景

### 2.6 字段级权限的运行时渲染

平台在渲染表单时，根据当前节点配置的字段权限，自动为每个 `.form-field` 元素添加对应的状态类：

| 权限级别 | 添加的 CSS 类 | 效果 |
|---------|-------------|------|
| 可见可编辑 | （无额外类） | 正常显示，可编辑 |
| 可见只读 | `.readonly` | 控件加 `disabled`，背景变灰，无法修改 |
| 隐藏 | `.hidden` | `display: none`，完全不可见 |
| 脱敏 | `.masked` | 文本显示为圆点（`-webkit-text-security: disc`），但实际值不变 |

**Agent 代码中无需处理权限逻辑**，只需确保：
- 每个字段使用 `data-field` 属性标记
- CSS 中定义 `.readonly`、`.hidden`、`.masked` 类的样式
- 平台会自动在渲染前根据节点配置应用对应的类

### 2.7 AI 驱动表单代码生成

#### 2.7.1 对话式生成

用户通过 AI Agent 对话面板描述需求，Agent 自动生成完整的表单代码 + Schema：

```
用户：@工作流设计 我要设计一个报销申请表单，需要包含：报销类型（差旅/办公/其他）、
      报销金额、费用明细表（日期、项目、金额、备注）、发票附件上传

工作流设计智能体：
  好的，我来生成报销申请表单。
  
  1. 分析字段需求 → 生成字段 Schema
  2. 识别自动带入字段：
     - 申请人 → 自动带入当前用户姓名（不可修改）
     - 部门 → 自动带入当前用户部门（不可修改）
     - 申请日期 → 默认今天（可修改）
  3. 生成 HTML 代码（含 data-field 属性标记）
  4. 生成 CSS 代码（PC + 移动端响应式，含自动带入态样式）
  5. 生成 JS 代码（校验、联动、明细表操作）
  6. 保存表单并打开预览
  
  [表单已生成，右侧预览面板可见]
  
  字段清单：
  - applicant_name：申请人（自动带入，不可修改，蓝底标识）
  - department：部门（自动带入，不可修改，蓝底标识）
  - apply_date：申请日期（默认今天，可修改）
  - expense_type：报销类型（下拉选择）
  - expense_amount：报销金额（数字，自动等于明细表金额合计）
  - expense_details：费用明细表（日期、项目、金额、备注）
  - invoice_file：发票附件（限制图片/PDF，最大 10MB）
  - other_reason：其他费用说明（选择"其他"时显示）
  
  是否需要调整？比如修改字段顺序、增加字段、调整校验规则或自动带入方式？
```

#### 2.7.2 Agent 生成表单的完整流程

```
1. 需求分析
   ├── 识别字段列表、字段类型、字段关系
   ├── 识别校验规则（必填、范围、格式）
   ├── 识别联动逻辑（条件显示、计算字段）
   └── 识别自动带入字段（“申请人=当前用户”、“申请日期=今天”等）

2. 生成字段 Schema（JSON）
   └── 调用 create_form({ name, fields: [...] })
   └── 自动带入字段配置 autoFill（source、sourceKey、overwritable等）

3. 生成 HTML 代码
   ├── 每个字段对应一个 <div class="form-field" data-field="key">
   ├── 控件类型与 Schema type 匹配
   ├── 静态选项直接写入 <option> 标签
   └── 动态选项标记 queryBinding，由平台渲染时注入

4. 生成 CSS 代码
   ├── 使用 :root 变量（与现有 designSpec 一致）
   ├── 表单控件统一样式（高度 40px，圆角 8px）
   ├── 移动端 @media (max-width: 768px) 适配
   └── 只读态、隐藏态、脱敏态、错误态、自动带入态样式

5. 生成 JS 代码
   ├── 条件显示逻辑（监听 change 事件）
   ├── 明细表增删行操作
   ├── 计算字段更新逻辑
   ├── submitForm() / saveDraft() 函数
   └── 校验函数（调用平台 validateField）
   └── 注意：自动带入由平台 autoFill() 处理，Agent 无需写带入代码

6. 保存并预览
   ├── 调用 update_code_page 保存 HTML/CSS/JS
   ├── 调用 update_form_schema 保存字段 Schema
   └── 调用 preview_form 打开预览面板
```

#### 2.7.3 智能纠错与优化

- Agent 识别歧义并主动追问（如"'审批人'是指部门负责人还是指定人员？在表单中是否需要'审批人'字段？"）
- 自动推测字段校验规则（如报销金额自动设为必填且 > 0，附件限制图片和 PDF 格式）
- 根据业务场景推荐字段（如"差旅报销"自动推荐添加"出发地""目的地""出行日期"，并提示是否需要"出差申请单号"关联字段）
- 生成后自动提示潜在问题（如"费用明细表没有限制最大行数，是否需要添加？"）

#### 2.7.4 表单模板库

- Agent 可从内置模板库中匹配最佳模板作为起点，模板包含完整的 HTML/CSS/JS 代码 + Schema
- 支持用户将现有表单保存为模板，供后续复用
- 模板分类：请假类、报销类、采购类、合同类、人事类、通用审批类

### 2.8 Excel 上传与解析入库

企业级表单中，常见"上传 Excel 批量导入数据"场景：用户上传一份 Excel 文件，系统解析后以表格形式展示在表单中，用户可核对、编辑后提交，数据随表单一起入库。

#### 2.8.1 典型场景

| 场景 | 说明 | 示例 |
|------|------|------|
| **采购申请** | 上传采购清单 Excel，解析后展示明细 | 物料名称、规格、数量、单价、供应商 |
| **报销申请** | 上传费用明细 Excel，解析后自动计算合计 | 日期、费用类型、金额、备注 |
| **人员批量入职** | 上传新员工名单 Excel，解析后展示人员信息 | 姓名、部门、职位、入职日期、薪资 |
| **库存盘点** | 上传盘点清单 Excel，解析后逐行展示 | SKU、名称、账面数量、实盘数量、差异 |
| **合同批量审批** | 上传合同清单 Excel，解析后逐条审批 | 合同编号、对方单位、金额、到期日期 |

#### 2.8.2 Schema 配置

```typescript
interface ExcelFieldConfig {
  // 期望的列定义
  columns: ExcelColumn[];
  
  // 上传配置
  maxFileSize?: number;          // 最大文件大小（MB），默认 10
  acceptSheets?: string[];       // 允许读取的工作表名（默认读取第一个工作表）
  skipHeaderRow?: number;        // 跳过前 N 行（默认 1，即跳过表头行）
  minRows?: number;              // 最少数据行数
  maxRows?: number;              // 最多数据行数（默认 5000）
  
  // 解析配置
  columnMapping?: 'auto' | 'by_header' | 'by_order';
  // auto: 自动匹配（根据列名模糊匹配）
  // by_header: 严格按表头匹配（表头名必须与 columns[n].label 一致）
  // by_order: 按列顺序匹配（第1列对应 columns[0]，第2列对应 columns[1]...）
  
  // 校验配置
  stopOnFirstError?: boolean;    // 遇错即停（默认 false，收集所有错误后统一展示）
  allowEmptyRows?: boolean;      // 是否允许空行（默认 false，自动跳过空行）
  
  // 数据存储
  storeAs?: 'json' | 'detail_table';  
  // json: 解析后以 JSON 数组存入表单数据（适合简单列表）
  // detail_table: 解析后转换为明细表格式（适合需要与明细表字段联动的场景）
}

interface ExcelColumn {
  key: string;                   // 列唯一标识（存入数据时的 key）
  label: string;                 // 列显示名称（表头）
  type: 'text' | 'number' | 'amount' | 'date' | 'select';  // 列数据类型
  required?: boolean;            // 是否必填
  aliases?: string[];            // 列名别名（用于自动匹配，如 ["姓名", "名字", "员工姓名"]）
  validation?: {                 // 列级校验
    min?: number;
    max?: number;
    pattern?: string;
    patternMessage?: string;
  };
  options?: { label: string; value: string }[];  // 下拉选项（type=select 时）
  defaultValue?: unknown;        // 默认值（解析后该列为空时填充）
  format?: string;               // 日期格式（type=date 时，如 "yyyy-MM-dd"）
  editable?: boolean;            // 预览表格中是否可编辑（默认 true）
}
```

**完整 Schema 示例**：

```json
{
  "key": "purchase_list",
  "type": "excel",
  "label": "采购清单",
  "required": true,
  "excelConfig": {
    "columns": [
      {
        "key": "material_name",
        "label": "物料名称",
        "type": "text",
        "required": true,
        "aliases": ["物料", "名称", "物品名称", "材料名称"]
      },
      {
        "key": "specification",
        "label": "规格型号",
        "type": "text",
        "aliases": ["规格", "型号"]
      },
      {
        "key": "quantity",
        "label": "数量",
        "type": "number",
        "required": true,
        "aliases": ["采购数量", "申购数量"],
        "validation": { "min": 1 }
      },
      {
        "key": "unit_price",
        "label": "单价",
        "type": "amount",
        "aliases": ["单价(元)", "价格"],
        "validation": { "min": 0 }
      },
      {
        "key": "total_price",
        "label": "金额",
        "type": "amount",
        "editable": false,
        "aliases": ["总价", "合计金额"]
      },
      {
        "key": "supplier",
        "label": "供应商",
        "type": "text",
        "aliases": ["供货商", "厂家"]
      }
    ],
    "maxFileSize": 20,
    "minRows": 1,
    "maxRows": 500,
    "columnMapping": "auto",
    "stopOnFirstError": false
  }
}
```

#### 2.8.3 上传交互规范

**HTML 结构**（Agent 生成）：

```html
<!-- Excel 上传字段 -->
<div class="form-field" data-field="purchase_list">
  <label class="form-label">
    采购清单 <span class="required-mark">*</span>
  </label>
  
  <!-- 上传区域：拖拽 + 点击 -->
  <div class="excel-upload-area" id="upload_purchase_list">
    <div class="excel-upload-placeholder">
      <svg class="excel-upload-icon">...</svg>
      <span class="excel-upload-text">将 Excel 文件拖拽到此处，或</span>
      <label class="excel-upload-btn">
        <span>点击上传</span>
        <input type="file" 
               accept=".xlsx,.xls,.csv" 
               hidden
               onchange="handleExcelUpload(event, 'purchase_list')">
      </label>
      <span class="excel-upload-hint">支持 .xlsx / .xls / .csv 格式，最大 20MB</span>
    </div>
  </div>
  
  <!-- 解析状态提示 -->
  <div class="excel-upload-status" id="status_purchase_list" style="display:none;"></div>
  
  <!-- 解析错误列表 -->
  <div class="excel-errors" id="errors_purchase_list" style="display:none;"></div>
  
  <!-- 预览表格（解析后展示） -->
  <div class="excel-preview" id="preview_purchase_list" style="display:none;">
    <div class="excel-preview-header">
      <span class="excel-preview-title">已解析 <strong id="count_purchase_list">0</strong> 行数据</span>
      <button type="button" class="excel-action-btn" onclick="downloadTemplate('purchase_list')">
        下载模板
      </button>
      <button type="button" class="excel-action-btn" onclick="reuploadExcel('purchase_list')">
        重新上传
      </button>
    </div>
    <div class="excel-preview-table-wrapper">
      <table class="excel-preview-table" id="table_purchase_list">
        <thead></thead>
        <tbody></tbody>
      </table>
    </div>
  </div>
  
  <span class="field-error"></span>
</div>
```

**交互流程**：

```
用户操作                          平台行为
─────────                        ────────
拖拽/选择文件
    │
    ↓
上传到服务器                       文件格式校验（.xlsx/.xls/.csv）
    │                             文件大小校验（≤ maxFileSize）
    ↓
服务器解析 Excel                   读取工作表（按 acceptSheets 或默认第一个）
    │                             跳过 skipHeaderRow 行
    │                             逐行解析，按 columnMapping 策略匹配列
    │
    ↓
返回解析结果                       每条数据包含：行号、字段值、校验状态
    │
    ↓
前端渲染预览表格                   正确行：绿色行号标记 ✓
    │                             警告行：黄色行号标记 ⚠（如字段为空但非必填）
    │                             错误行：红色行号标记 ✗，行尾显示错误详情
    ↓
用户核对/编辑                      可编辑列（editable=true）允许双击修改
    │                             可删除单行
    │                             可下载模板重新填写
    ↓
提交表单                          解析数据作为字段值随表单提交
                                  存储格式取决于 storeAs 配置
```

**CSS 样式要点**：

```css
/* 上传区域 */
.excel-upload-area {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 32px 20px;
  text-align: center;
  background: #FAFBFC;
  transition: border-color 0.2s, background 0.2s;
  cursor: pointer;
}
.excel-upload-area:hover,
.excel-upload-area.drag-over {
  border-color: var(--color-primary);
  background: #EFF6FF;
}

/* 上传按钮 */
.excel-upload-btn {
  display: inline-block;
  padding: 8px 20px;
  background: var(--color-primary);
  color: #fff;
  border-radius: 6px;
  cursor: pointer;
  margin: 0 4px;
}

/* 解析状态 */
.excel-upload-status.parsing {
  padding: 12px;
  background: #EFF6FF;
  border-radius: var(--radius);
  color: var(--color-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.excel-upload-status.success {
  background: #ECFDF5;
  color: var(--color-success);
}
.excel-upload-status.error {
  background: #FEF2F2;
  color: var(--color-danger);
}

/* 预览表格 */
.excel-preview {
  margin-top: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.excel-preview-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #F8FAFC;
  border-bottom: 1px solid var(--color-border);
  gap: 12px;
}
.excel-preview-table-wrapper {
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
}
.excel-preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.excel-preview-table th {
  background: #F1F5F9;
  padding: 8px 12px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 1;
}
.excel-preview-table td {
  padding: 6px 12px;
  border-bottom: 1px solid #F1F5F9;
}
.excel-preview-table tr.row-error td {
  background: #FEF2F2;
}
.excel-preview-table tr.row-warning td {
  background: #FFFBEB;
}
.excel-preview-table .row-number {
  width: 40px;
  color: var(--color-text-secondary);
  font-size: 12px;
  text-align: center;
}
.excel-preview-table td.editable {
  cursor: pointer;
  border-bottom: 1px dashed var(--color-primary);
}
.excel-preview-table td.editable:hover {
  background: #EFF6FF;
}
.excel-preview-table td.editing {
  padding: 0;
}
.excel-preview-table td.editing input {
  width: 100%;
  height: 32px;
  border: 2px solid var(--color-primary);
  border-radius: 4px;
  padding: 0 8px;
  font-size: 13px;
}

/* 错误列表 */
.excel-errors {
  margin-top: 8px;
  padding: 12px;
  background: #FEF2F2;
  border: 1px solid #FECACA;
  border-radius: var(--radius);
  font-size: 13px;
}
.excel-errors .error-item {
  padding: 4px 0;
  color: var(--color-danger);
}
.excel-errors .error-item:before {
  content: "✗ ";
}

/* 移动端适配 */
@media (max-width: 768px) {
  .excel-preview-table-wrapper {
    max-height: 300px;
    -webkit-overflow-scrolling: touch;
  }
  .excel-upload-area {
    padding: 24px 16px;
  }
  .excel-preview-header {
    flex-wrap: wrap;
  }
}
```

#### 2.8.4 解析规则

##### 2.8.4.1 列匹配策略

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| **auto（自动匹配）** | 遍历 Excel 表头，对每个 Schema 列使用 `label` + `aliases` 进行模糊匹配（忽略大小写、空格、特殊符号） | 用户可能使用不同模板，推荐作为默认策略 |
| **by_header（表头匹配）** | Excel 表头必须与 `columns[n].label` 完全一致（区分大小写和空格） | 用户使用平台提供的固定模板 |
| **by_order（顺序匹配）** | 忽略表头，按列顺序映射：第1列→columns[0]，第2列→columns[1] | 无表头的 Excel 或固定格式的 CSV |

**自动匹配算法**：

```
1. 读取 Excel 表头行 → headerCells = ["物料名称", "规格", "数量", "单价(元)", "金额", ...]
2. 对每个 Schema 列：
   a. 构建候选名列表：[label, ...aliases]
   b. 标准化：去除空格、转小写、去除特殊字符
   c. 在 headerCells 中查找匹配（同样标准化后比较）
   d. 匹配成功 → 记录列索引
   e. 匹配失败 → 标记为"未匹配列"
3. 收集所有"未匹配列" → 在解析结果中返回警告
4. 收集 Excel 中未被匹配的列 → 在解析结果中返回提示（"列'备注'未在 Schema 中定义，已忽略"）
```

##### 2.8.4.2 数据转换

| 列类型 | 解析规则 | 示例 |
|--------|---------|------|
| `text` | 直接取字符串值，trim 去除首尾空格 | `" 张三 "` → `"张三"` |
| `number` | 解析为数字，非数字返回 null | `"10"` → `10`，`"abc"` → `null`（标记错误） |
| `amount` | 解析为数字，支持千分位和货币符号 | `"¥1,234.56"` → `1234.56` |
| `date` | 解析为 ISO 日期字符串，按 `format` 转换 | `"2026-08-12"` → `"2026-08-12"`，Excel 日期序列号自动转换 |
| `select` | 匹配 `options` 中的 `label` 或 `value` | `"办公用品"` → 匹配 `{ label: "办公用品", value: "office" }` → `"office"` |

##### 2.8.4.3 特殊值处理

| 情况 | 处理方式 |
|------|---------|
| 空单元格 | 如果列 `required=true` → 标记错误；否则 → 填充 `defaultValue` 或 `null` |
| 合并单元格 | 取合并区域左上角的值，其余单元格复用该值 |
| Excel 公式 | 尝试计算公式并取值，取不到则保留公式文本 |
| 日期序列号 | Excel 存储的日期序列号（如 `45000`）自动转换为日期字符串 |
| 换行符 | 单元格内换行符替换为空格 |
| 前后空格 | 自动 trim |
| 纯数字文本 | 如身份证号（`"320102199001011234"`），Excel 可能显示为科学计数法，需提示用户将列格式设为"文本"后重新上传 |

#### 2.8.5 预览展示与编辑

##### 2.8.5.1 行状态标记

| 行状态 | 行号颜色 | 行背景 | 说明 |
|--------|---------|--------|------|
| **正确** | 绿色 `#10B981` | 无 | 所有字段校验通过 |
| **警告** | 黄色 `#F59E0B` | 淡黄 `#FFFBEB` | 部分字段为空但非必填，或数值超出合理范围 |
| **错误** | 红色 `#EF4444` | 淡红 `#FEF2F2` | 必填字段为空、类型转换失败、校验不通过 |

##### 2.8.5.2 编辑交互

- **双击单元格**进入编辑模式（仅 `editable=true` 的列）
- 编辑时实时校验：类型错误即时标红、必填为空即时提示
- 编辑完成后自动重新计算该行状态
- **行操作**：每行末尾提供"删除"按钮（`×`），删除后从预览表格移除
- **批量操作**：提供"删除所有错误行"快捷按钮

##### 2.8.5.3 错误信息展示

错误分两级展示：

```
┌─────────────────────────────────────────────────┐
│ ⚠ 解析完成，共 50 行数据，其中 3 行存在错误      │
│                                                 │
│ ┌─ 错误详情 ─────────────────────────────────┐  │
│ │ ✗ 第 3 行：物料名称不能为空                  │  │
│ │ ✗ 第 12 行：数量格式错误（"abc" 不是有效数字） │  │
│ │ ✗ 第 28 行：单价不能为负数（-50）            │  │
│ │ ⚠ 第 7 行：规格型号为空（非必填，已忽略）    │  │
│ │ ℹ 列"备注"未在 Schema 中定义，已忽略          │  │
│ └──────────────────────────────────────────────┘  │
│                                                 │
│ [预览表格]                                      │
│ [删除所有错误行] [下载模板] [重新上传]            │
└─────────────────────────────────────────────────┘
```

#### 2.8.6 数据存储

> **核心问题**：不同表单的 Excel 字段列结构完全不同（采购清单有 6 列、报销明细有 5 列、人员名单有 8 列），且需要支持跨实例查询（如"查询所有采购申请中物料名称为 A4 纸的申请"）。如果全部塞入 `form_data` JSON 字段，无法建索引、无法高效查询、且 JSON 体积过大。

##### 2.8.6.1 存储架构

采用**三层存储**：摘要 → 行数据 → 原始文件

```
┌─────────────────────────────────────────────────────────────────┐
│                    Excel 数据三层存储架构                          │
│                                                                 │
│  Layer 1: form_data（摘要）                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 存储位置：workflow_instances.form_data（JSON）             │   │
│  │ 内容：仅存摘要                                              │   │
│  │   { "_excel_purchase_list": {                             │   │
│  │       "importId": 128,                                    │   │
│  │       "fileName": "采购清单.xlsx",                          │   │
│  │       "totalRows": 50,                                    │   │
│  │       "validRows": 48,                                    │   │
│  │       "errorRows": 2                                      │   │
│  │   }}                                                      │   │
│  │ 用途：流程列表页快速展示（无需加载全部行数据）                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│           │ importId = 128                                      │
│           ↓                                                     │
│  Layer 2: excel_import_rows（行数据）                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 存储位置：excel_imports + excel_import_rows（独立表）       │   │
│  │ 内容：每一行的完整数据 + 列Schema快照                        │   │
│  │ excel_imports: { id=128, column_schema=[...], ... }       │   │
│  │ excel_import_rows:                                        │   │
│  │   { import_id=128, row=1, data="{material_name:..., ...}" }│   │
│  │   { import_id=128, row=2, data="{material_name:..., ...}" }│   │
│  │   ...                                                      │   │
│  │ 用途：详情页展示、跨实例查询、报表导出                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│           │ file_path = "/attachments/2026/08/xxx.xlsx"         │
│           ↓                                                     │
│  Layer 3: 原始文件（附件）                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 存储位置：文件系统 / OSS                                    │   │
│  │ 内容：用户上传的原始 Excel 文件                              │   │
│  │ 用途：审计追溯、重新解析、下载查看                            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

##### 2.8.6.2 数据库表设计

**`excel_imports` — Excel 导入记录表**（每个 Excel 字段的上传，一条记录）：

```sql
CREATE TABLE excel_imports (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  
  -- 关联信息
  instance_id     BIGINT,                    -- 关联的流程实例 ID（提交后才有值，编辑中为 NULL）
  form_id         BIGINT NOT NULL,           -- 关联的表单 ID
  field_key       VARCHAR(128) NOT NULL,      -- 表单中的字段 key（如 "purchase_list"）
  
  -- 文件信息
  file_name       VARCHAR(512) NOT NULL,      -- 原始文件名
  file_size       BIGINT,                     -- 文件大小（字节）
  file_path       VARCHAR(1024),              -- 原始文件存储路径/OSS key（可空，不保留原始文件时）
  
  -- 统计信息
  total_rows      INT NOT NULL DEFAULT 0,     -- 总行数
  valid_rows      INT NOT NULL DEFAULT 0,     -- 有效行数
  warning_rows    INT NOT NULL DEFAULT 0,     -- 警告行数
  error_rows      INT NOT NULL DEFAULT 0,     -- 错误行数
  
  -- 列定义快照（解析时的 columns 配置）
  -- 不同表单的 Excel 列结构完全不同，存储快照用于后续查询时了解列结构
  column_schema   JSON NOT NULL,              -- [{ "key":"material_name", "label":"物料名称", "type":"text" }, ...]
  
  -- 状态
  status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT',  -- DRAFT（编辑中）/ SUBMITTED（已提交）
  
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_instance (instance_id),
  INDEX idx_form_field (form_id, field_key)
);
```

**`excel_import_rows` — Excel 行数据表**（每行一条记录，列结构不同时通过 `data` JSON 存储）：

```sql
CREATE TABLE excel_import_rows (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  import_id       BIGINT NOT NULL,            -- 关联 excel_imports.id
  row_number      INT NOT NULL,               -- 行号（对应 Excel 中的行号）
  
  -- 行数据：JSON 格式，key 为列名，value 为解析后的值
  -- 不同表单的列结构完全不同，JSON 天然适配异构数据
  data            JSON NOT NULL,              -- {"material_name":"A4纸","quantity":100,"unit_price":25,...}
  
  -- 行状态
  status          VARCHAR(20) NOT NULL DEFAULT 'OK',  -- OK / WARNING / ERROR
  
  -- 校验信息
  errors          JSON,                       -- [{"column":"material_name","message":"物料名称不能为空"}]
  
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_import (import_id),
  INDEX idx_import_status (import_id, status)
);
```

##### 2.8.6.3 为什么用 JSON 而不是宽表？

| 方案 | 优点 | 缺点 |
|------|------|------|
| **宽表（每列一个字段）** | 强类型约束、索引友好 | 每种表单的 Excel 需要不同的表结构，无法通用；新增列需要 ALTER TABLE |
| **EAV（实体-属性-值）** | 列灵活 | 查询复杂（需多次 JOIN）、性能差、类型丢失 |
| **JSON 列（本方案）** | 列结构完全灵活、一套表适配所有表单、支持 MySQL 8.0+ JSON 函数查询 | 无强类型约束、索引需用虚拟列或 JSON 索引 |

**选择 JSON 的理由**：Excel 字段的列结构完全由用户定义，无法预知，JSON 是最灵活的方案。MySQL 8.0+ 支持 JSON 虚拟列索引，可对常用查询字段建索引。

##### 2.8.6.4 查询方案

**查询 1：按流程实例查看所有 Excel 数据**（审批页展示）

```sql
-- 第一步：查摘要
SELECT * FROM excel_imports WHERE instance_id = 128;

-- 第二步：查行数据
SELECT * FROM excel_import_rows WHERE import_id = 128 ORDER BY row_number;
```

**查询 2：跨实例查询特定值**（如"查询所有采购申请中物料名称为 A4 纸的申请"）

```sql
-- 利用 MySQL 8.0+ JSON 函数
SELECT DISTINCT ei.instance_id
FROM excel_import_rows eir
JOIN excel_imports ei ON ei.id = eir.import_id
WHERE ei.form_id = 5
  AND ei.field_key = 'purchase_list'
  AND JSON_UNQUOTE(JSON_EXTRACT(eir.data, '$.material_name')) = 'A4纸';
```

**查询 3：汇总统计**（如"本月采购总额"）

```sql
SELECT SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(eir.data, '$.total_price')) AS DECIMAL(12,2)))
FROM excel_import_rows eir
JOIN excel_imports ei ON ei.id = eir.import_id
WHERE ei.form_id = 5
  AND ei.field_key = 'purchase_list'
  AND ei.created_at >= '2026-08-01'
  AND eir.status = 'OK';
```

**查询 4：高频查询字段的索引优化**

对于经常被查询的列，通过虚拟列 + 索引加速：

```sql
-- 为采购清单的 material_name 创建虚拟列索引
ALTER TABLE excel_import_rows 
  ADD COLUMN material_name_virtual VARCHAR(255) 
    GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$.material_name'))) VIRTUAL,
  ADD INDEX idx_material_name (material_name_virtual);

-- 为金额类字段创建虚拟列索引
ALTER TABLE excel_import_rows
  ADD COLUMN total_price_virtual DECIMAL(12,2)
    GENERATED ALWAYS AS (CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.total_price')) AS DECIMAL(12,2))) VIRTUAL,
  ADD INDEX idx_total_price (total_price_virtual);
```

> **注意**：虚拟列索引不是自动创建的。管理员或 Agent 在表单发布时，根据 `excelConfig.columns` 中标记为"常用查询"的列，自动生成虚拟列索引。这是可选的高级功能，不影响基础查询。

##### 2.8.6.5 存储生命周期

```
编辑阶段                      提交后                      归档后
─────────                    ───────                    ──────
用户上传 Excel               用户提交表单                流程结束
    │                            │                         │
    ↓                            ↓                         ↓
解析 → 前端预览            后端创建 excel_imports        数据保留
    │                      status = 'SUBMITTED'         按保留策略清理
    ↓                      instance_id 赋值              原始文件（可选）
每行数据暂存前端                  │                         │
不落库（或存临时表）              ↓                         ↓
                           excel_import_rows          超过保留期后
                           批量 INSERT                 物理删除
                                │
                                ↓
                           form_data 写入摘要
                           （importId + 文件名 + 行数）
```

**关键设计决策**：

| 决策 | 说明 |
|------|------|
| **编辑阶段不落库** | 用户上传 Excel 后到提交前，解析数据仅在前端内存中，不创建数据库记录。减少脏数据 |
| **提交时原子写入** | 表单提交时，在一个事务中：创建 `excel_imports` → 批量 INSERT `excel_import_rows` → 更新 `workflow_instances.form_data` 摘要 |
| **instance_id 后赋值** | 编辑阶段 `instance_id` 为 NULL，提交后才有值。一个 Excel 在提交前可能被多次上传覆盖 |
| **原始文件保留策略** | 默认保留原始 Excel 文件用于审计；可配置"提交后删除原始文件"以节省存储空间 |
| **数据保留期** | 流程实例归档后，Excel 行数据默认保留 3 年，到期后自动清理（可配置） |

##### 2.8.6.6 form_data 中的存储格式

表单提交后，`form_data` 中不存储完整 Excel 数据，只存摘要引用：

```json
{
  // ===== 普通字段 =====
  "applicant_name": "张三",
  "department": "研发部",
  "total_amount": 7500,
  
  // ===== Excel 字段：只存摘要，不存行数据 =====
  "_excel_purchase_list": {
    "importId": 128,
    "fileName": "采购清单_2026年8月.xlsx",
    "totalRows": 50,
    "validRows": 48,
    "errorRows": 2,
    "uploadedAt": "2026-08-12T14:30:00"
  },
  
  // ===== 另一个 Excel 字段 =====
  "_excel_supplier_quotes": {
    "importId": 129,
    "fileName": "供应商报价.xlsx",
    "totalRows": 3,
    "validRows": 3,
    "errorRows": 0,
    "uploadedAt": "2026-08-12T14:35:00"
  }
}
```

**规则**：
- Excel 字段的 key 前加 `_excel_` 前缀存入 `form_data`，避免与普通字段 key 冲突
- 值只包含摘要信息，通过 `importId` 关联 `excel_imports` 和 `excel_import_rows` 表获取完整数据
- 审批页或详情页加载时，先读 `form_data` 获取摘要，再根据 `importId` 查 `excel_import_rows` 渲染表格

##### 2.8.6.7 一个表单多个 Excel 字段

如果一个表单有多个 Excel 字段（如采购申请同时有"采购清单"和"供应商报价"两个 Excel），每个字段独立存储：

```
表单：采购申请
├── 普通字段：申请人、部门、申请日期...
├── Excel 字段：purchase_list（采购清单）
│   └── excel_imports.id = 128
│       └── excel_import_rows × 50 行
│           └── data: {"material_name":"A4纸", "quantity":100, ...}
└── Excel 字段：supplier_quotes（供应商报价）
    └── excel_imports.id = 129
        └── excel_import_rows × 3 行
            └── data: {"supplier_name":"得力文具", "quote_amount":5000, ...}
```

每个 Excel 字段在上传时独立解析，提交时创建各自的 `excel_imports` 记录，互不干扰。

##### 2.8.6.8 与 `detail_table` 的对比

| 维度 | Excel 字段 (`type: 'excel'`) | 明细表 (`type: 'detail_table'`) |
|------|---------------------------|--------------------------------|
| 数据来源 | 从 Excel 文件解析导入 | 用户在表单中逐行手动填写 |
| 列结构 | 在 Schema 中预定义 (`excelConfig.columns`) | 在 Schema 中预定义，Agent 渲染为 `<table>` |
| 存储方式 | `excel_imports` + `excel_import_rows` 独立表 | 存入 `form_data` JSON（行数通常较少） |
| 行数规模 | 可达数百至数千行 | 通常 1~20 行 |
| 查询能力 | 支持跨实例 JSON 查询 | 不支持跨实例查询（在 JSON 内） |
| 可编辑性 | 预览阶段可编辑，提交后不可编辑 | 审批阶段可编辑（受字段权限控制） |

**如何选择**：
- 数据量较大（>20 行）或来自外部文件 → 使用 `excel`
- 少量数据且用户手动填写 → 使用 `detail_table`
- 两者可以共存：Excel 解析后以 `storeAs: 'detail_table'` 模式转为明细表格式，审批人可逐行审批

#### 2.8.7 Agent 代码生成规范

Agent 在生成包含 Excel 字段的表单时，需遵循以下规则：

**HTML 生成**：
- 每个 `type: 'excel'` 的字段生成完整的 `.excel-upload-area` → `.excel-upload-status` → `.excel-errors` → `.excel-preview` 结构
- `id` 使用 `upload_{fieldKey}`、`status_{fieldKey}`、`errors_{fieldKey}`、`preview_{fieldKey}`、`table_{fieldKey}` 格式
- `input[type=file]` 的 `accept` 属性设为 `.xlsx,.xls,.csv`
- 预览表格的列头根据 `excelConfig.columns` 动态生成

**JS 生成**：
- `handleExcelUpload(event, fieldKey)` — 文件选择后触发上传和解析
- `renderExcelPreview(fieldKey, data)` — 渲染预览表格
- `editExcelCell(fieldKey, rowIndex, colKey)` — 双击进入编辑模式
- `deleteExcelRow(fieldKey, rowIndex)` — 删除单行
- `deleteAllErrorRows(fieldKey)` — 删除所有错误行
- `downloadTemplate(fieldKey)` — 根据 Schema 生成模板 Excel 并下载
- `reuploadExcel(fieldKey)` — 重新上传（清空当前数据）
- `getExcelData(fieldKey)` — 收集预览表格中的数据（供 `submitForm` 调用）

**CSS 生成**：
- 使用 2.8.3 中定义的完整 CSS 样式
- 移动端适配：表格横向滚动、上传区域缩小、按钮换行

**Schema 生成**：
- 从用户描述中提取列信息（列名、类型、是否必填）
- 自动生成 `aliases`（常见别名）
- 默认 `columnMapping: 'auto'`、`stopOnFirstError: false`

#### 2.8.8 校验与错误处理

##### 2.8.8.1 上传阶段校验

| 校验项 | 时机 | 处理 |
|--------|------|------|
| 文件格式 | 前端选择文件时 | 格式不符直接拒绝，提示"仅支持 .xlsx / .xls / .csv" |
| 文件大小 | 前端选择文件时 | 超过 `maxFileSize` 直接拒绝，提示"文件大小不能超过 XX MB" |
| 工作表存在性 | 服务端解析时 | 指定工作表不存在时返回错误 |
| 空文件 | 服务端解析时 | 无数据行时返回错误"文件中未找到有效数据" |

##### 2.8.8.2 解析阶段校验

| 校验项 | 处理 |
|--------|------|
| 列匹配失败 | 标记为"未匹配列"，警告提示，但继续解析已匹配的列 |
| 类型转换失败 | 标记该单元格为错误，行状态设为"错误" |
| 必填字段为空 | 标记该单元格为错误，行状态设为"错误" |
| 数值超出范围 | 标记该单元格为警告，行状态设为"警告" |
| 行数超限 | 超过 `maxRows` 时截断，提示"数据行数超过上限，仅保留前 N 行" |
| 行数不足 | 少于 `minRows` 时提示"数据行数不足，至少需要 N 行" |

##### 2.8.8.3 提交阶段校验

- 如果 `required=true` 且用户未上传/未解析任何数据，提交时校验失败
- 如果有错误行，提交时二次确认："仍有 N 行存在错误，是否忽略错误行提交？"（用户可选择仅提交正确行，或返回修改）

##### 2.8.8.4 下载模板

平台提供"下载模板"功能，Agent 需实现 `downloadTemplate` 函数：

- 根据 `excelConfig.columns` 生成标准 Excel 模板（含表头行、列名、示例数据行）
- 使用 SheetJS（前端）或后端 API 生成
- 模板中可包含下拉选项（type=select 的列）、数据验证规则
- 文件名格式：`{表单名称}_导入模板.xlsx`

---

## 三、工作流设计模块

### 3.1 流程设计器

#### 3.1.1 UI 设计规范（参考钉钉流程设计器风格）

> **设计目标**：参考钉钉 OA 审批流程设计器的简洁直观风格，避免传统 BPMN 设计器的复杂感。钉钉的设计理念是"让非技术人员也能轻松配置流程"，这与鲁班"AI 辅助降低使用门槛"的定位一致。

##### 3.1.1.1 整体布局：三栏式结构

```
┌──────────────────────────────────────────────────────────────────┐
│  顶部工具栏                                                       │
│  [撤销] [重做] [缩放] [自动布局] [AI 生成]  │   [保存] [发布]      │
├──────────┬───────────────────────────────────┬───────────────────┤
│          │                                   │                   │
│  左侧    │         中间画布区域               │     右侧          │
│  节点    │                                   │     属性          │
│  面板    │  ┌─────────────────────────┐      │     配置          │
│          │  │                         │      │     面板          │
│  ┌────┐  │  │    ┌───────────────┐    │      │                   │
│  │开始│  │  │    │  发起申请      │    │      │  ┌─────────────┐  │
│  └────┘  │  │    └───────┬───────┘    │      │  │ 节点名称    │  │
│          │  │            │            │      │  │ [输入框]    │  │
│  ┌────┐  │  │       ┌────┴────┐      │      │  ├─────────────┤  │
│  │审批│  │  │       │  + 添加  │      │      │  │ 审批人      │  │
│  └────┘  │  │       └────┬────┘      │      │  │ ○ 指定人员  │  │
│          │  │            │            │      │  │ ○ 指定角色  │  │
│  ┌────┐  │  │    ┌───────┴───────┐    │      │  │ ○ 部门负责人│  │
│  │条件│  │  │    │  部门经理审批  │    │      │  │ ○ 直属上级  │  │
│  │分支│  │  │    └───────┬───────┘    │      │  │ ○ 表单字段  │  │
│  └────┘  │  │            │            │      │  │ ○ 动态脚本  │  │
│          │  │       ┌────┴────┐      │      │  ├─────────────┤  │
│  ┌────┐  │  │       │  + 添加  │      │      │  │ 审批模式    │  │
│  │并行│  │  │       └────┬────┘      │      │  │ [会签 ▼]    │  │
│  │分支│  │  │            │            │      │  ├─────────────┤  │
│  └────┘  │  │    ┌───────┴───────┐    │      │  │ 驳回策略    │  │
│          │  │    │  总经理审批    │    │      │  │ [驳回至上一 │  │
│  ┌────┐  │  │    └───────┬───────┘    │      │  │  节点 ▼]    │  │
│  │抄送│  │  │            │            │      │  ├─────────────┤  │
│  └────┘  │  │       ┌────┴────┐      │      │  │ 超时设置    │  │
│          │  │       │  + 添加  │      │      │  │ [24 小时]   │  │
│  ┌────┐  │  │       └────┬────┘      │      │  ├─────────────┤  │
│  │子流│  │  │            │            │      │  │ 字段权限    │  │
│  │程  │  │  │    ┌───────┴───────┐    │      │  │ [+ 添加权限]│  │
│  └────┘  │  │    │  归档结束      │    │      │  └─────────────┘  │
│          │  │    └───────────────┘    │      │                   │
│  ┌────┐  │  │                         │      │                   │
│  │结束│  │  │                         │      │                   │
│  └────┘  │  │                         │      │                   │
│          │  │                         │      │                   │
├──────────┴───────────────────────────────────┴───────────────────┤
│  底部状态栏                                                       │
│  节点数: 5  │  已保存 12:30  │  画布缩放: 100%                    │
└──────────────────────────────────────────────────────────────────┘
```

**三栏宽度分配**：

| 面板 | 默认宽度 | 最小宽度 | 最大宽度 | 可拖拽调整 |
|------|---------|---------|---------|-----------|
| 左侧节点面板 | 200px | 180px | 280px | 否（固定） |
| 中间画布 | 自适应 | 400px | — | — |
| 右侧属性面板 | 360px | 300px | 500px | 是（拖拽左边缘） |

##### 3.1.1.2 左侧面板：节点库

**钉钉风格要点**：节点以卡片列表形式展示，每种节点有独立图标和颜色标识，支持拖拽到画布。

```
┌─────────────────┐
│  ◈ 流程节点      │  ← 分组标题
├─────────────────┤
│  ⭕ 发起人       │  ← 绿色 #10B981
│  流程的起点      │
├─────────────────┤
│  ◉ 审批人       │  ← 蓝色 #3B82F6
│  需要审批的节点   │
├─────────────────┤
│  ◇ 条件分支     │  ← 橙色 #F59E0B
│  根据条件分流     │
├─────────────────┤
│  ⬡ 并行分支     │  ← 紫色 #8B5CF6
│  同时多个分支     │
├─────────────────┤
│  ◉ 抄送人       │  ← 灰色 #64748B
│  知会相关人员     │
├─────────────────┤
│  ◈ 子流程       │  ← 青色 #06B6D4
│  嵌套其他流程     │
├─────────────────┤
│  ⬤ 结束         │  ← 红色 #EF4444
│  流程的终点      │
└─────────────────┘
```

**节点卡片样式规范**：

```css
.node-palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid #E2E8F0;
  background: #FFFFFF;
  cursor: grab;
  transition: all 0.2s;
  margin-bottom: 8px;
}
.node-palette-item:hover {
  border-color: var(--color-primary);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.15);
  transform: translateY(-1px);
}
.node-palette-item:active {
  cursor: grabbing;
  opacity: 0.8;
}
.node-palette-item .node-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}
.node-palette-item .node-label {
  font-size: 14px;
  font-weight: 500;
  color: #1E293B;
}
.node-palette-item .node-desc {
  font-size: 12px;
  color: #94A3B8;
  margin-top: 2px;
}
```

**节点颜色标识**：

| 节点类型 | 图标色 | 边框色 | 说明 |
|---------|--------|--------|------|
| 开始/发起人 | `#10B981` 绿色 | `#A7F3D0` | 起点，类似"开始"语义 |
| 审批人 | `#3B82F6` 蓝色 | `#BFDBFE` | 核心审批节点，最常用 |
| 条件分支 | `#F59E0B` 橙色 | `#FDE68A` | 分支判断，醒目的暖色 |
| 并行分支 | `#8B5CF6` 紫色 | `#DDD6FE` | 并行，区别于条件分支 |
| 抄送人 | `#64748B` 灰色 | `#CBD5E1` | 知会，非关键节点 |
| 子流程 | `#06B6D4` 青色 | `#A5F3FC` | 嵌套，特殊类型 |
| 结束 | `#EF4444` 红色 | `#FECACA` | 终点，警示色 |

##### 3.1.1.3 中间画布：流程设计区

**核心交互模式（参考钉钉）**：

1. **垂直流式布局**：默认从上到下排列节点，连线带箭头指向下方
2. **节点间 "+" 按钮**：每两个节点之间自动显示一个圆形的 "+" 按钮，点击弹出节点类型选择菜单
3. **节点卡片**：每个节点以圆角卡片形式展示，包含节点图标、名称、摘要信息
4. **选中态**：选中节点时卡片边框高亮为蓝色，右侧同步显示属性面板
5. **拖拽排序**：支持拖拽节点调整顺序（在合法范围内）
6. **画布缩放**：支持鼠标滚轮缩放（25% ~ 200%），底部状态栏显示当前缩放比例
7. **撤销/重做**：Ctrl+Z / Ctrl+Shift+Z，支持 50 步历史

**画布节点卡片样式**：

```
┌──────────────────────────────────┐
│  ◉  部门经理审批                  │  ← 节点图标 + 名称
│     审批人：张三、李四（会签）      │  ← 摘要信息（灰色小字）
│     超时：24 小时                 │
│     ─────────────────────────    │
│     [⋮⋮] 拖拽调整  [×] 删除      │  ← 操作按钮（hover 显示）
└──────────────────────────────────┘
```

```css
.canvas-node {
  width: 280px;
  padding: 16px;
  background: #FFFFFF;
  border: 2px solid #E2E8F0;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}
.canvas-node:hover {
  border-color: #93C5FD;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
}
.canvas-node.selected {
  border-color: #3B82F6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}
.canvas-node .node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.canvas-node .node-title {
  font-size: 15px;
  font-weight: 600;
  color: #1E293B;
}
.canvas-node .node-summary {
  font-size: 12px;
  color: #94A3B8;
  line-height: 1.6;
}
.canvas-node .node-actions {
  display: none;
  position: absolute;
  top: 8px;
  right: 8px;
  gap: 4px;
}
.canvas-node:hover .node-actions {
  display: flex;
}
```

**节点间 "+" 按钮样式**：

```
        │
   ┌────┴────┐
   │ 审批节点 │
   └────┬────┘
        │
     ╭──┴──╮
     │  ⊕  │  ← 圆形 + 按钮，直径 28px
     ╰──┬──╯
        │
   ┌────┴────┐
   │ 审批节点 │
   └────┬────┘
        │
```

```css
.add-node-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #FFFFFF;
  border: 2px solid #3B82F6;
  color: #3B82F6;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  z-index: 10;
}
.add-node-btn:hover {
  background: #3B82F6;
  color: #FFFFFF;
  transform: scale(1.15);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}
```

**点击 "+" 弹出节点选择菜单**：

```
┌─────────────────────┐
│  ➕ 添加节点         │  ← 菜单标题
├─────────────────────┤
│  ◉  审批人          │  ← 带图标和颜色标识
│     需要审批的节点    │
├─────────────────────┤
│  ◇  条件分支        │
│     根据条件分流      │
├─────────────────────┤
│  ⬡  并行分支        │
│     同时多个分支      │
├─────────────────────┤
│  ◉  抄送人          │
│     知会相关人员      │
├─────────────────────┤
│  ◈  子流程          │
│     嵌套其他流程      │
└─────────────────────┘
```

**连线样式**：

```css
.edge-path {
  stroke: #CBD5E1;
  stroke-width: 2px;
  fill: none;
}
.edge-path.selected {
  stroke: #3B82F6;
  stroke-width: 2.5px;
}
.edge-arrow {
  fill: #CBD5E1;
}
.edge-label {
  font-size: 12px;
  fill: #64748B;
  background: #FFFFFF;
  padding: 2px 6px;
  border-radius: 4px;
}
```

**条件分支连线标签**：条件分支的出线需显示分支条件，如：

```
         ┌──────────┐
         │ 条件分支  │
         └──┬───┬───┘
            │   │
      金额<5000 │ 金额≥5000
            │   │
       ┌────┴┐ ┌┴────┐
       │ 审批 │ │ 审批 │
       └─────┘ └─────┘
```

##### 3.1.1.4 右侧面板：属性配置

**钉钉风格要点**：右侧面板在**未选中节点时隐藏或显示提示文字**，选中节点后滑入显示对应节点的配置表单。

**面板状态切换**：

```
未选中节点时：                          选中节点后：
┌──────────────────┐                  ┌──────────────────┐
│                  │                  │ 审批节点属性  [×] │ ← 标题 + 关闭按钮
│   📋             │                  ├──────────────────┤
│  请选择一个节点   │                  │                  │
│  查看或编辑属性   │                  │  节点名称        │
│                  │                  │  [部门经理审批___] │
│                  │                  │                  │
│                  │                  │  审批人          │
│                  │                  │  ○ 指定人员      │
│                  │                  │  ○ 指定角色      │
│                  │                  │  ● 部门负责人    │  ← 选中态
│                  │                  │  ○ 直属上级      │
│                  │                  │  ○ 表单字段      │
│                  │                  │                  │
│                  │                  │  审批模式        │
│                  │                  │  [会签 ▼]        │
│                  │                  │                  │
│                  │                  │  驳回策略        │
│                  │                  │  [驳回至上一节点 ▼]│
│                  │                  │                  │
│                  │                  │  ─────────────── │
│                  │                  │  [删除节点]      │  ← 红色危险按钮
│                  │                  │                  │
└──────────────────┘                  └──────────────────┘
```

**属性面板配置表单布局规范**：

- 表单采用**分组折叠**方式，每个分组有一个标题和折叠/展开箭头
- 分组顺序：基本信息 → 审批设置 → 高级设置 → 字段权限
- 表单控件高度 ≥ 36px，确保可点击区域足够
- 必填项用红色星号标记
- 底部固定"删除节点"按钮（红色，二次确认）

**各节点属性面板内容**：

| 节点类型 | 属性面板分组 |
|---------|-------------|
| **开始节点** | 基本信息（节点名称）、发起人范围（全员/角色/部门/人员/公式）、发起频次控制、表单默认值 |
| **审批节点** | 基本信息、审批人设置（六种类型选择）、审批模式（会签/或签/比例/依次）、操作权限（同意/驳回/加签/转办/委派）、驳回策略、超时设置、字段权限 |
| **条件分支** | 基本信息、分支条件（优先级、条件表达式、默认分支）、分支名称 |
| **并行分支** | 基本信息、汇合策略（全部完成/任一完成/比例完成） |
| **抄送节点** | 基本信息、抄送人（同审批人六种类型）、抄送时机（审批通过时/驳回时/始终） |
| **子流程** | 基本信息、子流程选择（下拉搜索已发布的流程）、数据传递映射、启动模式（单个/多个） |
| **结束节点** | 基本信息、结束类型（通过/驳回/取消）、通知设置、触发后续动作、数据归档 |

**审批人选择器 UI**（核心交互）：

```
┌─────────────────────────────────────┐
│  审批人                              │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ 审批人类型                    │    │
│  │ ┌─────┐ ┌─────┐ ┌───────┐  │    │
│  │ │人员 │ │角色 │ │部门   │  │    │  ← 单选按钮组，水平排列
│  │ │  ✓  │ │     │ │负责人 │  │    │
│  │ └─────┘ └─────┘ └───────┘  │    │
│  │ ┌─────┐ ┌─────┐ ┌─────┐   │    │
│  │ │直属 │ │表单 │ │动态 │   │    │
│  │ │上级 │ │字段 │ │脚本 │   │    │
│  │ └─────┘ └─────┘ └─────┘   │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ 已选人员                      │    │
│  │ ┌──────────────────────┐    │    │
│  │ │ 张三  部门经理  [×]   │    │    │  ← 标签式展示，可逐个删除
│  │ │ 李四  财务主管  [×]   │    │    │
│  │ └──────────────────────┘    │    │
│  │ [+ 添加人员]                 │    │  ← 点击弹出人员选择器
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ 多人审批方式                  │    │
│  │ ○ 会签（需所有审批人同意）     │    │
│  │ ○ 或签（任一审批人同意即可）   │    │
│  │ ○ 依次审批（按顺序逐个审批）   │    │  ← 单选
│  │ ○ 比例审批（达到__%即可）     │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

**人员选择器弹出层**：

```
┌──────────────────────────────────────┐
│  选择人员                    [确定]   │
├──────────────────────────────────────┤
│  🔍 [搜索人员/部门/角色_________]     │
├──────────────────┬───────────────────┤
│  组织架构         │  已选 (2)         │
│                  │                   │
│  ▼ 技术部        │  ┌─────────────┐  │
│    ☑ 张三        │  │ 张三  [×]   │  │
│    ☐ 王五        │  └─────────────┘  │
│  ▼ 财务部        │  ┌─────────────┐  │
│    ☑ 李四        │  │ 李四  [×]   │  │
│    ☐ 赵六        │  └─────────────┘  │
│  ▼ 市场部        │                   │
│    ☐ 孙七        │                   │
│                  │                   │
├──────────────────┴───────────────────┤
│  ○ 人员  ○ 角色  ○ 部门              │  ← 切换选择维度
└──────────────────────────────────────┘
```

##### 3.1.1.5 顶部工具栏

```
┌──────────────────────────────────────────────────────────────────┐
│  [← 返回]  │  [↩ 撤销] [↪ 重做]  │  [🔍 100% ▼]  │  [☰ 自动布局] │  [🤖 AI 生成]  │        [保存草稿]  [发布]  │
└──────────────────────────────────────────────────────────────────┘
```

| 按钮 | 功能 | 快捷键 |
|------|------|--------|
| ← 返回 | 返回流程列表 | — |
| ↩ 撤销 | 撤销上一步操作 | Ctrl+Z |
| ↪ 重做 | 重做已撤销的操作 | Ctrl+Shift+Z |
| 🔍 缩放 | 画布缩放比例（25%/50%/75%/100%/125%/150%/200%） | Ctrl+滚轮 |
| ☰ 自动布局 | 自动整理节点位置，垂直居中排列 | — |
| 🤖 AI 生成 | 打开 AI 对话面板，描述需求自动生成流程（见 3.8） | — |
| 保存草稿 | 保存当前流程为草稿，暂不发布 | Ctrl+S |
| 发布 | 发布流程，发布后不可编辑（需先下线） | — |

##### 3.1.1.6 底部状态栏

```
┌──────────────────────────────────────────────────────────────────┐
│  📊 节点数: 5  │  💾 已保存 12:30:15  │  🔍 画布缩放: 100%  │  ⌨️ 提示: 拖拽节点调整顺序，点击节点编辑属性  │
└──────────────────────────────────────────────────────────────────┘
```

##### 3.1.1.7 画布交互细节

**拖拽交互**：

| 操作 | 行为 |
|------|------|
| 从左侧面板拖拽节点到画布 | 在鼠标释放位置创建新节点，自动插入到最近的合法位置 |
| 在画布中拖拽节点 | 调整节点顺序（在合法范围内），连线自动跟随 |
| 拖拽节点到画布外 | 删除节点（需二次确认） |
| 拖拽 "+" 按钮 | 不支持，点击 "+" 弹出菜单选择节点类型 |

**鼠标交互**：

| 操作 | 行为 |
|------|------|
| 单击节点 | 选中节点，右侧显示属性面板，连线高亮 |
| 双击节点 | 选中节点并聚焦到属性面板第一个输入框 |
| 单击空白区域 | 取消选中所有节点，右侧面板恢复空状态 |
| 单击连线 | 选中连线（主要用于条件分支的条件编辑） |
| 右键节点 | 弹出上下文菜单（复制节点/删除节点/添加后续节点） |
| 鼠标滚轮 | 缩放画布（Ctrl+滚轮）或滚动画布（仅滚轮） |
| 按住空白区域拖拽 | 平移画布 |

**键盘快捷键**：

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Z` | 撤销 |
| `Ctrl+Shift+Z` | 重做 |
| `Ctrl+S` | 保存草稿 |
| `Ctrl+C` | 复制选中节点 |
| `Ctrl+V` | 粘贴节点（自动插入到选中节点之后） |
| `Delete` / `Backspace` | 删除选中节点（需二次确认） |
| `Escape` | 取消选中 / 关闭弹出菜单 |
| `Ctrl+滚轮` | 缩放画布 |
| `Space+拖拽` | 平移画布 |

##### 3.1.1.8 与钉钉设计器的差异点

鲁班流程设计器在参考钉钉风格的基础上，有以下增强：

| 差异点 | 钉钉 | 鲁班 |
|--------|------|------|
| **AI 生成** | 无 | 支持 AI 对话式生成流程（工具栏"🤖 AI 生成"按钮） |
| **节点类型** | 审批人、抄送人、办理人、条件分支 | 增加并行分支、子流程，审批人拆分为开始/审批/结束 |
| **审批人类型** | 指定人员、角色、部门负责人 | 增加直属上级、表单字段、动态脚本（六种） |
| **审批模式** | 会签、或签 | 增加依次审批、比例审批 |
| **字段权限** | 无 | 支持审批节点配置字段级读写权限 |
| **超时设置** | 基础 | 支持超时提醒、自动处理、升级路径 |
| **子流程** | 无 | 支持嵌套子流程，数据传递映射 |
| **撤销/重做** | 有限 | 支持 50 步历史 |
| **画布缩放** | 基础 | 25%~200% 无级缩放 |

##### 3.1.1.9 响应式设计

- **PC 端（≥1024px）**：标准三栏布局，左侧 200px + 中间自适应 + 右侧 360px
- **平板端（768px ~ 1023px）**：右侧属性面板默认折叠，点击节点后以抽屉形式滑出
- **移动端（<768px）**：不支持流程设计，仅支持流程查看和审批操作

```css
/* 平板端：属性面板变为抽屉 */
@media (max-width: 1023px) {
  .property-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 360px;
    height: 100vh;
    transform: translateX(100%);
    transition: transform 0.3s;
    z-index: 100;
    box-shadow: -4px 0 12px rgba(0, 0, 0, 0.1);
  }
  .property-panel.open {
    transform: translateX(0);
  }
  .property-panel-overlay {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 99;
  }
}
```

#### 3.1.2 节点配置详参

每个节点在 `workflow_definitions.nodes` JSON 中存储完整配置。以下为每种节点类型的完整配置 Schema。

##### 3.1.2.1 开始节点（StartNode）

流程唯一入口，定义"谁能发起这个流程"。

```typescript
interface StartNodeConfig {
  nodeType: 'start';
  nodeId: string;           // 节点唯一 ID，如 "start_001"
  nodeName: string;         // 显示名称，默认 "发起申请"
  position: { x: number; y: number };  // 画布坐标
  
  // ===== 发起人范围 =====
  initiatorScope: {
    type: 'all' | 'roles' | 'departments' | 'members' | 'formula';
    // all: 工作区所有成员均可发起
    // roles: 仅指定角色可发起
    // departments: 仅指定部门的成员可发起
    // members: 仅指定人员可发起
    // formula: 动态脚本判断（如"工龄 > 1 年的员工"）
    
    values?: string[];       // 对应 type 的值列表
    // type=roles → ["admin", "finance"]
    // type=departments → ["dept_001", "dept_002"]
    // type=members → ["user_001", "user_002"]
    
    formula?: string;        // type=formula 时的表达式
    // 示例："user.hireDate < now - 365"（入职满一年的员工）
  };
  
  // ===== 发起频次控制 =====
  frequencyLimit?: {
    enabled: boolean;        // 是否启用频次限制，默认 false
    type: 'once_per_user' | 'once_per_form' | 'custom';
    // once_per_user: 每人只能发起一次
    // once_per_form: 同一表单数据只能发起一次（如基于合同编号去重）
    // custom: 自定义条件
    
    duplicateCheck?: {       // type=once_per_form 时的去重字段
      fieldKeys: string[];   // 用于去重的表单字段 key，如 ["contract_no"]
    };
    
    customFormula?: string;  // type=custom 时的表达式
    // 示例："count(instances where initiator=currentUser and status='RUNNING') < 3"
    
    rejectMessage?: string;  // 超频时的提示文案，默认 "您已发起过该流程，请勿重复提交"
  };
  
  // ===== 表单预填 =====
  formDefaults?: {           // 发起时自动填入表单的默认值
    [fieldKey: string]: unknown;
  };
  // 示例：{ "application_date": "{{current_time.today}}" }
}
```

**开始节点配置示例**：

```json
{
  "nodeType": "start",
  "nodeId": "start_001",
  "nodeName": "发起申请",
  "position": { "x": 100, "y": 300 },
  "initiatorScope": {
    "type": "departments",
    "values": ["dept_rd", "dept_product", "dept_design"]
  },
  "frequencyLimit": {
    "enabled": true,
    "type": "once_per_form",
    "duplicateCheck": {
      "fieldKeys": ["contract_no"]
    },
    "rejectMessage": "该合同已有审批在进行中，请勿重复提交"
  },
  "formDefaults": {
    "application_date": "{{current_time.today}}"
  }
}
```

##### 3.1.2.2 审批节点（ApprovalNode）

流程的核心节点，定义"谁来审批、怎么审批、能做什么"。

```typescript
interface ApprovalNodeConfig {
  nodeType: 'approval';
  nodeId: string;           // 节点唯一 ID，如 "approval_dept_manager"
  nodeName: string;         // 显示名称，如 "部门经理审批"
  position: { x: number; y: number };
  
  // ===== 审批人设置（核心） =====
  approvers: ApproverConfig[];  // 审批人列表，支持多个来源组合
  approverCombinator: 'AND' | 'OR';  // 多个审批人来源的组合逻辑
  // AND: 所有来源的审批人都需要审批（如"部门负责人 AND 财务负责人"）
  // OR: 任一来源的审批人即可（如"部门负责人 OR 副经理"）
  
  // ===== 协作模式 =====
  collaborationMode: 'all_pass' | 'any_pass' | 'ratio_pass' | 'sequential';
  // all_pass: 会签（多人审批时，全部同意才通过）
  // any_pass: 或签（多人审批时，任一人同意即通过）
  // ratio_pass: 按比例通过
  // sequential: 依次审批
  
  ratioConfig?: {            // collaborationMode=ratio_pass 时
    passRatio: number;       // 通过比例，如 0.6 表示 60%
    minVoters: number;       // 最少投票人数，如 3
    // 示例：5 个审批人，passRatio=0.6，minVoters=3 → 至少 3 人投票，其中 3×0.6=2 人同意
  };
  
  // ===== 操作权限 =====
  allowedActions: {
    approve: boolean;        // 同意，默认 true
    reject: boolean;         // 驳回，默认 true
    addSign: boolean;        // 加签（前加签/后加签），默认 true
    transfer: boolean;       // 转办，默认 true
    delegate: boolean;       // 委派，默认 false
    comment: {               // 审批意见
      required: boolean;     // 是否必填，默认 false
      allowAttachment: boolean;  // 是否允许上传附件，默认 true
      minLength?: number;    // 意见最小字数（如驳回时强制要求 10 字以上）
    };
  };
  
  // ===== 驳回配置 =====
  rejectConfig: {
    strategy: 'to_previous' | 'to_any_history' | 'to_initiator' | 'to_specified';
    // to_previous: 驳回至上一节点
    // to_any_history: 驳回至任意历史节点（运行时选择）
    // to_initiator: 驳回至发起人
    // to_specified: 驳回至指定节点
    
    specifiedNodeId?: string;  // strategy=to_specified 时的目标节点 ID
    
    resubmitMode: 'original_path' | 'from_start';
    // original_path: 驳回后修改重新提交，直接回到当前节点
    // from_start: 驳回后从头开始走完整流程
  };
  
  // ===== 表单权限 =====
  fieldPermissions: FieldPermission[];  // 详见 2.6 字段级权限运行时渲染
  
  // ===== 时限配置 =====
  deadline: {
    duration: number;        // 时长
    unit: 'minutes' | 'hours' | 'days' | 'working_days';
    // working_days: 工作日计时（自动跳过周末和法定节假日）
    
    remindBefore?: {         // 超时前提醒
      enabled: boolean;
      durations: number[];   // 提前多久提醒，如 [2, 1] 表示超时前 2 小时和 1 小时各提醒一次
      unit: 'minutes' | 'hours' | 'days';
      channels: ('in_app' | 'email' | 'wechat' | 'sms')[];  // 提醒渠道
    };
    
    overdueAction: {         // 超时后动作
      type: 'notify' | 'escalate' | 'auto_approve' | 'auto_reject' | 'suspend';
      // notify: 仅通知（不改变流程状态）
      // escalate: 自动升级给上级
      // auto_approve: 自动通过
      // auto_reject: 自动驳回
      // suspend: 挂起告警，等待管理员处理
      
      escalateTo?: {         // type=escalate 时
        type: 'leader' | 'department_head' | 'specified';
        // leader: 升级给当前审批人的直属上级
        // department_head: 升级给当前审批人所在部门的负责人
        // specified: 升级给指定人员
        memberIds?: string[];
      };
      
      delayAfterDue?: {      // 超时后延迟多久执行动作（给审批人最后缓冲）
        duration: number;
        unit: 'hours' | 'days';
      };
    };
  };
  
  // ===== 审批人不存在时的降级策略 =====
  fallbackOnMissingApprover: {
    enabled: boolean;        // 是否启用降级，默认 true
    strategy: 'skip' | 'escalate' | 'suspend' | 'assign_admin';
    // skip: 跳过该审批人，继续下一节点
    // escalate: 自动升级给该审批人的上级
    // suspend: 流程挂起，通知管理员手动指派
    // assign_admin: 自动指派给流程管理员
  };
  
  // ===== 自动审批 =====
  autoApproval?: {
    enabled: boolean;
    condition: 'same_as_previous' | 'same_as_initiator' | 'formula';
    // same_as_previous: 如果当前审批人与上一节点审批人相同，自动跳过
    // same_as_initiator: 如果当前审批人与发起人相同，自动跳过
    // formula: 自定义条件
    
    formula?: string;        // condition=formula 时
    // 示例："formData.amount < 100"（金额小于 100 自动通过）
  };
}
```

##### 3.1.2.2.1 审批人类型（ApproverConfig）— 六种指定方式

```typescript
interface ApproverConfig {
  type: 'member' | 'role' | 'department_head' | 'leader' | 'form_field' | 'script';
  // member: 指定具体人员
  // role: 指定角色（角色中的成员）
  // department_head: 部门负责人（动态解析）
  // leader: 直属上级（动态解析）
  // form_field: 从表单字段中取值（如"表单中的'直属上级'字段"）
  // script: 动态脚本
  
  // ===== 各类型的配置 =====
  
  // type=member
  memberIds?: string[];      // 用户 ID 列表
  
  // type=role
  roleIds?: string[];        // 角色 ID 列表
  
  // type=department_head
  departmentSource?: 'initiator' | 'specified' | 'form_field';
  // initiator: 发起人所在部门的负责人
  // specified: 指定部门
  // form_field: 从表单字段取值（如字段"费用归属部门"的部门负责人）
  departmentIds?: string[];
  departmentFieldKey?: string;  // departmentSource=form_field 时
  
  // type=leader
  leaderOf?: 'initiator' | 'specified' | 'form_field';
  // initiator: 发起人的直属上级
  // specified: 指定人员的直属上级
  // form_field: 从表单字段中的人员取值其直属上级
  memberIds?: string[];
  memberFieldKey?: string;   // leaderOf=form_field 时
  
  // type=form_field
  formFieldKey?: string;     // 表单字段 key（该字段必须是 member 类型）
  
  // type=script
  script?: string;           // 脚本（Groovy 或 JS），返回审批人 ID 列表
  // 脚本可访问变量：
  //   formData - 当前表单数据
  //   initiator - 发起人信息 { id, name, departmentId, ... }
  //   instanceId - 流程实例 ID
  // 示例脚本：
  //   "return memberService.findByDepartment(formData.costDepartment)
  //           .filter(m => m.position === '经理')
  //           .map(m => m.id);"
}
```

##### 3.1.2.2.2 审批人配置示例

**示例 1：固定人员审批**
```json
{
  "approvers": [
    { "type": "member", "memberIds": ["user_zhang", "user_li"] }
  ],
  "approverCombinator": "OR",
  "collaborationMode": "all_pass"
}
// → 张三和李四都需要审批（会签）
```

**示例 2：发起人的直属上级 + 部门负责人**
```json
{
  "approvers": [
    { "type": "leader", "leaderOf": "initiator" },
    { "type": "department_head", "departmentSource": "initiator" }
  ],
  "approverCombinator": "AND",
  "collaborationMode": "all_pass"
}
// → 发起人的直属上级 和 发起人所在部门的负责人 都需要审批
// 如果直属上级和部门负责人是同一人，自动去重只保留一个（见 3.1.2.2.3）
```

**示例 3：表单中选择的审批人**
```json
{
  "approvers": [
    { "type": "form_field", "formFieldKey": "direct_manager" }
  ],
  "approverCombinator": "OR",
  "collaborationMode": "any_pass"
}
// → 表单中"直属上级"字段选的人审批（发起时用户自行选择）
```

**示例 4：角色 + 动态脚本**
```json
{
  "approvers": [
    { "type": "role", "roleIds": ["role_finance"] },
    { "type": "script", "script": "return memberService.findByDepartment(formData.costDepartment).filter(m => m.position === '总监').map(m => m.id);" }
  ],
  "approverCombinator": "OR",
  "collaborationMode": "any_pass"
}
// → 财务角色中的任何人 或 费用归属部门的总监，任一审批即可
```

**示例 5：复杂场景 — 多人多来源组合**
```json
{
  "approvers": [
    { "type": "leader", "leaderOf": "initiator" },
    { "type": "role", "roleIds": ["role_finance", "role_compliance"] },
    { "type": "department_head", "departmentSource": "form_field", "departmentFieldKey": "cost_department" }
  ],
  "approverCombinator": "AND",
  "collaborationMode": "all_pass"
}
// → 发起人直属上级 + 财务角色中的任何人 + 合规角色中的任何人 + 费用归属部门的负责人
// = 至少 4 人审批（会签），其中角色内部为或签（任一角色成员即可）
```

##### 3.1.2.2.3 审批人去重与降级

**去重规则**（自动执行，无需配置）：

| 场景 | 处理方式 |
|------|---------|
| 同一人出现在多个审批人来源中 | 自动去重，只保留一个审批任务 |
| 审批人与发起人是同一人 | 自动跳过（可配置 `autoApproval.condition='same_as_initiator'` 关闭） |
| 审批人与上一节点审批人是同一人 | 自动跳过（可配置 `autoApproval.condition='same_as_previous'` 关闭） |
| 角色中的成员与指定人员重复 | 自动去重 |

**降级规则**（运行时触发）：

```
流程运行到审批节点
    │
    ├── 所有审批人都存在 → 正常创建审批任务
    │
    ├── 部分审批人不存在（如离职、部门解散）
    │   └── 根据 fallbackOnMissingApprover.strategy 处理：
    │       ├── skip: 跳过不存在的审批人，其余继续
    │       ├── escalate: 不存在的审批人升级给其上级
    │       ├── suspend: 流程挂起，通知管理员
    │       └── assign_admin: 自动指派给流程管理员
    │
    └── 所有审批人都不存在
        └── 流程挂起，通知管理员手动指派
```

##### 3.1.2.2.4 审批节点完整配置示例

```json
{
  "nodeType": "approval",
  "nodeId": "approval_dept_manager",
  "nodeName": "部门经理审批",
  "position": { "x": 300, "y": 300 },
  
  "approvers": [
    { "type": "leader", "leaderOf": "initiator" },
    { "type": "department_head", "departmentSource": "initiator" }
  ],
  "approverCombinator": "AND",
  
  "collaborationMode": "all_pass",
  
  "allowedActions": {
    "approve": true,
    "reject": true,
    "addSign": true,
    "transfer": true,
    "delegate": false,
    "comment": {
      "required": false,
      "allowAttachment": true
    }
  },
  
  "rejectConfig": {
    "strategy": "to_initiator",
    "resubmitMode": "original_path"
  },
  
  "fieldPermissions": [
    { "fieldKey": "applicant_name", "mode": "readonly" },
    { "fieldKey": "department", "mode": "readonly" },
    { "fieldKey": "expense_amount", "mode": "editable" },
    { "fieldKey": "expense_details", "mode": "editable" },
    { "fieldKey": "invoice_file", "mode": "visible" }
  ],
  
  "deadline": {
    "duration": 24,
    "unit": "working_days",
    "remindBefore": {
      "enabled": true,
      "durations": [4, 1],
      "unit": "hours",
      "channels": ["in_app", "email"]
    },
    "overdueAction": {
      "type": "escalate",
      "escalateTo": { "type": "leader" },
      "delayAfterDue": { "duration": 4, "unit": "hours" }
    }
  },
  
  "fallbackOnMissingApprover": {
    "enabled": true,
    "strategy": "escalate"
  },
  
  "autoApproval": {
    "enabled": true,
    "condition": "same_as_previous"
  }
}
```

##### 3.1.2.3 条件分支节点（ConditionNode）

根据表单数据动态路由到不同分支。

```typescript
interface ConditionNodeConfig {
  nodeType: 'condition';
  nodeId: string;           // 如 "condition_amount"
  nodeName: string;         // 如 "金额判断"
  position: { x: number; y: number };
  
  // ===== 分支定义 =====
  branches: ConditionBranch[];
  
  // ===== 默认分支 =====
  defaultBranchId: string;   // 所有条件都不满足时走的分支（必填）
}

interface ConditionBranch {
  branchId: string;          // 分支 ID，如 "branch_low"
  branchName: string;        // 分支显示名，如 "小额（≤5000）"
  targetNodeId: string;      // 满足条件时跳转的目标节点 ID
  
  // ===== 条件表达式 =====
  conditions: ConditionRule[];
  combinator: 'AND' | 'OR';  // 多个条件的组合逻辑
  
  priority: number;          // 分支优先级（数字越小越优先匹配）
}

interface ConditionRule {
  fieldKey: string;          // 表单字段 key，如 "expense_amount"
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty' | 'between';
  // eq: 等于
  // neq: 不等于
  // gt: 大于
  // gte: 大于等于
  // lt: 小于
  // lte: 小于等于
  // in: 在列表中
  // not_in: 不在列表中
  // contains: 包含
  // not_contains: 不包含
  // is_empty: 为空
  // is_not_empty: 不为空
  // between: 在范围内（不含边界）
  
  value?: unknown;           // 比较值
  values?: unknown[];        // operator=in/not_in 时的值列表
  minValue?: number;         // operator=between 时的最小值
  maxValue?: number;         // operator=between 时的最大值
}
```

**条件分支配置示例**：

```json
{
  "nodeType": "condition",
  "nodeId": "condition_amount",
  "nodeName": "报销金额判断",
  "position": { "x": 500, "y": 300 },
  "branches": [
    {
      "branchId": "branch_low",
      "branchName": "小额（≤5000）",
      "targetNodeId": "approval_dept_manager",
      "conditions": [
        { "fieldKey": "expense_amount", "operator": "lte", "value": 5000 }
      ],
      "combinator": "AND",
      "priority": 1
    },
    {
      "branchId": "branch_mid",
      "branchName": "中额（5000~10000）",
      "targetNodeId": "approval_finance",
      "conditions": [
        { "fieldKey": "expense_amount", "operator": "gt", "value": 5000 },
        { "fieldKey": "expense_amount", "operator": "lte", "value": 10000 }
      ],
      "combinator": "AND",
      "priority": 2
    },
    {
      "branchId": "branch_high",
      "branchName": "大额（>10000）+ 差旅",
      "targetNodeId": "approval_director",
      "conditions": [
        { "fieldKey": "expense_amount", "operator": "gt", "value": 10000 },
        { "fieldKey": "expense_type", "operator": "eq", "value": "travel" }
      ],
      "combinator": "AND",
      "priority": 3
    }
  ],
  "defaultBranchId": "branch_low"
}
```

##### 3.1.2.4 并行分支节点（ParallelGateway）

```typescript
interface ParallelGatewayConfig {
  nodeType: 'parallel_gateway';
  nodeId: string;
  nodeName: string;         // 如 "并行审批"
  position: { x: number; y: number };
  
  // ===== 分支类型 =====
  gatewayType: 'fork' | 'join';
  // fork: 分叉（一个入，多个出）
  // join: 汇合（多个入，一个出）
  
  // ===== fork 配置 =====
  parallelBranches?: {       // gatewayType=fork 时
    branchId: string;
    branchName: string;      // 如 "法务审核"、"财务审核"、"技术审核"
    targetNodeId: string;    // 分支目标节点 ID
  }[];
  
  // ===== join 配置 =====
  joinStrategy?: 'all' | 'any' | 'ratio';
  // all: 所有分支都完成后才汇合（默认）
  // any: 任一分支完成即汇合（其余分支自动取消）
  // ratio: 按比例完成即汇合
  
  joinRatio?: number;        // joinStrategy=ratio 时的完成比例，如 0.5
}
```

**并行分支配置示例**：

```json
{
  "nodeType": "parallel_gateway",
  "nodeId": "fork_001",
  "nodeName": "并行审批分叉",
  "position": { "x": 600, "y": 300 },
  "gatewayType": "fork",
  "parallelBranches": [
    { "branchId": "par_legal", "branchName": "法务审核", "targetNodeId": "approval_legal" },
    { "branchId": "par_finance", "branchName": "财务审核", "targetNodeId": "approval_finance" },
    { "branchId": "par_tech", "branchName": "技术审核", "targetNodeId": "approval_tech" }
  ]
}
```

##### 3.1.2.5 子流程节点（SubProcessNode）

```typescript
interface SubProcessNodeConfig {
  nodeType: 'sub_process';
  nodeId: string;
  nodeName: string;         // 如 "各城市执行流程"
  position: { x: number; y: number };
  
  // ===== 子流程定义 =====
  subWorkflowId: string;     // 引用的子流程定义 ID
  
  // ===== 实例化模式 =====
  instanceMode: 'single' | 'multiple';
  // single: 只创建一个子流程实例
  // multiple: 根据数据动态创建多个子流程实例
  
  multipleConfig?: {         // instanceMode=multiple 时
    source: 'form_field' | 'script';
    // form_field: 从表单字段取值（如多选部门字段）
    // script: 动态脚本返回实例列表
    
    formFieldKey?: string;   // source=form_field 时的字段 key
    script?: string;         // source=script 时的脚本
    
    instanceKey?: string;    // 每个实例的唯一标识字段（用于区分不同实例）
    // 如 formFieldKey="departments"，instanceKey="department" → 每个部门一个实例
  };
  
  // ===== 数据传递 =====
  dataMapping?: {            // 主流程 → 子流程的数据映射
    [subFormFieldKey: string]: string;  // 子流程字段 key: 主流程字段 key（或表达式）
  };
  // 示例：{ "budget": "formData.budget", "department": "instance.department" }
  
  // ===== 汇合策略 =====
  joinStrategy: 'all' | 'any' | 'ratio';
  joinRatio?: number;
  
  // ===== 子流程终止 =====
  terminateOnParentReject?: boolean;  // 主流程驳回时是否终止子流程，默认 true
}
```

**子流程配置示例**：

```json
{
  "nodeType": "sub_process",
  "nodeId": "sub_city_exec",
  "nodeName": "各城市执行",
  "position": { "x": 800, "y": 300 },
  "subWorkflowId": "wf_city_execution",
  "instanceMode": "multiple",
  "multipleConfig": {
    "source": "form_field",
    "formFieldKey": "selected_cities",
    "instanceKey": "city"
  },
  "dataMapping": {
    "city_name": "instance.city",
    "total_budget": "formData.budget",
    "deadline": "formData.execution_deadline"
  },
  "joinStrategy": "all",
  "terminateOnParentReject": true
}
```

##### 3.1.2.6 结束节点（EndNode）

```typescript
interface EndNodeConfig {
  nodeType: 'end';
  nodeId: string;
  nodeName: string;         // 如 "审批通过"、"已驳回"
  position: { x: number; y: number };
  
  // ===== 结束类型 =====
  endType: 'approved' | 'rejected' | 'cancelled';
  // approved: 审批通过
  // rejected: 审批驳回
  // cancelled: 发起人撤回
  
  // ===== 归档动作 =====
  archiveActions?: {
    // 通知发起人
    notifyInitiator: {
      enabled: boolean;      // 默认 true
      template?: string;     // 通知模板，默认 "您的{表单名称}已于{时间}{审批结果}"
      channels: ('in_app' | 'email' | 'wechat')[];
    };
    
    // 通知抄送人
    notifyCc?: {
      type: 'members' | 'roles' | 'form_field' | 'script';
      memberIds?: string[];
      roleIds?: string[];
      formFieldKey?: string;
      script?: string;
      channels: ('in_app' | 'email')[];
    };
    
    // 触发后续动作
    triggerActions?: {
      type: 'webhook' | 'api' | 'create_task' | 'send_email';
      // webhook: 调用外部 webhook
      // api: 调用鲁班内部 API
      // create_task: 创建待办任务
      // send_email: 发送邮件
      
      config: Record<string, unknown>;  // 各类型的具体配置
    }[];
    
    // 数据归档
    dataArchive: {
      exportToExcel?: boolean;  // 是否导出为 Excel（默认 false）
      retentionDays?: number;   // 数据保留天数（默认 1095，即 3 年）
    };
  };
}
```

**结束节点配置示例**：

```json
{
  "nodeType": "end",
  "nodeId": "end_approved",
  "nodeName": "审批通过",
  "position": { "x": 1000, "y": 300 },
  "endType": "approved",
  "archiveActions": {
    "notifyInitiator": {
      "enabled": true,
      "channels": ["in_app", "email"]
    },
    "notifyCc": {
      "type": "roles",
      "roleIds": ["role_hr", "role_finance"],
      "channels": ["in_app"]
    },
    "triggerActions": [
      {
        "type": "webhook",
        "config": {
          "url": "https://erp.company.com/api/expense/sync",
          "method": "POST",
          "headers": { "Authorization": "Bearer {{secret.erp_token}}" }
        }
      }
    ],
    "dataArchive": {
      "exportToExcel": false,
      "retentionDays": 1095
    }
  }
}
```

##### 3.1.2.7 节点通用配置（所有节点共有）

```typescript
interface NodeBaseConfig {
  nodeType: string;
  nodeId: string;
  nodeName: string;
  position: { x: number; y: number };
  
  // ===== 可选：节点描述 =====
  description?: string;      // 节点说明，如"部门经理审批：仅限部门负责人"
  
  // ===== 可选：节点前置条件 =====
  preCondition?: {
    formula: string;         // 进入该节点前需满足的条件表达式
    // 不满足时自动跳过该节点
    // 示例："formData.amount > 0"（金额为 0 时跳过审批）
  };
  
  // ===== 可选：节点后置动作 =====
  postActions?: {
    type: 'update_field' | 'send_notification' | 'call_api';
    config: Record<string, unknown>;
  }[];
}
```

##### 3.1.2.8 配置速查总表

| 节点类型 | 必填配置 | 可选配置 | 审批人可设 |
|---------|---------|---------|-----------|
| **开始节点** | `initiatorScope` | `frequencyLimit`, `formDefaults` | ❌ |
| **审批节点** | `approvers`, `collaborationMode` | `allowedActions`, `rejectConfig`, `fieldPermissions`, `deadline`, `fallbackOnMissingApprover`, `autoApproval` | ✅ 六种方式 |
| **条件分支** | `branches`, `defaultBranchId` | — | ❌ |
| **并行分支** | `gatewayType`, `parallelBranches`(fork) / `joinStrategy`(join) | `joinRatio` | ❌ |
| **子流程** | `subWorkflowId`, `instanceMode` | `multipleConfig`, `dataMapping`, `joinStrategy`, `terminateOnParentReject` | ❌ |
| **结束节点** | `endType` | `archiveActions` | ❌ |

### 3.2 审批节点的协作模式

#### 3.2.1 会签（全部通过）

- 当前节点有多个审批人时，必须**所有审批人都同意**才能进入下一环节
- 任一审批人驳回，流程即整体驳回
- 支持"一票否决制"：只需一人驳回，流程立即终止当前节点

#### 3.2.2 或签（任一通过）

- 多个审批人中，**只要有一人同意**即可流转
- 也称为"抢单模式"或"竞争审批"，谁先处理谁生效
- 一人处理后，其他审批人的待办自动取消

#### 3.2.3 按比例通过

- 不要求 100% 通过，设置通过比例阈值
- 如"5 个评委中至少 3 人同意"即通过
- 同时支持设置"最少投票人数"（如至少 3 人投票，其中 2 人同意）

#### 3.2.4 依次审批（顺序审批）

- 多个审批人严格按先后顺序处理
- 后一位审批人在前一位处理完成前，**看不到待办任务**
- 前一位审批人的意见对后一位可见（可配置是否隐藏）

### 3.3 动态路由（条件分支）

基于表单字段值，运行时自动判断流程走向。

#### 3.3.1 规则类型

| 规则类型 | 示例 |
|---------|------|
| **金额阈值** | 合同金额 > 100 万 → 副总裁审批；≤ 100 万 → 部门经理审批 |
| **业务类型** | 采购类型 = "IT 设备" → 技术评审组；= "办公用品" → 行政初审 |
| **组织归属** | 根据表单中"所属分公司"字段，自动分发到对应分公司 HR |
| **动态跳过** | "是否紧急" = 是 → 跳过财务复核，直达出纳支付 |
| **组合条件** | 金额 > 10 万 且 类型 = "差旅" → 总监审批；否则 → 经理审批 |

#### 3.3.2 条件表达式

- 支持比较运算符：`>`、`<`、`>=`、`<=`、`==`、`!=`、`in`、`contains`
- 支持逻辑组合：`AND`、`OR`、`NOT`
- 支持函数调用：`sum(明细表.金额)`、`count(审批人)`
- 可视化配置：拖拽字段 + 选择运算符 + 填入阈值，自动生成表达式
- AI 配置：`"金额超过 5000 的走总监审批，否则走经理审批"` → Agent 自动生成条件分支

#### 3.3.3 异常处理

- 目标节点处理人不存在时：自动转给该部门负责人 / 流程管理员 / 流程挂起告警
- 条件无匹配时：走默认分支 / 流程挂起并通知管理员

### 3.4 运行中的弹性干预

#### 3.4.1 前加签（协办）

- 当前处理人在审批**前**，临时拉一人先提意见
- 被加签人处理完毕后，加签发起人汇总意见再做最终决定
- 加签人的意见作为审批参考，不代替审批决策

#### 3.4.2 后加签

- 当前处理人审批**完毕后**，临时增加一个额外审批环节
- 如"法务总监审批通过后，突然要求合规部再确认一遍"
- 后加签人处理完毕后，流程继续原路径

#### 3.4.3 转办

- 当前处理人因休假、权限不足等原因，将待办移交他人
- 转办后，接收人全权处理（代替原处理人审批）
- 流转记录中标注"XXX 转办给 YYY"

#### 3.4.4 委派

- 与转办类似，但**处理记录仍归属原处理人名下**
- 如"处长委派副处长代为审批，但审批结果视为处长本人意见"

#### 3.4.5 强制干预

- 管理员或流程所有者具备以下权限：
  - **强制跳转**：将流程从当前节点直接跳到指定节点
  - **强制终止**：终止流程实例
  - **强制撤回**：将已提交的流程撤回到发起人
  - **修改处理人**：替换当前节点的处理人
- 所有干预操作必须留痕，记录操作人、时间、原因

### 3.5 驳回与退回

> 驳回的完整配置项定义在 `ApprovalNodeConfig.rejectConfig`（详见 [3.1.2.2 审批节点](#3122-审批节点approvalnode)），本节从概念层面解释驳回的策略和效果。

#### 3.5.1 驳回策略

| 策略 | 说明 |
|------|------|
| **驳回至上一节点** | 逐级驳回，不能越级返回 |
| **驳回至任意历史节点** | 可退回到之前走过的任意一环 |
| **驳回至发起人** | 直接退回发起人重新填写 |
| **驳回至指定节点** | 预设驳回目标（如"驳回至部门经理"） |

#### 3.5.2 驳回后重新提交

- **原路返回**：发起人修改后，直接提交给驳回者，不重新走前面的节点
- **从头开始**：发起人修改后，流程从头开始走完整流程
- **可配置**：在流程设计时每个节点可独立配置驳回后的重新提交策略

#### 3.5.3 驳回数据保留

- 驳回后，表单数据（包括附件）**不清空**，保留供发起人修改
- 驳回前的审批意见、操作记录完整保留，作为历史轨迹

### 3.6 时效性与 SLA 管控

> 时限的完整配置项定义在 `ApprovalNodeConfig.deadline`（详见 [3.1.2.2 审批节点](#3122-审批节点approvalnode)），本节从概念层面解释时限策略的效果。

#### 3.6.1 节点级时限

- 每个审批节点可独立配置超时时间（如"24 小时"）
- 支持配置**工作日**计时（自动跳过法定节假日和非工作时间）
- 支持配置提醒策略（如"超时前 2 小时发送催办提醒"）

#### 3.6.2 超时动作

| 动作 | 说明 |
|------|------|
| **催办通知** | 超时后自动发送消息提醒（站内通知 / 邮件 / 企业微信） |
| **自动升级** | 超时 N 小时后自动转给处理人的直属上级 |
| **自动通过/驳回** | 超时后自动执行预设操作 |
| **挂起告警** | 超时后流程挂起，通知管理员处理 |

#### 3.6.3 流程级期限

- 整个流程实例可设置截止日期（如"合同到期日前必须审批完成"）
- 到期未完成自动冻结，需管理员解冻或手动处理

### 3.7 子流程与多实例

#### 3.7.1 主子流程

- 主流程审批通过后，自动触发 N 个并行子流程
- 如"总合同审批通过后，自动为全国 20 个城市各生成一个执行子流程"
- 子流程可独立审批，全部完成后主流程继续

#### 3.7.2 动态多实例

- 审批分支数量不固定，根据表单数据动态生成
- 如"根据表单中'参与部门'的勾选数量，动态生成对应数量的审批分支"
- 多实例的汇合策略：全部完成 / 任一完成 / 按比例完成

### 3.8 AI 驱动流程设计

#### 3.8.1 对话式生成

```
用户：设计一个报销审批流程，金额小于 5000 只需要部门经理审批，
      超过 5000 需要加上财务复核，超过 10000 还需要总监审批

Agent：好的，我已生成报销审批流程：
      
      [开始] → 发起人填写报销单
               ↓
         [条件分支：报销金额]
          ├─ ≤5000 → [部门经理审批] → [结束]
          ├─ 5000~10000 → [部门经理审批] → [财务复核] → [结束]
          └─ >10000 → [部门经理审批] → [财务复核] → [总监审批] → [结束]
      
      部门经理审批为或签模式（任一通过即可），
      财务和总监为单人审批。
      已在流程设计器中打开，是否调整？
```

#### 3.8.2 智能推荐

- Agent 根据表单字段自动推荐审批路径（如检测到"报销金额"字段，自动推荐金额阈值分支）
- 常见流程模式内置（如"三级审批""条件跳过""会签投票"），Agent 可快速匹配

#### 3.8.3 流程校验

- 流程保存前，Agent 自动校验：
  - 是否存在死循环（节点间形成回路且无退出条件）
  - 是否存在孤立节点（无法到达的节点）
  - 处理人配置是否完整（是否存在没有处理人的审批节点）
  - 条件分支是否覆盖所有情况（是否有默认分支）
- 发现问题时给出具体修复建议

---

## 四、表单与工作流关联

### 4.1 关联模式

#### 4.1.1 一对一绑定

- 一个表单绑定一个流程定义
- 发起该表单时，自动启动对应流程
- 最常用模式，适用于标准化审批（如报销、请假、合同审批）

#### 4.1.2 一对多绑定

- 一个表单可用于多个流程
- 发起时由用户选择走哪个流程（或根据表单字段自动判断）
- 如"通用申请单"可根据"申请类型"字段走不同审批流程

#### 4.1.3 多版本管理

- 流程定义支持版本管理
- 表单绑定流程时，可指定"固定版本"或"始终使用最新版本"
- 已发起的流程实例不受版本变更影响，继续按旧版本走完

### 4.2 关联的数据模型

表单与流程的关联通过 `form_workflow_bindings` 表实现：

```
form_workflow_bindings
├── id              BIGINT PK
├── form_id         BIGINT FK → form_definitions.id
├── workflow_id     BIGINT FK → workflow_definitions.id
├── workflow_version INT          // NULL = 始终用最新版本，填数字 = 锁定版本
├── binding_type    VARCHAR(20)   // ONE_TO_ONE / ONE_TO_MANY
├── is_default      BOOLEAN       // 一对多时，标记默认流程（发起时默认选中）
├── created_at      DATETIME
```

### 4.3 从表单到流程的完整生命周期

```
┌─────────────────────────────────────────────────────────────────────┐
│                         完整的表单-流程生命周期                         │
│                                                                     │
│  1. 设计阶段（流程设计者 + Agent）                                     │
│     ├── 创建表单 → form_definitions + CodePage（HTML/CSS/JS）        │
│     ├── 创建流程 → workflow_definitions（nodes + edges）             │
│     └── 关联绑定 → form_workflow_bindings                           │
│                                                                     │
│  2. 发起阶段（普通用户）                                               │
│     ├── 用户点击"发起申请" → 前端加载关联的 CodePage 表单代码           │
│     ├── FormRenderer 渲染表单，注入 window.__LUBAN_WORKFLOW__         │
│     ├── 平台自动执行 autoFill() 带入当前用户/日期/查询结果              │
│     ├── 用户填写表单 → 调用 window.__LUBAN_WORKFLOW__.submit()       │
│     └── 后端：创建 workflow_instance + form_data 快照                │
│                                                                     │
│  3. 审批阶段（审批人）                                                 │
│     ├── 审批人打开待办 → 前端加载表单代码 + 流程实例数据               │
│     ├── FormRenderer 设置 mode='approve'                            │
│     ├── 平台自动 applyFieldPermissions() 应用字段权限（只读/隐藏/脱敏）  │
│     ├── 平台自动回填 form_data（setFormData）                        │
│     ├── 审批人填写审批意见 → 同意/驳回/转办/加签                        │
│     └── 后端：创建 workflow_task → workflow_history 记录             │
│                                                                     │
│  4. 归档阶段                                                         │
│     ├── 流程完成 → workflow_instance.status = COMPLETED             │
│     ├── form_data 最终快照归档                                        │
│     └── 支持后续查询、导出、统计                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.4 表单如何感知流程上下文

同一个表单在不同阶段（发起/审批/查看）以不同模式渲染，平台通过 `window.__LUBAN_WORKFLOW__.getContext()` 告知表单当前所处的上下文。

#### 4.4.1 三种渲染模式

| 模式 | `getContext().mode` | 触发场景 | 平台行为 |
|------|---------------------|---------|---------|
| **创建模式** | `'create'` | 用户点击"发起申请" | `autoFill()` 执行带入 → 所有字段可编辑（除非 `overwritable: false`） |
| **审批模式** | `'approve'` | 审批人打开待办 | `setFormData()` 回填数据 → `applyFieldPermissions()` 设置权限 → 不执行 `autoFill()`（除非 Schema 中 `triggerOn` 被触发） |
| **查看模式** | `'view'` | 查看已完成的流程 | `setFormData()` 回填数据 → 所有字段只读 → 不执行 `autoFill()` |

#### 4.4.2 上下文变量对表单行为的影响

| 上下文变量 | 创建模式 | 审批模式 | 查看模式 |
|-----------|---------|---------|---------|
| `instance_id` | `null` | 有值 | 有值 |
| `task_id` | `null` | 有值 | `null` |
| `current_user_id` | 发起人 | 审批人 | 查看者 |
| `autoFill` 执行 | ✅ 执行 | ❌ 不执行（但有 `triggerOn` 的字段在被依赖字段变化时执行） | ❌ 不执行 |
| `applyFieldPermissions` | ❌ 不执行 | ✅ 执行 | ✅ 全部只读 |

#### 4.4.3 审批模式下 autoFill 的特殊行为

审批模式下，`autoFill` 一般不执行（因为表单数据已回填）。但以下特殊场景仍会触发：

- 字段设置了 `triggerOn`，且被依赖的字段值在审批时可编辑 → 当审批人修改该字段时，触发重新查询带入
- 场景：审批人在审批时修改了"报销金额"字段，触发重新查询"部门预算"，以判断是否超预算

### 4.5 发起配置

#### 4.5.1 发起入口

- 在应用中嵌入"发起申请"按钮，按钮关联表单 ID
- 点击按钮后，前端执行：
  1. 根据 `form_id` 查询 `form_workflow_bindings` 获取关联的流程
  2. 如果一对多，弹出流程选择面板
  3. 加载表单 CodePage 代码，以 `mode='create'` 渲染
- 表单提交时，后端根据 `form_id` + `workflow_id` 创建流程实例

#### 4.5.2 发起权限

- 可配置哪些人/角色/部门可以发起该流程
- 发起权限配置在流程定义的"开始节点"属性中
- 无权限的用户看不到"发起申请"按钮

#### 4.5.3 发起频次

- 可配置是否允许同一人重复发起
- 如"同一合同只能发起一次审批"，重复发起时提示"该合同已有审批在进行中"
- 频次校验通过后端 `workflow_instances` 表查询实现

### 4.6 流程实例与表单数据

#### 4.6.1 数据快照

- 流程实例创建时，`form_data` 字段存储表单数据的 JSON 快照
- 每次审批操作后，更新 `form_data` 快照（如果审批人修改了可编辑字段）
- 流程结束时，`form_data` 为最终版本

#### 4.6.2 数据回填

- 驳回后发起人重新填写时，平台调用 `setFormData()` 回填上次提交的数据
- 草稿恢复时，从 `workflow_instances` 的 `form_data` 回填
- 回填时，`autoFill` 不执行（避免覆盖用户已填写的数据）

#### 4.6.3 数据查询

- 流程结束后，表单数据归档在 `workflow_instances.form_data` 中
- 支持按表单字段值查询流程实例（需在 `form_data` JSON 上建索引或使用 JSON 查询）
- 支持导出为 Excel/CSV

### 4.7 表单与流程的版本协同

```
表单版本 v1 ──绑定──→ 流程版本 v1（锁定）
表单版本 v2 ──绑定──→ 流程版本 v3（锁定）
表单版本 v3 ──绑定──→ 流程版本 latest（始终最新）

运行中的实例：
  instance_001: 表单=v1, 流程=v1  → 不受更新影响
  instance_002: 表单=v2, 流程=v3  → 不受更新影响
  instance_003: 表单=v3, 流程=v5  → 最新版本
```

**规则**：

- 表单发布新版本时，已绑定的流程不受影响
- 流程发布新版本时，如果绑定的是 `latest`，新发起的实例使用新版本
- 运行中的实例始终使用发起时的版本，不受后续发布影响
- 解除绑定后，表单可重新绑定到其他流程（或同一流程的其他版本）

### 4.8 关联管理的 API

| 操作 | API | 说明 |
|------|-----|------|
| 创建绑定 | `POST /api/v1/form-workflow-bindings` | `{ formId, workflowId, workflowVersion, bindingType, isDefault }` |
| 查询表单的流程 | `GET /api/v1/form-workflow-bindings?formId={id}` | 返回该表单绑定的所有流程 |
| 查询流程的表单 | `GET /api/v1/form-workflow-bindings?workflowId={id}` | 返回该流程绑定的所有表单 |
| 解除绑定 | `DELETE /api/v1/form-workflow-bindings/{id}` | 解除后不影响已发起的实例 |
| 设为默认 | `PUT /api/v1/form-workflow-bindings/{id}/default` | 一对多时标记默认流程 |

---

## 五、组织与人员管理

> **重要声明**：鲁班不维护自己的用户体系。用户身份完全来自外部平台（详见 2.5.10），本章描述的是**组织结构同步**和**人员数据本地缓存**的机制。

### 5.1 身份提供商适配层

#### 5.1.1 架构概览

```
外部平台（钉钉/飞书/企微/LDAP）
    │
    │  ① 身份认证（登录时）        ② 组织同步（定时/手动）
    ↓                              ↓
┌──────────────────────────────────────────────────┐
│              IdentityProvider 接口                │
│                                                  │
│  authenticate(code) → UserContext                │
│  syncDepartments() → Department[]                │
│  syncMembers(departmentId) → Member[]             │
│  getUserById(id) → UserContext                   │
│  searchMembers(keyword) → Member[]                │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ DingTalk │  │ Feishu   │  │ WeCom    │  ...  │
│  │ Provider │  │ Provider │  │ Provider │       │
│  └──────────┘  └──────────┘  └──────────┘       │
└──────────────────────────────────────────────────┘
    │                    │
    ↓                    ↓
┌──────────────┐  ┌──────────────────┐
│ UserContext  │  │ 本地持久化表       │
│ (运行时，JWT) │  │ departments      │
│ autoFill 用  │  │ members          │
│ Agent 代码用  │  │ 审批人查找用       │
└──────────────┘  └──────────────────┘
```

**两层设计**：

| 层级 | 用途 | 数据来源 | 生命周期 |
|------|------|---------|---------|
| **UserContext（运行时）** | `autoFill` 带入、Agent 代码中获取当前用户信息 | 每次登录时从平台实时获取，存入 JWT | 会话级别，登出即失效 |
| **Member/Department（持久化）** | 审批人查找、组织架构浏览、人员搜索、角色判定 | 定时从平台同步到本地数据库 | 持久化，与平台保持同步 |

#### 5.1.2 IdentityProvider 接口定义

```typescript
interface IdentityProvider {
  // 提供商标识
  readonly type: 'dingtalk' | 'feishu' | 'wecom' | 'ldap' | 'oidc' | 'local';

  // ===== 认证 =====
  authenticate(credential: AuthCredential): Promise<UserContext>;
  // 根据平台返回的授权码/票据，获取用户身份并映射为 UserContext

  // ===== 组织同步 =====
  syncDepartments(): Promise<Department[]>;
  // 从平台拉取完整组织架构树

  syncMembers(departmentId?: string): Promise<Member[]>;
  // 从平台拉取人员列表（可按部门过滤）

  // ===== 用户查询 =====
  getUserById(userId: string): Promise<UserContext | null>;
  // 根据用户 ID 查询用户信息（用于审批人显示等场景）

  searchMembers(keyword: string): Promise<Member[]>;
  // 搜索人员（用于流程设计时选择审批人）

  // ===== 健康检查 =====
  healthCheck(): Promise<boolean>;
  // 验证平台连接是否正常
}
```

#### 5.1.3 各平台实现要点

| 平台 | 认证方式 | 组织同步 API | 注意事项 |
|------|---------|-------------|---------|
| **钉钉** | 钉钉内免登 / OAuth 2.0 扫码 | `topapi/v2/department/listsub` + `topapi/v2/user/list` | 需申请 `qyapi_contact` 权限；部门接口需递归调用；用户接口分页获取 |
| **飞书** | OAuth 2.0（应用商店/企业自建） | `GET /open-apis/contact/v3/departments` + `GET /open-apis/contact/v3/users` | 需申请 `contact:contact:readonly` 权限；支持部门批量获取；用户字段需手动指定 |
| **企业微信** | OAuth 2.0 | `cgi-bin/department/list` + `cgi-bin/user/list` + `cgi-bin/user/get` | 需配置可信域名；部门 ID 需递归获取；敏感字段需额外授权 |
| **LDAP** | 用户名密码绑定 | JNDI/LDAP 查询 `ou=users` | 需配置 Base DN、搜索过滤器；属性映射需手动配置 |
| **OIDC** | 标准 OIDC 流程 | 无（组织同步需额外配置，或通过 API 手动导入） | 用户字段映射通过 claims 配置 |
| **本地模式** | 用户名+密码本地验证 | 无需同步，数据在本地 | 开箱即用，预置测试用户和组织架构；详见 5.6 |

### 5.2 外部同步方式

| 同步方式 | 说明 | 适用场景 |
|---------|------|---------|
| **定时同步** | 每 N 分钟自动从平台拉取组织架构和人员变动 | 所有平台推荐方式（默认 30 分钟） |
| **事件回调** | 平台在人员变动时主动推送事件（如钉钉"通讯录变更事件"） | 需要近乎实时的同步（钉钉/飞书/企微均支持） |
| **手动同步** | 管理员在后台点击"立即同步" | 调试、紧急更新 |
| **API 推送** | 外部系统通过 REST API 推送人员数据 | 自定义 HR 系统、OIDC 无组织同步能力时 |
| **手动导入** | 支持 Excel/CSV 批量导入 | 小团队快速试用、无外部平台时 |

**同步策略**：

```
定时同步（全量）  +  事件回调（增量）
      │                    │
      ↓                    ↓
  每 30 分钟           实时推送
  拉取全量组织架构      部门/人员变更
      │                    │
      └────────┬───────────┘
               ↓
        本地数据库更新
        departments / members
               │
               ↓
        审批人查找、组织搜索
        始终使用本地数据（不实时调用平台 API）
```

### 5.3 数据模型

本地持久化的组织人员数据结构（最小化，与平台无关）：

```
组织（Department）
├── id              VARCHAR(64) PK  // 平台返回的部门 ID
├── name            VARCHAR(255)    // 部门名称
├── parentId        VARCHAR(64)     // 上级部门 ID
├── externalId      VARCHAR(128)    // 外部系统原始 ID（如钉钉 dept_id）
├── provider        VARCHAR(20)     // 来源平台（dingtalk/feishu/wecom/ldap）
├── path            VARCHAR(1024)   // 部门路径（如 "/总公司/研发部/前端组"）
├── order           INT             // 排序
├── managerId       VARCHAR(64)     // 部门负责人 ID（同步自平台，可为空）
└── syncedAt        DATETIME        // 最后同步时间

人员（Member）
├── id              VARCHAR(64) PK  // 平台返回的用户 ID（如钉钉 userid）
├── lubanUserId     BIGINT          // 关联鲁班用户 ID（首次登录时自动创建）
├── name            VARCHAR(255)    // 姓名
├── email           VARCHAR(255)    // 邮箱（可为空）
├── mobile          VARCHAR(32)     // 手机号（可为空）
├── avatar          VARCHAR(512)    // 头像 URL（可为空）
├── departmentId    VARCHAR(64)     // 所属部门 ID
├── departmentName  VARCHAR(255)    // 部门名称（冗余，加速查询）
├── position        VARCHAR(255)    // 职位
├── employeeNo      VARCHAR(64)     // 工号（可为空）
├── leaderId        VARCHAR(64)     // 直属上级 ID（平台返回的 userid）
├── provider        VARCHAR(20)     // 来源平台
├── status          VARCHAR(20)     // ACTIVE / INACTIVE（离职后标记为 INACTIVE）
├── syncedAt        DATETIME        // 最后同步时间
```

**关键设计决策**：

- `id` 直接使用平台返回的原始 ID（如钉钉的 `userid`、飞书的 `open_id`），不自增，确保与平台一一对应
- `lubanUserId` 关联鲁班用户表，首次登录时自动创建，后续登录复用
- `departmentName` 冗余存储，避免每次查询都 JOIN 部门表
- `status` 标记离职人员，流程中若有离职人员作为审批人，自动触发升级策略

### 5.4 角色定义

| 角色类型 | 解析方式 | 数据来源 |
|---------|---------|---------|
| **部门负责人** | 流程运行时，根据发起人 `departmentId` 查 `departments.managerId` | 同步自平台（钉钉/飞书/企微均支持部门负责人字段） |
| **直属上级** | 流程运行时，根据发起人 `leaderId` 查 `members` 表 | 同步自平台（钉钉/飞书/企微均支持直属上级字段） |
| **指定人员** | 流程设计时写死用户 ID | 从 `members` 表搜索选择 |
| **指定角色** | 自定义角色组（如"财务审批组"），成员从 `members` 表勾选 | 鲁班内部维护，与平台角色无关 |
| **动态脚本** | 执行自定义 Groovy/JS 脚本，返回审批人列表 | 可调用 `members` 表、`departments` 表、平台 API |

### 5.5 与 autoFill 的关系

`current_user` 的 autoFill 使用**运行时 UserContext**（来自 JWT），而非持久化的 Member 表：

- **登录时**：平台返回用户信息 → IdentityProvider 映射为 UserContext → 存入 JWT
- **autoFill 时**：直接从 JWT 解析 UserContext，无需查数据库，响应极快
- **组织信息变更时**：用户重新登录后 JWT 中的 UserContext 才会更新；Member 表同步更新后，审批人查找等后台逻辑使用最新数据

**常见场景的时间线**：

```
T+0:  用户 A 登录 → JWT 中包含 UserContext（部门=研发部）
T+5:  管理员修改用户 A 的部门为"产品部"（在钉钉后台操作）
T+10: 定时同步触发 → Member 表更新（部门=产品部）
T+15: 用户 A 发起请假 → autoFill 部门=研发部（JWT 中的旧值）
      → 审批人查找使用 Member 表（部门=产品部，找到产品部负责人）
```

**结论**：autoFill 使用 JWT 中的值（不实时），但审批人查找使用 Member 表（准实时）。这是有意为之的权衡——autoFill 的数据即时性要求不高，但审批人查找必须准确。如果用户部门变更，建议用户重新登录即可刷新 JWT。

### 5.6 内置测试模式（无外部平台时）

> **核心问题**：如果我没有钉钉、飞书、企业微信等第三方平台，如何测试设计出的流程？如何验证审批流程能否正确流转？

**答案**：鲁班内置一套**本地身份模拟系统**，专为开发测试场景设计，无需任何外部平台即可完成完整的流程测试。

#### 5.6.1 设计目标

| 目标 | 说明 |
|------|------|
| **零依赖** | 无需钉钉、飞书、企微、LDAP 等任何外部平台 |
| **开箱即用** | 首次启动自动创建预置测试用户和组织架构 |
| **完整闭环** | 支持从发起申请 → 逐级审批 → 驳回/通过 → 归档的完整流程测试 |
| **多用户模拟** | 可在不同测试用户之间快速切换，模拟不同角色的审批操作 |
| **不影响生产** | 测试模式与外部平台模式数据隔离，切换后数据不互通 |

#### 5.6.2 身份提供商：`local`

在 `IdentityProvider` 接口中新增 `local` 类型，作为内置的本地身份模拟器：

```typescript
// 身份提供商类型扩展
type IdentityProviderType = 'dingtalk' | 'feishu' | 'wecom' | 'ldap' | 'oidc' | 'local';
```

**`local` 提供商的特点**：

| 特性 | 说明 |
|------|------|
| **认证方式** | 用户名+密码（本地验证），或选择预置用户直接登录 |
| **用户数据** | 预置一套完整的测试组织架构，管理员可增删改 |
| **组织同步** | 不需要同步，数据就在本地 |
| **适用场景** | 开发调试、功能演示、无外部平台的小团队试用 |

#### 5.6.3 预置测试组织架构

系统首次启动时，自动创建以下测试数据：

```
测试公司
├── 技术部（部门负责人：张三）
│   ├── 张三（zhangsan） — 技术总监，角色：部门负责人
│   ├── 李四（lisi）     — 前端开发，直属上级：张三
│   └── 王五（wangwu）   — 后端开发，直属上级：张三
├── 财务部（部门负责人：赵六）
│   ├── 赵六（zhaoliu）  — 财务总监，角色：部门负责人
│   └── 钱七（qianqi）   — 会计，直属上级：赵六
├── 人事部（部门负责人：孙八）
│   └── 孙八（sunba）    — HR 总监，角色：部门负责人
└── 总经办（部门负责人：周九）
    └── 周九（zhoujiu）  — 总经理，角色：部门负责人
```

**预置角色**：

| 角色名称 | 角色标识 | 成员 | 典型用途 |
|---------|---------|------|---------|
| 部门负责人 | `role_dept_manager` | 张三、赵六、孙八、周九 | 审批节点配置"部门负责人" |
| 财务审批组 | `role_finance` | 赵六、钱七 | 审批节点配置"指定角色→财务审批组" |
| HR 审批组 | `role_hr` | 孙八 | 审批节点配置"指定角色→HR 审批组" |
| 高管审批组 | `role_executive` | 周九 | 审批节点配置"指定角色→高管审批组" |

**预置用户密码**：所有预置用户默认密码为 `luban123`，首次登录后强制修改。

#### 5.6.4 身份提供商配置

在应用设置中，身份提供商选择"本地模式"：

```
┌─────────────────────────────────────────────────────────┐
│  身份提供商配置                                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  提供商类型：                                            │
│  ○ 钉钉  ○ 飞书  ○ 企业微信  ○ LDAP  ○ OIDC            │
│  ● 本地模式（无需外部平台）                               │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ℹ️ 本地模式说明                                  │    │
│  │                                                 │    │
│  │ 本地模式使用内置用户系统，无需对接任何外部平台。    │    │
│  │ 适用于：                                        │    │
│  │  • 开发调试：快速验证流程设计是否正确             │    │
│  │  • 功能演示：向客户展示流程功能                   │    │
│  │  • 小团队试用：无需外部平台即可体验完整功能       │    │
│  │                                                 │    │
│  │ ⚠️ 注意：本地模式仅适用于测试和演示，生产环境      │    │
│  │    请切换到钉钉/飞书/企微等正式身份提供商。       │    │
│  │    切换身份提供商后，原有流程数据保留，但用户       │    │
│  │    身份将重新映射。                              │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  [保存配置]                                              │
└─────────────────────────────────────────────────────────┘
```

#### 5.6.5 测试用户管理

管理员可在后台管理测试用户：

```
┌─────────────────────────────────────────────────────────┐
│  测试用户管理                                    [+ 添加] │
├─────────────────────────────────────────────────────────┤
│  🔍 [搜索用户名称/账号_________]                         │
├─────────────────────────────────────────────────────────┤
│  用户名    │ 姓名  │ 部门     │ 职位       │ 角色        │
│───────────┼───────┼─────────┼───────────┼────────────│
│  zhangsan │ 张三  │ 技术部   │ 技术总监   │ 部门负责人   │
│  lisi     │ 李四  │ 技术部   │ 前端开发   │ —           │
│  wangwu   │ 王五  │ 技术部   │ 后端开发   │ —           │
│  zhaoliu  │ 赵六  │ 财务部   │ 财务总监   │ 财务审批组   │
│  qianqi   │ 钱七  │ 财务部   │ 会计       │ 财务审批组   │
│  sunba    │ 孙八  │ 人事部   │ HR 总监    │ HR 审批组    │
│  zhoujiu  │ 周九  │ 总经办   │ 总经理     │ 高管审批组   │
└─────────────────────────────────────────────────────────┘
```

**支持操作**：
- 添加/删除测试用户
- 修改用户部门、职位、直属上级
- 将用户加入/移出自定义角色
- 重置用户密码
- 批量导入用户（CSV）

#### 5.6.6 多用户模拟切换

在测试模式下，用户可在不同身份之间快速切换，模拟完整的审批流程：

```
┌─────────────────────────────────────────────────────────┐
│  当前用户：李四（lisi）— 技术部 — 前端开发          [▼] │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 切换用户：                                      │    │
│  │  ○ 张三（zhangsan）— 技术部 — 技术总监          │    │
│  │  ● 李四（lisi）    — 技术部 — 前端开发          │    │
│  │  ○ 王五（wangwu）  — 技术部 — 后端开发          │    │
│  │  ○ 赵六（zhaoliu） — 财务部 — 财务总监          │    │
│  │  ○ 周九（zhoujiu） — 总经办 — 总经理            │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**切换行为**：
- 切换用户后，页面刷新，当前身份变为所选用户
- 待办列表、已办列表、发起权限等随身份切换变化
- 顶部栏始终显示当前模拟的用户名，并有明显标识（如橙色边框 + "测试模式"标签）
- 此功能仅在 `local` 模式下可用，切换到外部平台后隐藏

**典型测试流程**：

```
1. 以"李四"身份登录 → 发起请假申请 → 提交
2. 切换到"张三"身份（李四的直属上级）→ 待办列表出现请假审批 → 审批通过
3. 切换到"周九"身份（总经理）→ 待办列表出现请假审批 → 审批通过
4. 流程结束 → 查看归档记录
```

#### 5.6.7 测试模式标识

在测试模式下，全局显示醒目的提示，防止误操作：

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ⚠️ 测试模式 · 当前使用本地用户系统 · 数据仅供测试，请勿用于生产环境    [×] │
└──────────────────────────────────────────────────────────────────────────┘
```

- 所有页面顶部固定显示黄色/橙色提示条
- 用户头像区域显示"测试"标签
- 流程实例数据标记 `is_test=true`，便于后续清理

#### 5.6.8 从本地模式迁移到外部平台

当团队准备好接入外部平台时，迁移步骤如下：

```
步骤 1：在身份提供商配置中切换到目标平台（如钉钉）
        ↓
步骤 2：配置平台凭证（AppKey/AppSecret），测试连接
        ↓
步骤 3：执行首次组织同步 → 拉取真实组织架构和人员
        ↓
步骤 4：用户映射
        ├── 自动映射：邮箱/手机号相同的用户自动关联
        ├── 手动映射：管理员手动关联测试用户与真实用户
        └── 未映射：测试用户标记为"未映射"，保留历史数据但不可登录
        ↓
步骤 5：测试流程是否正常流转
        ↓
步骤 6：确认无误后，关闭测试模式提示条
```

**数据保留策略**：
- 测试模式下创建的流程定义、表单定义**保留**（这些是设计成果，不依赖用户体系）
- 测试模式下创建的流程实例**保留**（标记为测试数据，可批量清理）
- 测试用户数据在迁移后**不删除**，但禁止登录（仅外部平台用户可登录）

#### 5.6.9 测试模式与流程设计器

在测试模式下，流程设计器中的审批人选择器可以直接选择预置的测试用户和角色：

```
审批人配置（测试模式）：

┌─────────────────────────────────────┐
│  审批人                              │
│                                     │
│  审批人类型：                        │
│  ● 指定人员  ○ 指定角色  ○ 部门负责人 │
│  ○ 直属上级  ○ 表单字段  ○ 动态脚本   │
│                                     │
│  已选人员：                          │
│  ┌──────────────────────────────┐   │
│  │ 张三（技术部·技术总监）  [×]  │   │
│  │ 赵六（财务部·财务总监）  [×]  │   │
│  └──────────────────────────────┘   │
│  [+ 选择人员]                        │
│                                     │
│  ┌──────────────────────────────┐   │
│  │ 选择人员（测试模式）          │   │
│  │ 🔍 [搜索_________]           │   │
│  │                              │   │
│  │ ▼ 技术部                     │   │
│  │   ☑ 张三（技术总监）         │   │
│  │   ☐ 李四（前端开发）         │   │
│  │   ☐ 王五（后端开发）         │   │
│  │ ▼ 财务部                     │   │
│  │   ☑ 赵六（财务总监）         │   │
│  │   ☐ 钱七（会计）             │   │
│  │ ▼ 人事部                     │   │
│  │   ☐ 孙八（HR 总监）          │   │
│  │ ▼ 总经办                     │   │
│  │   ☐ 周九（总经理）           │   │
│  │                              │   │
│  │ [确定]  [取消]               │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

---

## 六、AI Agent 架构设计

### 6.1 智能体体系总览

在现有主智能体和数据辅助智能体的基础上，新增**工作流设计智能体**。三个智能体各司其职，通过 ChatRouter 委派机制相互协作。

#### 6.1.1 智能体定义

| 智能体 | ID | 图标 | 职责 | 核心能力 |
|--------|-----|------|------|---------|
| **主智能体** | `main-agent` | 🤖 | 页面设计、代码生成、任务编排 | 管理页面 CRUD、编排查询、生成 HTML/CSS/JS |
| **数据辅助智能体** | `data-assistant` | 📊 | 数据源连接、查询创建与调试 | 查看表结构、编写 SQL、执行测试 |
| **工作流设计智能体** | `workflow-designer` | 🔀 | 表单设计、流程设计、表单-流程关联 | 创建表单字段、设计审批节点、配置条件分支、绑定表单与流程 |

#### 6.1.2 为什么不分拆为"表单设计智能体"和"流程设计智能体"

**结论：不分拆，合并为一个智能体。**

理由：

| 考量维度 | 分析 |
|---------|------|
| **业务耦合度** | 表单字段直接决定流程路由（条件分支表达式引用表单字段），字段权限按流程节点配置，两者在设计阶段强耦合 |
| **用户心智** | 用户描述需求时不会区分"这是表单需求"还是"这是流程需求"，通常一句话同时包含两者（如"报销金额超过 5000 需要总监审批"） |
| **上下文连续性** | 同一个智能体持有表单和流程的完整上下文，能自动处理关联逻辑（如新增字段时自动提示是否需要更新条件分支），拆分后需额外传递上下文 |
| **维护成本** | 一个 Skill + 一套 Tools 维护成本低，拆成两个需要维护两套 prompt、两套工具、两套上下文传递逻辑 |
| **与角色对齐** | 产品层面已将"表单设计者"和"流程设计者"合并为"流程设计者"一个角色，Agent 层面应保持一致 |

### 6.2 智能体交互关系

#### 6.2.1 调用关系图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ChatRouter（路由中枢）                          │
│                                                                         │
│  用户输入 ──→ 路由判断 ──→ 目标智能体                                     │
│              │                                                          │
│              ├── "@数据辅助" / 数据相关 → data-assistant                   │
│              ├── "@工作流" / 表单流程相关 → workflow-designer               │
│              └── 默认（页面/代码相关） → main-agent                        │
└─────────────────────────────────────────────────────────────────────────┘

智能体间委派（通过 ChatRouter.routeTo）：

  ┌──────────────┐        find_query / design_workflow        ┌──────────────────────┐
  │              │ ──────────────────────────────────────────→ │                      │
  │  主智能体     │                                             │  工作流设计智能体       │
  │  main-agent  │ ←─ 返回结果 ─────────────────────────────── │  workflow-designer   │
  │              │                                             │                      │
  └──────┬───────┘                                             └──────────┬───────────┘
         │                                                                │
         │ find_query                                                     │ list_queries
         │ (委派)                                                          │ (直接调用，不委派)
         ↓                                                                ↓
  ┌──────────────┐                                             ┌──────────────────────┐
  │              │                                             │                      │
  │ 数据辅助智能体 │ ←── 工作流智能体不直接委派数据辅助 ────        │  luban-workflow API  │
  │ data-assistant│                                             │  (后端 CRUD)          │
  │              │                                             │                      │
  └──────────────┘                                             └──────────────────────┘
```

#### 6.2.2 委派规则

| 委派方 | 被委派方 | 触发条件 | 机制 |
|--------|---------|---------|------|
| **主智能体** → 数据辅助 | 需要创建查询 | 主智能体调用 `find_query` 工具 → 内部 `chatRouter.routeTo('data-assistant', ...)` | 同步委派，等待返回 |
| **主智能体** → 工作流设计 | 需要设计表单/流程 | 主智能体调用 `design_workflow` 工具 → 内部 `chatRouter.routeTo('workflow-designer', ...)` | 同步委派，等待返回 |
| **工作流设计** → 数据辅助 | 表单字段需要动态数据源（如下拉选项来自数据库） | ⚠️ **不委派**，工作流智能体自行调用 `list_queries` 等 API 查询现有数据，如需新建查询，**返回给主智能体，由主智能体委派数据辅助** | 间接调用 |
| 用户 → 任意智能体 | 用户 @提及 或 AgentPanel 切换 | `ChatRouter.route()` 根据 `@智能体名称` 或下拉选择路由 | 直接路由 |

#### 6.2.3 关键设计决策：工作流智能体不直接委派数据辅助

工作流智能体**不直接调用** `chatRouter.routeTo('data-assistant', ...)`，原因：

1. **职责清晰**：主智能体是唯一编排者，负责跨智能体协调。工作流智能体只管理表单和流程，不跨界调度其他智能体
2. **避免循环委派**：如果工作流智能体也能委派数据辅助，数据辅助再返回结果，链路变长，出错难排查
3. **实际场景罕见**：表单设计时极少需要从零创建数据库查询。绝大多数场景是：
   - 表单字段使用静态选项（如"请假类型：年假/事假/病假"）→ 不需要数据辅助
   - 表单字段需要动态数据源（如"所属部门"下拉从部门表查询）→ 这类查询通常已在主智能体设计页面时由数据辅助创建好，工作流智能体只需 `list_queries` 查找已有查询并引用
   - 万一需要新建查询 → 工作流智能体在回复中告知主智能体"还需要创建一个查询用于 XX 字段"，主智能体接手委派

#### 6.2.4 页面上下文路由策略

> **核心问题**：主智能体会"获取当前页面来进行设计"。在流程设计器页面中，用户能否使用主智能体？主智能体和工作流设计智能体如何协作？

**答案：可以使用主智能体，但默认路由会因页面上下文而不同。**

##### 6.2.4.1 路由决策依据

ChatRouter 的最终路由目标由两个因素共同决定：

```
最终路由 = 页面上下文优先级 + 用户输入意图
```

| 因素 | 权重 | 说明 |
|------|------|------|
| **页面上下文** | 优先 | 当前页面 URL 决定默认智能体，无需用户每次 @提及 |
| **用户输入意图** | 覆盖 | 用户显式 @提及 或输入内容包含特定关键词时，覆盖页面上下文默认值 |

##### 6.2.4.2 各页面的默认智能体

| 用户所在页面 | 默认智能体 | 原因 |
|-------------|-----------|------|
| 普通页面（CRUD 页面、自定义页面等） | 主智能体 `main-agent` | 页面设计、代码生成是主智能体的职责 |
| 流程设计器页面 `/workflows/:wid/designer` | **工作流设计智能体** `workflow-designer` | 用户在流程设计器中的操作（添加节点、配置审批人）天然属于工作流设计范畴 |
| 表单预览页面 `/forms/:fid/preview` | 工作流设计智能体 `workflow-designer` | 表单预览与调整属于表单设计范畴 |
| 待办/已办/发起页面 | 主智能体 `main-agent` | 这些是普通页面，与流程设计无关 |

##### 6.2.4.3 用户在流程设计器页面中使用主智能体的场景

虽然默认路由到工作流设计智能体，但用户**仍然可以使用主智能体**，典型场景：

| 场景 | 操作方式 | 处理逻辑 |
|------|---------|---------|
| 需要在流程设计器中同时调整页面布局 | 输入 `@主智能体 帮我在页面顶部加一个统计卡片` | ChatRouter 检测到 `@主智能体`，直接路由到主智能体 |
| 需要查询数据库中的数据 | 输入 `@数据辅助 查询本月报销总额` | ChatRouter 检测到 `@数据辅助`，直接路由到数据辅助智能体 |
| 工作流设计智能体遇到需要主智能体协助的问题 | 工作流智能体在回复中告知用户"请 @主智能体 处理 XX" | 用户按提示操作 |
| 主智能体主动委派 | 用户在普通页面说"我要设计一个请假流程"，主智能体通过 `design_workflow` 工具委派给工作流设计智能体 | 内部委派，用户无感知 |

##### 6.2.4.4 页面上下文传递

当主智能体通过 `design_workflow` 工具委派给工作流设计智能体时，主智能体会自动传递当前页面上下文：

```typescript
// 主智能体调用 design_workflow 工具时，自动附带页面上下文
{
  tool: 'design_workflow',
  input: {
    task: '设计一个报销审批流程',
    context: {
      currentPage: '/workspace/123/page/456',  // 用户当前所在页面
      pageName: '报销管理',
      relatedQueries: ['query_monthly_expense'],  // 当前页面已有的查询
      relatedCodePages: ['code_page_reimbursement_form'],  // 当前页面已有的代码
    }
  }
}
```

工作流设计智能体收到上下文后：
- 如果表单字段需要引用当前页面已有的查询，直接使用 `relatedQueries` 中的查询
- 如果需要在当前页面嵌入流程发起按钮，参考 `relatedCodePages` 中的代码风格
- 完成后将结果返回给主智能体，主智能体负责更新当前页面（如添加"发起流程"按钮）

##### 6.2.4.5 智能体切换的用户体验

```
用户在流程设计器页面：

┌─────────────────────────────────────────────────────┐
│  AgentPanel                                    [×]  │
├─────────────────────────────────────────────────────┤
│  🔀 工作流设计智能体                          [▼]    │  ← 默认显示工作流设计智能体
│  ┌─────────────────────────────────────────────┐    │
│  │ 下拉可切换：                                │    │
│  │  🤖 主智能体                                │    │
│  │  📊 数据辅助智能体                           │    │
│  │  🔀 工作流设计智能体 ✓                      │    │  ← 当前选中
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  用户：帮我加一个总监审批节点，需要会签               │
│                                                     │
│  🔀 工作流设计智能体：                              │
│  好的，我已添加"总监审批"节点，审批模式设为会签。    │
│  审批人已配置为角色"总监"。                          │
│                                                     │
│  用户：@主智能体 帮我在页面顶部加一个统计卡片         │
│                                                     │
│  🤖 主智能体：                                     │
│  好的，我在页面顶部添加了统计卡片，显示本月报销总额。 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**关键行为**：
- AgentPanel 下拉框默认显示当前页面上下文的默认智能体
- 用户可随时通过下拉框切换智能体，或通过 `@智能体名称` 临时切换
- 切换智能体后，后续对话在当前智能体下继续，直到用户再次切换
- `@智能体名称` 仅对当前一条消息生效，不影响后续消息的默认智能体

### 6.3 工作流设计智能体定义

```typescript
// frontend/src/agent/registry/agentRegistry.ts 中新增

{
  id: 'workflow-designer',
  name: '工作流设计',
  icon: '🔀',
  description: '工作流设计智能体，负责设计表单、构建审批流程、关联表单与流程',
  isDefault: false,
  buildSystemPrompt: (ctx) => buildWorkflowDesignerPrompt(ctx),
  buildTools: (ctx) => createWorkflowTools(ctx),
}
```

#### 6.3.1 System Prompt 核心内容

```
你是工作流设计智能体，负责设计表单和审批流程。

## 你的能力范围
- 设计表单：创建表单、添加/修改/删除字段、配置校验规则和显隐条件
- 设计流程：创建审批流、添加节点（审批/条件分支/并行/子流程）、配置连线
- 配置协作模式：会签/或签/按比例通过/依次审批
- 配置字段权限：按节点设置字段的可见/可编辑/隐藏/脱敏
- 配置驳回策略、SLA 时限
- 关联表单与流程
- 校验流程完整性

## 你不能做的事
- 不能操作页面（那是主智能体的职责）
- 不能创建查询或连接数据源（那是数据辅助智能体的职责）
- 不能跨智能体调度（只有主智能体有这个权限）

## 工作流程
1. 收到需求后，先判断是纯表单设计、纯流程设计、还是表单+流程联动
2. 表单设计：先创建表单，再逐个添加字段，最后预览
3. 流程设计：先创建流程骨架，再添加节点，配置节点属性和连线
4. 表单+流程联动：先设计表单，再设计流程，最后关联
5. 完成后汇报结果，如有需要主智能体协助的事项，在回复中明确说明

## 行为准则
- 需求不明确时主动提问
- 创建流程后自动调用 validate_workflow 校验
- 回答使用中文
```

### 6.4 新增工具（Tools）

在现有 Agent 框架基础上，工作流设计智能体拥有以下专属工具：

| 工具名称 | 功能 | 分类 |
|---------|------|------|
| `create_form` | 创建表单（同时创建 CodePage 存储表单代码 + form_definition 存储字段 Schema） | 表单 |
| `update_form_field` | 更新字段 Schema（fields JSON），同时更新 CodePage 中的 HTML/CSS/JS | 表单 |
| `delete_form_field` | 删除字段 Schema 中的字段，同时更新 CodePage 代码 | 表单 |
| `get_form` | 获取表单完整定义（含 CodePage 代码 + 字段 Schema） | 表单 |
| `preview_form` | 打开表单预览面板（渲染 CodePage 代码） | 表单 |
| `list_forms` | 列出工作区下所有表单 | 表单 |
| `create_workflow` | 创建流程定义 | 流程 |
| `update_workflow_node` | 修改流程节点属性 | 流程 |
| `add_workflow_node` | 添加流程节点 | 流程 |
| `delete_workflow_node` | 删除流程节点 | 流程 |
| `get_workflow` | 获取流程完整定义 | 流程 |
| `list_workflows` | 列出工作区下所有流程 | 流程 |
| `bind_form_workflow` | 关联表单与流程 | 关联 |
| `unbind_form_workflow` | 解除表单与流程关联 | 关联 |
| `get_form_workflow_bindings` | 查询表单关联的流程（或反向） | 关联 |
| `validate_workflow` | 校验流程完整性 | 校验 |
| `search_member` | 搜索组织人员（用于配置审批人） | 组织 |
| `search_department` | 搜索部门 | 组织 |
| `list_queries` | 列出应用下的查询（用于表单字段绑定动态数据源） | 查询 |

### 6.5 主智能体新增工具

主智能体新增一个桥接工具，用于将工作流设计需求委派给工作流设计智能体：

| 工具名称 | 功能 | 说明 |
|---------|------|------|
| `design_workflow` | 委派工作流设计任务给工作流设计智能体 | 类似 `find_query` 委派给数据辅助的模式，内部调用 `chatRouter.routeTo('workflow-designer', ...)` |

```typescript
// 伪代码示意
function createDesignWorkflowTool(context: ToolContext, chatRouter: ChatRouter): ToolDefinition {
  return {
    name: 'design_workflow',
    description: `向工作流设计智能体请求设计表单或审批流程。
使用时机：用户需要创建表单、设计审批流程、关联表单与流程。
主智能体不知道表单字段类型和审批节点配置，调用此工具让工作流设计智能体自行完成。`,
    parameters: {
      type: 'object',
      properties: {
        task_type: {
          type: 'string',
          enum: ['form_only', 'workflow_only', 'form_and_workflow'],
          description: '任务类型：form_only=仅设计表单，workflow_only=仅设计流程，form_and_workflow=表单+流程联动',
        },
        requirements: {
          type: 'array',
          items: { type: 'string' },
          description: '设计需求列表，用业务语言描述',
        },
        target_form_id: {
          type: 'number',
          description: '要修改的已有表单 ID（修改场景时提供）',
        },
        target_workflow_id: {
          type: 'number',
          description: '要修改的已有流程 ID（修改场景时提供）',
        },
      },
      required: ['task_type', 'requirements'],
    },
    async execute(args) {
      // 内部：chatRouter.routeTo('workflow-designer', userMessage, sessionId, {
      //   systemPrompt: buildWorkflowDesignerPrompt(...),
      //   tools: createWorkflowTools(...),
      // })
    },
  };
}
```

### 6.6 新增技能（Skills）

| 技能名称 | 归属智能体 | 说明 |
|---------|-----------|------|
| **工作流设计技能** | workflow-designer | 指导工作流智能体如何设计表单（字段类型选择、校验规则推荐）、如何设计审批流（协作模式选择、条件分支配置）、如何关联表单与流程 |
| **流程诊断技能** | workflow-designer | 检查已有流程的问题（死循环、孤立节点、处理人缺失、分支未覆盖），给出优化建议 |

### 6.7 典型对话场景

#### 场景一：用户直接 @工作流设计（从零搭建请假流程）

```
用户：@工作流设计 帮我做一个请假申请，3天以内部门经理审批，超过3天需要总监审批

路由：ChatRouter 识别 "@工作流设计" → 直接路由到 workflow-designer

工作流设计智能体：
  好的，我来帮你搭建请假流程。
  
  第一步：创建请假申请表单
  - 调用 create_form("请假申请")
  - 调用 update_form_field 添加：请假类型（下拉：年假/事假/病假/婚假）、开始时间、结束时间、
    请假天数（自动计算）、请假原因（多行文本）
  - 调用 preview_form 打开预览
  
  第二步：创建审批流程
  - 调用 create_workflow("请假审批")
  - 调用 add_workflow_node 添加：开始节点 → 条件分支 → 部门经理审批 → 总监审批 → 结束节点
  - 配置条件分支：请假天数 ≤ 3 → 部门经理审批；> 3 → 部门经理审批 → 总监审批
  - 调用 validate_workflow 校验
  
  第三步：关联表单与流程
  - 调用 bind_form_workflow 绑定
  
  全部完成！你可以在预览中查看效果。是否需要调整？
```

#### 场景二：主智能体委派工作流设计

```
用户（在主智能体对话中）：我的应用需要一个员工入职审批流程

主智能体分析：
  这涉及表单和流程设计，我不擅长这个，需要委派给工作流设计智能体。
  
主智能体调用 design_workflow({
  task_type: 'form_and_workflow',
  requirements: [
    '员工入职申请表单，包含：姓名、部门、职位、入职日期、薪资建议',
    '部门负责人审批，薪资超过2万需要HR总监加签',
    '审批通过后通知IT部门开通账号'
  ]
})

→ ChatRouter.routeTo('workflow-designer', ...) → 工作流设计智能体执行 → 返回结果

主智能体收到结果后：
  工作流设计智能体已完成员工入职审批流程的搭建，包含：
  - 入职申请表单（5个字段）
  - 三级审批流程（部门负责人 → 条件分支 → HR总监）
  - 表单与流程已关联
  
  你可以在应用中嵌入"发起入职申请"页面来使用这个流程。是否需要我帮你创建这个页面？
```

#### 场景三：工作流智能体需要查询，但不直接委派数据辅助

```
用户：@工作流设计 表单里"所属部门"字段的下拉选项要从数据库部门表读取

工作流设计智能体：
  我先查一下当前应用下有没有可用的查询。
  → 调用 list_queries → 发现已有 "部门列表" 查询，可以直接引用
  
  已将"所属部门"字段的数据源绑定到"部门列表"查询。
  
  （如果 list_queries 没有找到）
  
  当前应用下没有部门列表查询，需要主智能体协助创建。
  请切换到主智能体，告诉它"创建一个部门列表查询，返回 id 和 name"，
  创建完成后我再绑定。
  
  ⚠️ 注意：我不会直接委派数据辅助智能体，这是主智能体的职责。
```

### 6.8 智能体切换机制

沿用现有 ChatRouter 的两种切换方式：

| 方式 | 操作 | 说明 |
|------|------|------|
| **@提及** | 输入 `@工作流设计` + 需求 | 消息级路由，该条消息路由到指定智能体 |
| **面板切换** | AgentPanel 下拉选择智能体 | 会话级切换，后续消息默认路由到选中的智能体 |

### 6.9 上下文传递

当主智能体委派工作流设计智能体时，通过 `routeTo` 的 `agentContext` 传递以下上下文：

| 字段 | 说明 |
|------|------|
| `applicationId` | 当前应用 ID（表单和流程都属于应用） |
| `workspaceId` | 当前工作区 ID |
| `existingForms` | 当前应用下已有表单列表（避免重复创建） |
| `existingWorkflows` | 当前应用下已有流程列表 |
| `existingQueries` | 当前应用下已有查询列表（供表单字段绑定数据源） |

工作流设计智能体完成任务后，返回结构化结果给主智能体：

```typescript
interface WorkflowDesignResult {
  form?: { id: number; name: string; fieldCount: number };
  workflow?: { id: number; name: string; nodeCount: number };
  binding?: { formId: number; workflowId: number };
  warnings?: string[];    // 需要主智能体关注的事项
  suggestions?: string[];  // 建议后续操作
}
```

---

### 6.10 AI 生成内容 Lint 校验

> **核心问题**：大模型（LLM）返回的结果具有不可控性，Agent 生成的表单 HTML/CSS/JS 代码、JSON Schema 配置、流程定义等可能存在语法错误、格式违规、逻辑矛盾等问题。必须在保存前进行自动化 Lint 校验，确保生成内容符合规范。

#### 6.10.1 校验范围与时机

| 校验对象 | 触发时机 | 校验重点 |
|---------|---------|---------|
| **表单 HTML 代码** | Agent 生成/修改表单代码后 | HTML 结构规范、`data-field` 属性完整性、必填类名检查 |
| **表单 CSS 代码** | Agent 生成/修改表单代码后 | CSS 语法正确性、必填选择器存在性 |
| **表单 JS 代码** | Agent 生成/修改表单代码后 | JS 语法检查、ES5 兼容性、函数声明方式 |
| **表单字段 Schema (JSON)** | Agent 创建/更新表单定义后 | JSON 格式校验、Schema 结构完整性、字段 key 唯一性 |
| **流程定义 (JSON)** | Agent 创建/更新流程定义后 | 节点/边 JSON 格式、节点合法性、连线完整性、无孤立节点 |
| **条件表达式** | Agent 配置条件分支后 | 表达式语法正确性、引用的字段 key 是否存在 |
| **表单-流程绑定** | Agent 创建绑定后 | formId/workflowId 存在性、主键冲突 |

#### 6.10.2 校验级别策略

| 级别 | 行为 | 前端展示 |
|------|------|---------|
| **ERROR** | 阻断保存，必须修复后才能入库 | 红色边框 + 错误图标 |
| **WARNING** | 允许保存，但记录警告日志 | 黄色边框 + 警告图标 |
| **PASSED** | 校验通过，直接保存 | 绿色对勾 |

#### 6.10.3 自动修复策略

```
Agent 生成内容 → 后端 Lint 校验 → passed=true → 直接保存
                                    passed=false → 返回 ERROR 给 Agent
                                    Agent 自动修复后重试
                                    最多重试 3 次，超过则返回给用户手动处理
```

#### 6.10.4 Lint API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/lint/form-code` | 校验表单代码（HTML/CSS/JS） |
| `POST` | `/api/v1/lint/field-schema` | 校验字段 Schema JSON |
| `POST` | `/api/v1/lint/workflow` | 校验流程定义（nodes/edges） |
| `POST` | `/api/v1/lint/condition` | 校验条件表达式 |

---

## 七、数据库设计

### 7.1 新增表结构

```
form_definitions（表单定义）
├── id              BIGINT PK
├── workspace_id    BIGINT FK → workspaces
├── application_id  BIGINT FK → applications
├── code_page_id    BIGINT FK → code_pages   // 表单代码（HTML/CSS/JS），复用 CodePage
├── name            VARCHAR(100)
├── description     TEXT
├── fields          JSON          // 字段 Schema 列表（FormFieldSchema[]），供工作流引擎读取
├── version         INT
├── status          VARCHAR(20)   // DRAFT / PUBLISHED / ARCHIVED
├── created_by      BIGINT FK → users
├── created_at      DATETIME
├── updated_at      DATETIME

workflow_definitions（流程定义）
├── id              BIGINT PK
├── workspace_id    BIGINT FK → workspaces
├── name            VARCHAR(100)
├── description     TEXT
├── nodes           JSON          // 节点列表，含位置、属性
├── edges           JSON          // 连线列表，含条件表达式
├── version         INT
├── status          VARCHAR(20)   // DRAFT / PUBLISHED / ARCHIVED
├── created_by      BIGINT FK → users
├── created_at      DATETIME
├── updated_at      DATETIME

form_workflow_bindings（表单-流程关联）
├── id              BIGINT PK
├── form_id         BIGINT FK → form_definitions
├── workflow_id     BIGINT FK → workflow_definitions
├── workflow_version INT          // NULL 表示始终使用最新版本
├── binding_type    VARCHAR(20)   // ONE_TO_ONE / ONE_TO_MANY
├── is_default      BOOLEAN       // 一对多时的默认流程
├── created_at      DATETIME

workflow_instances（流程实例）
├── id              BIGINT PK
├── workflow_id     BIGINT FK → workflow_definitions
├── workflow_version INT
├── form_id         BIGINT FK → form_definitions
├── form_data       JSON          // 表单数据快照
├── status          VARCHAR(20)   // RUNNING / COMPLETED / REJECTED / CANCELLED / FROZEN
├── initiator_id    BIGINT FK → users
├── current_nodes   JSON          // 当前活跃节点列表
├── deadline        DATETIME      // 流程截止日期
├── started_at      DATETIME
├── completed_at    DATETIME
├── created_at      DATETIME
├── updated_at      DATETIME

workflow_tasks（任务/待办）
├── id              BIGINT PK
├── instance_id     BIGINT FK → workflow_instances
├── node_id         VARCHAR(50)   // 对应流程定义中的节点 ID
├── assignee_id     BIGINT FK → users
├── assignee_type   VARCHAR(20)   // NORMAL / TRANSFER / DELEGATE / ADD_SIGN
├── original_assignee_id BIGINT   // 转办/委派的原处理人
├── status          VARCHAR(20)   // PENDING / PROCESSING / COMPLETED / CANCELLED
├── action          VARCHAR(20)   // APPROVE / REJECT / TRANSFER / ADD_SIGN
├── comment         TEXT          // 审批意见
├── attachments     JSON          // 审批附件
├── deadline        DATETIME      // 任务截止时间
├── sla_breached    BOOLEAN
├── started_at      DATETIME
├── completed_at    DATETIME
├── created_at      DATETIME

workflow_history（流转历史）
├── id              BIGINT PK
├── instance_id     BIGINT FK → workflow_instances
├── task_id         BIGINT FK → workflow_tasks (nullable)
├── node_id         VARCHAR(50)
├── operator_id     BIGINT FK → users
├── action          VARCHAR(30)   // SUBMIT / APPROVE / REJECT / TRANSFER / ADD_SIGN / 
                                  // FORCE_JUMP / FORCE_STOP / AUTO_ESCALATE
├── from_node_id    VARCHAR(50)   // 来源节点
├── to_node_id      VARCHAR(50)   // 目标节点
├── comment         TEXT
├── detail          JSON          // 操作详情
├── created_at      DATETIME

departments（部门）
├── id              BIGINT PK
├── name            VARCHAR(100)
├── parent_id       BIGINT        // 上级部门
├── external_id     VARCHAR(100)  // 外部系统 ID
├── path            VARCHAR(500)  // 部门路径
├── order_num       INT
├── created_at      DATETIME
├── updated_at      DATETIME

members（人员）
├── id              BIGINT PK
├── user_id         BIGINT        // 关联鲁班用户（可为空）
├── name            VARCHAR(50)
├── email           VARCHAR(100)
├── mobile          VARCHAR(20)
├── department_id   BIGINT FK → departments
├── position        VARCHAR(50)
├── external_id     VARCHAR(100)
├── leader_id       BIGINT        // 直属上级
├── status          VARCHAR(20)   // ACTIVE / INACTIVE
├── created_at      DATETIME
├── updated_at      DATETIME

workflow_roles（自定义角色）
├── id              BIGINT PK
├── workspace_id    BIGINT FK → workspaces
├── name            VARCHAR(50)   // 如"财务审批组"
├── description     VARCHAR(200)
├── member_ids      JSON          // 成员 ID 列表
├── created_at      DATETIME
├── updated_at      DATETIME

excel_imports（Excel 导入记录）
├── id              BIGINT PK
├── instance_id     BIGINT        // 关联流程实例（提交后赋值，编辑中为 NULL）
├── form_id         BIGINT FK → form_definitions
├── field_key       VARCHAR(128)  // 表单中的字段 key（如 "purchase_list"）
├── file_name       VARCHAR(512)  // 原始文件名
├── file_size       BIGINT        // 文件大小（字节）
├── file_path       VARCHAR(1024) // 原始文件存储路径（可空）
├── total_rows      INT           // 总行数
├── valid_rows      INT           // 有效行数
├── warning_rows    INT           // 警告行数
├── error_rows      INT           // 错误行数
├── column_schema   JSON          // 列定义快照（[{ "key":"material_name", "label":"物料名称", "type":"text" }, ...]）
├── status          VARCHAR(20)   // DRAFT / SUBMITTED
├── created_at      DATETIME
├── updated_at      DATETIME

excel_import_rows（Excel 行数据）
├── id              BIGINT PK
├── import_id       BIGINT FK → excel_imports
├── row_number      INT           // 行号（对应 Excel 中的行号）
├── data            JSON          // 行数据（{"material_name":"A4纸","quantity":100,...}）
├── status          VARCHAR(20)   // OK / WARNING / ERROR
├── errors          JSON          // 校验错误信息（[{"column":"material_name","message":"物料名称不能为空"}]）
├── created_at      DATETIME

```

### 7.2 现有表扩展

| 表名 | 扩展方式 | 说明 |
|------|---------|------|
| `applications` | 新增 `type` 字段 | 区分普通应用 / 工作流应用 |
| `pages` | 新增 `page_type` 字段 | 新增 `WORKFLOW_FORM` / `WORKFLOW_LIST` / `WORKFLOW_TODO` 等页面类型 |

---

## 八、API 设计

### 8.1 通用约定

沿用现有鲁班 API 规范：
- Base URL：`http://localhost:8080/api/v1`
- 认证：JWT Bearer Token
- 统一响应格式：`{ "success": true, "data": <T>, "message": "ok" }`

### 8.2 表单 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/forms` | 创建表单定义 |
| GET | `/api/v1/forms` | 表单列表（按 workspace 过滤） |
| GET | `/api/v1/forms/{id}` | 获取表单详情 |
| PUT | `/api/v1/forms/{id}` | 更新表单定义 |
| DELETE | `/api/v1/forms/{id}` | 删除表单 |
| POST | `/api/v1/forms/{id}/publish` | 发布表单 |
| POST | `/api/v1/forms/{id}/copy` | 复制表单 |
| GET | `/api/v1/forms/{id}/preview` | 获取表单预览数据 |

### 8.3 工作流 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/workflows` | 创建流程定义 |
| GET | `/api/v1/workflows` | 流程列表（按 workspace 过滤） |
| GET | `/api/v1/workflows/{id}` | 获取流程详情 |
| PUT | `/api/v1/workflows/{id}` | 更新流程定义 |
| DELETE | `/api/v1/workflows/{id}` | 删除流程 |
| POST | `/api/v1/workflows/{id}/publish` | 发布流程（生成新版本） |
| POST | `/api/v1/workflows/{id}/unpublish` | 下线流程 |
| GET | `/api/v1/workflows/{id}/versions` | 获取版本列表 |
| POST | `/api/v1/workflows/{id}/validate` | 校验流程 |
| POST | `/api/v1/workflows/{id}/copy` | 复制流程 |

### 8.4 表单-流程关联 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/form-workflow-bindings` | 创建关联 `{ formId, workflowId, workflowVersion, bindingType, isDefault }` |
| GET | `/api/v1/form-workflow-bindings?formId={id}` | 查询表单关联的流程 |
| GET | `/api/v1/form-workflow-bindings?workflowId={id}` | 查询流程关联的表单 |
| DELETE | `/api/v1/form-workflow-bindings/{id}` | 解除关联 |
| PUT | `/api/v1/form-workflow-bindings/{id}/default` | 设为默认流程（一对多时） |

### 8.5 流程实例 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/workflow-instances` | 发起流程（提交表单数据） |
| GET | `/api/v1/workflow-instances` | 我的流程列表（发起/参与的） |
| GET | `/api/v1/workflow-instances/{id}` | 流程详情（含审批轨迹） |
| GET | `/api/v1/workflow-instances/{id}/history` | 流转历史 |
| PUT | `/api/v1/workflow-instances/{id}/cancel` | 撤销流程 |
| PUT | `/api/v1/workflow-instances/{id}/freeze` | 冻结流程（管理员） |
| PUT | `/api/v1/workflow-instances/{id}/unfreeze` | 解冻流程（管理员） |
| POST | `/api/v1/workflow-instances/{id}/reject-to` | 驳回至指定节点 |
| POST | `/api/v1/workflow-instances/{id}/force-jump` | 强制跳转至指定节点 |
| POST | `/api/v1/workflow-instances/{id}/resubmit` | 驳回后重新提交 |
| GET | `/api/v1/workflow-instances/{id}/sub-processes` | 获取子流程列表 |

### 8.6 任务（待办） API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/tasks?status=PENDING` | 我的待办列表 |
| GET | `/api/v1/tasks?status=COMPLETED` | 我的已办列表 |
| GET | `/api/v1/tasks/{id}` | 任务详情（含表单数据） |
| PUT | `/api/v1/tasks/{id}/approve` | 审批通过 |
| PUT | `/api/v1/tasks/{id}/reject` | 审批驳回 |
| PUT | `/api/v1/tasks/{id}/transfer` | 转办 |
| PUT | `/api/v1/tasks/{id}/delegate` | 委派 |
| PUT | `/api/v1/tasks/{id}/add-sign` | 加签 |
| POST | `/api/v1/tasks/{id}/reject-previous` | 逐级驳回至上一节点 |

### 8.7 管理员干预 API

| 方法 | 路径 | 说明 |
|------|------|------|
| PUT | `/api/v1/admin/instances/{id}/force-jump` | 强制跳转到指定节点 |
| PUT | `/api/v1/admin/instances/{id}/force-stop` | 强制终止 |
| PUT | `/api/v1/admin/instances/{id}/force-withdraw` | 强制撤回 |
| PUT | `/api/v1/admin/tasks/{id}/reassign` | 修改处理人 |

### 8.8 组织人员 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/departments` | 部门列表（可按 parentId 过滤） |
| GET | `/api/v1/departments/tree` | 部门树结构 |
| GET | `/api/v1/departments/{id}` | 部门详情 |
| GET | `/api/v1/departments/{id}/members` | 部门成员 |
| GET | `/api/v1/members` | 人员搜索（关键词/部门） |
| GET | `/api/v1/members/{id}` | 成员详情 |
| GET | `/api/v1/roles` | 自定义角色列表 |
| POST | `/api/v1/roles` | 创建自定义角色 |
| PUT | `/api/v1/roles/{id}` | 更新角色成员 |
| DELETE | `/api/v1/roles/{id}` | 删除角色 |
| POST | `/api/v1/sync/organization` | 手动触发组织同步 |
| POST | `/api/v1/sync/organization/callback` | 外部系统同步回调接口 |

### 8.9 Excel 导入 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/excel/parse` | 解析上传的 Excel 文件 |
| POST | `/api/v1/excel/guess-mapping` | 智能匹配 Excel 表头与字段映射 |

### 8.10 文件上传 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/files/upload` | 上传文件 |
| GET | `/api/v1/files/download/{fileName}` | 下载文件 |
| GET | `/api/v1/files/thumbnail/{fileName}` | 获取缩略图 |
| DELETE | `/api/v1/files/{fileName}` | 删除文件 |

### 8.11 Lint 校验 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/lint/form-code` | 校验表单代码（HTML/CSS/JS） |
| POST | `/api/v1/lint/field-schema` | 校验字段 Schema（JSON） |
| POST | `/api/v1/lint/workflow` | 校验流程定义 |
| POST | `/api/v1/lint/condition` | 校验条件表达式 |

---

## 九、前端页面规划

### 9.1 新增页面

| 页面 | 路由 | 说明 |
|------|------|------|
| 工作流管理 | `/workflow/processes` | 流程列表，创建/编辑/删除/发布 |
| 流程设计器 | `/workflow/designer/:id` | 可视化流程编辑器，三栏布局参考钉钉 OA 审批风格（详见 3.1.1） |
| 表单管理 | `/workflow/forms` | 表单列表，创建/编辑/删除/发布 |
| 表单预览 | `/workflow/forms/:id/preview` | 表单预览（桌面端 + 移动端 Tab 切换），表单代码由 CodePage 渲染 |
| 我的待办 | `/workflow/tasks` | 当前用户的待办/已办任务列表（Tab 切换） |
| 我发起的 | `/workflow/my-instances` | 当前用户发起的流程列表 |
| 流程详情 | `/workflow/instances/:id` | 流程实例详情（含审批轨迹图、表单数据） |
| 组织管理 | `/workflow/organization` | 部门树、人员查看（只读） |

### 9.2 新增组件

| 组件 | 说明 |
|------|------|
| `FormRenderer` | 表单渲染组件，加载 CodePage 的 HTML/CSS/JS 并注入 `window.__LUBAN_WORKFLOW__`，支持三种模式：填写态（create）、审批态（approve）、只读态（view） |
| `WorkflowDesigner` | 可视化流程设计器（基于 React Flow），三栏布局（左-节点面板/中-画布/右-属性面板），参考钉钉 OA 审批风格，支持拖拽添加节点、点击编辑属性、画布缩放、撤销重做等交互（详见 3.1.1 UI 设计规范） |
| `WorkflowViewer` | 流程查看器（只读模式，展示审批轨迹） |
| `NodeConfigPanel` | 节点属性配置面板（审批人、协作模式、字段权限、时限等） |
| `ConditionEditor` | 条件分支表达式编辑器（字段选择 + 运算符 + 阈值，自动生成表达式） |
| `FieldPermissionGrid` | 字段权限矩阵表格（行=字段，列=权限级别，用于流程节点配置） |
| `TodoList` | 待办列表组件（含筛选、批量操作） |
| `ProcessTimeline` | 审批时间线/轨迹组件 |
| `MemberPicker` | 人员/部门/角色选择器 |
| `OrganizationTree` | 组织架构树（只读查看） |

---

## 十、实施计划

### 10.1 阶段划分

#### Phase 1：基础能力（MVP）

- [ ] 组织人员数据模型 + 外部同步接口骨架
- [ ] 表单定义 CRUD（code_page_id + fields JSON Schema 存储）
- [ ] 表单代码生成规范落地（Agent 按规范生成 HTML/CSS/JS，复用 CodePage 机制）
- [ ] `window.__LUBAN_WORKFLOW__` 平台注入对象实现
- [ ] `FormRenderer` 组件（加载 CodePage 代码 + 注入工作流上下文）
- [ ] 表单预览（桌面端 + 移动端 Tab 切换）
- [ ] 流程定义 CRUD（JSON 存储）
- [ ] 可视化流程设计器（基础节点：开始/审批/结束）
- [ ] 表单与流程关联
- [ ] 流程发起（提交表单 → 创建流程实例）
- [ ] 基础审批（同意/驳回）
- [ ] 待办/已办列表
- [ ] AI Agent 工具：create_form、get_form、create_workflow、get_workflow

#### Phase 2：企业级特性

- [ ] 会签 / 或签 / 依次审批 / 按比例通过
- [ ] 动态路由（条件分支）
- [ ] 驳回策略（逐级 / 任意节点 / 发起人）
- [ ] 驳回后重新提交（原路返回 / 从头开始）
- [ ] 转办 / 委派 / 加签
- [ ] 字段级权限（可见/可编辑/隐藏/脱敏）
- [ ] 节点时限 + 超时催办
- [ ] 流程流转历史记录
- [ ] AI Agent 工具：表单设计技能、流程设计技能

#### Phase 3：高级特性

- [ ] 子流程与多实例
- [ ] SLA 自动升级
- [ ] 节假日与工作时间计算
- [ ] 强制干预（跳转/终止/撤回）
- [ ] 流程版本管理
- [ ] 表单模板库
- [ ] 表单数据归档与导出
- [ ] 流程统计看板
- [ ] AI Agent 流程诊断技能

### 10.2 技术选型

#### 10.2.1 后端技术栈

| 层级 | 技术 | 版本 | 选型理由 |
|------|------|------|---------|
| **基础框架** | Spring Boot | 3.3.2（与主项目一致） | 开箱即用，生态成熟 |
| **ORM** | Spring Data JPA + Hibernate | 6.x（随 Spring Boot） | 主项目已使用，保持一致性 |
| **数据库** | MySQL | 8.0+ | 主项目已使用，Flyway 管理迁移 |
| **数据库迁移** | Flyway | 随 Spring Boot | 主项目已使用，保持一致性 |
| **认证鉴权** | Spring Security + JWT | 0.12.6（jjwt） | 主项目已有，复用 `JwtTokenProvider` 和 `@AuthenticationPrincipal` |
| **模块化** | Maven 多模块 | — | luban-core + luban-workflow，Spring Boot Auto-Configuration 实现可插拔 |
| **JSON 处理** | Jackson | 随 Spring Boot | 主项目已有，用于节点配置、字段 Schema 等 JSON 字段的序列化 |
| **Excel 解析** | Apache POI | 5.2.x | 成熟稳定，支持 .xls/.xlsx 解析，用于表单 Excel 上传字段 |
| **文件存储** | 本地文件系统 + OSS 抽象层 | — | 编辑期存临时目录，提交后移动到正式目录；预留 OSS 接口 |
| **表达式引擎** | Spring Expression Language (SpEL) | 随 Spring Boot | 轻量、无额外依赖，用于条件分支表达式求值 |
| **通知推送** | WebSocket（STOMP） | 随 Spring Boot | 站内实时通知（待办提醒）；预留邮件/钉钉/企微通知接口 |

#### 10.2.2 工作流引擎：自研轻量级状态机

**为什么不引入 Activiti / Flowable / Camunda？**

| 对比维度 | 重型引擎（Flowable/Camunda） | 自研轻量级状态机 |
|---------|---------------------------|----------------|
| **学习成本** | 高，需学习 BPMN 2.0 规范、引擎 API、部署流程 | 低，纯 Java 代码，状态机模式直观 |
| **依赖体积** | 大，Flowable 引入 50+ 依赖 | 零额外依赖 |
| **灵活性** | 受 BPMN 规范约束，动态修改需重新部署 | 完全自由，节点配置即 JSON，运行时动态修改 |
| **与 AI Agent 集成** | 需适配 BPMN XML，Agent 生成 BPMN 不现实 | Agent 直接生成 JSON 配置，天然适配 |
| **调试排查** | 引擎内部黑盒，排查困难 | 代码透明，断点即可调试 |
| **启动速度** | 慢，需初始化流程引擎 | 快，无额外初始化开销 |
| **适用场景** | 大型企业，数百种流程，BPMN 专业人员维护 | 中小团队，AI 辅助设计，流程数量可控 |

**自研引擎核心设计**：

```
┌─────────────────────────────────────────────────────┐
│                  ProcessEngine                       │
│                                                     │
│  startProcess(defId, formData, initiator)           │
│       │                                             │
│       ▼                                             │
│  ┌─────────────────────────────────────────────┐    │
│  │            NodeExecutor 接口                  │    │
│  │                                             │    │
│  │  + execute(context: ExecutionContext)        │    │
│  │     → NextNodeResult                        │    │
│  └─────────────────────────────────────────────┘    │
│       │                                             │
│       ├── StartNodeExecutor                         │
│       ├── ApprovalNodeExecutor                      │
│       │     ├── resolveApprovers()   // 解析审批人   │
│       │     ├── checkAutoSkip()     // 自动跳过     │
│       │     └── createTask()         // 创建待办     │
│       ├── ConditionNodeExecutor                     │
│       │     └── evaluateCondition()  // SpEL 求值    │
│       ├── ParallelGatewayExecutor                   │
│       │     ├── fork()               // 分支        │
│       │     └── join()               // 汇合        │
│       ├── CcNodeExecutor                           │
│       ├── SubProcessNodeExecutor                   │
│       └── EndNodeExecutor                          │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │            TaskService                       │    │
│  │                                             │    │
│  │  + completeTask(taskId, action, comment)     │    │
│  │  + rejectTask(taskId, targetNodeId, comment) │    │
│  │  + transferTask(taskId, targetUserId)        │    │
│  │  + delegateTask(taskId, targetUserId)        │    │
│  │  + addSignTask(taskId, userIds)              │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │            DeadlineScheduler                 │    │
│  │                                             │    │
│  │  + checkDeadlines()  // 定时扫描超时任务     │    │
│  │  + sendReminder()    // 催办提醒             │    │
│  │  + escalate()        // 自动升级             │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**状态机状态定义**：

| 状态 | 说明 | 触发动作 |
|------|------|---------|
| `DRAFT` | 草稿 | 用户保存草稿 |
| `PENDING` | 审批中 | 提交审批 |
| `APPROVED` | 已通过 | 所有审批节点通过 |
| `REJECTED` | 已驳回 | 任意审批节点驳回 |
| `CANCELLED` | 已取消 | 发起人撤回 |
| `TERMINATED` | 已终止 | 管理员强制终止 |
| `ARCHIVED` | 已归档 | 流程结束 + 归档周期到 |

**状态流转**：

```
DRAFT ──提交──→ PENDING ──全部通过──→ APPROVED ──归档──→ ARCHIVED
                  │  │
                  │  └──驳回──→ REJECTED ──重新提交──→ PENDING
                  │
                  ├──撤回──→ CANCELLED
                  │
                  └──管理员终止──→ TERMINATED
```

##### 10.2.2.1 与 Activiti 详细对比

**Activiti 简介**：Apache 顶级项目，Java 生态最知名的 BPMN 2.0 工作流引擎，被 Alfresco、Spring Boot 官方集成，广泛应用于金融、政务、OA 等场景。

**一、功能覆盖度对比**

| 功能 | Activiti | 自研引擎 | 备注 |
|------|----------|---------|------|
| 流程定义 | BPMN 2.0 XML 文件 | JSON 节点配置 | Activiti 需专业工具（如 Camunda Modeler）设计；自研 JSON 可由 AI Agent 直接生成 |
| 用户任务（审批节点） | ✅ UserTask + 多实例 | ✅ 审批节点 + 六种审批人类型 | 功能等价，自研审批人来源更灵活（表单字段、动态脚本） |
| 排他网关（条件分支） | ✅ ExclusiveGateway | ✅ 条件分支 + SpEL 表达式 | 功能等价，Activiti 支持更复杂的条件组合 |
| 并行网关 | ✅ ParallelGateway | ✅ 并行分支 | 功能等价 |
| 包容网关 | ✅ InclusiveGateway | ❌ 暂不支持 | 复杂场景，可用并行+条件组合替代 |
| 子流程 / 调用活动 | ✅ SubProcess + CallActivity | ✅ 子流程节点 | 功能等价 |
| 边界事件 / 中间事件 | ✅ 定时器、信号、消息 | ⚠️ 仅超时（DeadlineScheduler） | Activiti 事件体系更完善，但 90% 的审批场景不需要 |
| 流程变量 | ✅ 强类型变量 | ✅ 表单数据 JSON + 字段 Schema | 自研更灵活，但缺少类型校验 |
| 历史记录 | ✅ 自动全量记录 | ✅ 流转历史表 | 功能等价 |
| 版本管理 | ✅ 流程定义版本 | ✅ 流程定义版本 | 功能等价 |
| 驳回 / 退回 | ⚠️ 非标准 BPMN，需自行实现 | ✅ 原生支持驳回至任意节点 | 自研更适合中国式审批 |
| 转办 / 委派 / 加签 | ⚠️ 非标准 BPMN，需自行实现 | ✅ 原生支持 | 自研更适合中国式审批 |
| 会签 / 或签 / 依次 | ⚠️ 需通过多实例+扩展实现 | ✅ 原生支持四种协作模式 | 自研更适合中国式审批 |
| 超时 / SLA | ⚠️ 需定时器边界事件 | ✅ 内置 DeadlineScheduler | 自研更简单直接 |
| 字段权限 | ❌ 不支持 | ✅ 审批节点可配置字段级权限 | 自研独有功能 |
| 动态修改运行中流程 | ❌ 需重新部署 | ✅ 草稿可随时修改，已发布流程下线后修改 | 自研更灵活 |
| 流程图可视化 | ✅ BPMN.js 渲染 | ✅ React Flow 节点卡片 | 自研 UI 更现代化（钉钉风格） |
| REST API | ✅ 完整 REST API | ✅ 自建 REST API | 功能等价 |
| Spring Boot 集成 | ✅ activiti-spring-boot-starter | ✅ Spring Boot Auto-Configuration | 自研更轻量 |
| 数据库兼容 | MySQL / Oracle / PostgreSQL / H2 等 | MySQL（当前） | 自研可扩展 |
| 集群 / 分布式 | ✅ 支持 | ⚠️ 暂不支持，可后续扩展 | 单节点满足中小团队需求 |

**二、架构对比**

| 维度 | Activiti | 自研引擎 |
|------|----------|---------|
| **核心架构** | 命令模式 + 拦截器链（CommandContext 线程绑定） | 简单状态机 + NodeExecutor 策略模式 |
| **持久化** | MyBatis + 20+ 张内置表 | JPA + 6 张核心表（process_definitions / process_instances / process_tasks / task_history / form_definitions / form_data） |
| **事务管理** | 引擎内部事务，与 Spring 事务隔离 | 直接使用 Spring 事务，与主项目一致 |
| **异步执行** | 内置 Job Executor（线程池 + 定时任务） | Spring @Scheduled + @Async |
| **表达式引擎** | JUEL（UEL 规范） | SpEL（Spring 原生） |
| **代码量** | 约 50 万行 Java 代码 | 预估 3000-5000 行核心代码 |
| **启动时间** | 3-5 秒（初始化引擎 + 加载流程定义） | < 1 秒（零初始化） |
| **内存占用** | 约 100-200MB 额外内存 | 约 10-20MB 额外内存 |

**三、学习曲线对比**

```
Activiti 学习路径（约 2-4 周）：
  理解 BPMN 2.0 规范（事件、网关、活动、顺序流）
  → 学习引擎 API（ProcessEngine、RuntimeService、TaskService、HistoryService）
  → 掌握流程部署（BPMN XML + 资源配置）
  → 理解命令模式与拦截器
  → 学习多实例与边界事件
  → 排查引擎内部错误

自研引擎学习路径（约 1-2 天）：
  理解 JSON 节点配置结构
  → 调用 ProcessEngine.startProcess() / TaskService.completeTask()
  → 断点调试 NodeExecutor 执行链
  → 完成
```

**四、Activiti 适合的场景**

| 场景 | 说明 |
|------|------|
| 已有 BPMN 专业人员 | 团队有懂 BPMN 2.0 的业务分析师，能用 Camunda Modeler 设计流程 |
| 需要与外部系统深度集成 | 需要调用外部 WebService、消息队列、信号事件等 |
| 流程极度复杂 | 数百个节点、多层嵌套子流程、复杂事件驱动 |
| 需要分布式/集群 | 高并发场景，需多节点部署和分布式事务 |
| 已有 Activiti 技术栈 | 团队有 Activiti 使用经验，迁移成本低 |
| 合规性要求 | 金融、政务等需要 BPMN 标准审计报告的行业 |

**五、自研引擎适合的场景（鲁班的定位）**

| 场景 | 说明 |
|------|------|
| AI 辅助设计 | 流程由 AI Agent 生成 JSON，而非人工拖拽 BPMN |
| 审批流程为主 | 请假、报销、合同审批等典型 OA 场景，不需要复杂事件 |
| 中小团队 | 节点数 3-15 个，日均流程实例 < 1000 |
| 快速迭代 | 需求变化频繁，流程需要随时调整，不能等"重新部署" |
| 无 BPMN 专业人员 | 团队不熟悉 BPMN 2.0，也不打算招聘 |
| 中国式审批 | 驳回、转办、委派、加签、会签/或签/依次审批等中国特色需求 |
| 字段级权限 | 审批过程中控制表单字段的可见/可编辑 |
| 轻量级嵌入 | 不希望引入 50+ 依赖和 20+ 张表 |

**六、迁移路径**

如果未来团队规模扩大，需要 Activiti 级别的能力，迁移路径清晰：

```
自研引擎 (JSON 配置) → 生成 BPMN XML → 导入 Activiti
```

1. 自研引擎的 JSON 配置可完整映射为 BPMN 2.0 元素（审批节点→UserTask，条件分支→ExclusiveGateway 等）
2. 自研引擎的核心表（process_definitions / process_instances / process_tasks）与 Activiti 表结构兼容
3. 迁移成本：约 1-2 周（写一个 JSON→BPMN 转换器 + 数据迁移脚本）

**七、结论**

|  | Activiti | 自研引擎 |
|---|---------|---------|
| **功能完整度** | 95%（BPMN 全支持） | 80%（覆盖 90% 审批场景） |
| **开发成本** | 0（现成） | 约 2-3 周核心开发 |
| **维护成本** | 高（引擎升级、BUG 修复依赖社区） | 低（代码完全可控） |
| **AI 适配性** | 差（需生成 BPMN XML） | 优（AI 直接生成 JSON） |
| **灵活性** | 低（受 BPMN 规范约束） | 高（完全自由扩展） |
| **启动速度** | 慢 | 快 |
| **依赖体积** | 大 | 小 |
| **适合鲁班** | ❌ | ✅ |

**最终决策**：自研轻量级状态机。鲁班的核心价值是"AI 降低使用门槛"，引入 Activiti 会让 AI 必须学会生成 BPMN XML（极高难度），而自研引擎的 JSON 配置与 AI 天然适配。20% 不覆盖的 BPMN 功能（包容网关、复杂事件、分布式等）在审批场景中极少使用，不影响核心体验。

#### 10.2.3 前端技术栈

| 层级 | 技术 | 版本 | 选型理由 |
|------|------|------|---------|
| **框架** | React | 19.x | 主项目已使用 |
| **语言** | TypeScript | 5.x | 主项目已使用 |
| **构建工具** | Vite | 6.x | 主项目已使用 |
| **路由** | React Router | 7.x | 主项目已使用 |
| **状态管理** | Zustand | 5.x | 主项目已使用，比 Redux 轻量 |
| **HTTP 客户端** | Axios | 1.x | 主项目已使用 |
| **UI 组件库** | 无，纯手写 CSS | — | 主项目风格，保持一致性 |
| **图标** | Lucide React | 1.x | 主项目已使用 |

**新增依赖**：

| 依赖 | 版本 | 用途 | 包大小 |
|------|------|------|--------|
| **@xyflow/react** | ^12.x | 流程设计器画布（节点拖拽、连线、缩放、撤销/重做） | ~150KB gzipped |
| **xlsx** | ^0.18.x | Excel 文件前端解析（不上传后端即可预览） | ~120KB gzipped |
| **file-saver** | ^2.x | 浏览器端文件下载（导出流程、导出数据） | ~3KB gzipped |
| **@types/file-saver** | ^2.x | file-saver 的 TypeScript 类型 | — |

**为什么选择 @xyflow/react（React Flow）？**

| 对比维度 | React Flow | 自研画布 | 其他方案（AntV X6 / GoJS） |
|---------|-----------|---------|--------------------------|
| **React 集成** | 原生 React 组件，声明式 API | 需自行封装 | X6 有 React 封装但不够成熟 |
| **定制能力** | 节点、边、连线完全可自定义 React 组件 | 完全自由但开发量大 | 定制较复杂 |
| **交互体验** | 内置拖拽、缩放、框选、小地图、撤销/重做 | 需从零实现 | 功能全但学习曲线陡 |
| **社区活跃度** | 35k+ GitHub Stars，MIT 协议 | — | GoJS 商业收费 |
| **包体积** | ~150KB gzipped | 0 | X6 ~200KB，GoJS ~300KB |
| **与钉钉风格适配** | 节点卡片样式、连线动画、小地图均可轻松实现 | 可完全还原 | 通用画布，需额外适配 |

**React Flow 核心能力映射**：

| 需求 | React Flow 对应能力 |
|------|-------------------|
| 三栏布局画布 | `<ReactFlow>` 组件嵌入中间面板 |
| 左侧节点面板拖拽 | `onDragOver` + `onDrop` 创建节点 |
| 节点卡片样式 | 自定义 `CustomNode` React 组件 |
| 节点间 "+" 按钮 | 自定义 `Edge` 带中间按钮 |
| 连线箭头 | 内置 `MarkerType.ArrowClosed` |
| 条件分支标签 | 自定义 `EdgeLabel` 组件 |
| 画布缩放 | 内置 `useReactFlow().zoomIn/zoomOut()` |
| 撤销/重做 | 需自行实现（基于 `onNodesChange` 历史栈） |
| 小地图 | 内置 `<MiniMap>` 组件 |
| 选中节点 → 右侧属性面板 | `onNodeClick` 回调更新选中状态 |
| 自动布局 | `dagre` 布局算法（可选依赖） |

**xlsx 库用途**：

| 功能 | 说明 |
|------|------|
| 前端解析 Excel | 用户选择文件后，纯前端解析工作表数据，无需上传后端 |
| 预览表格 | 解析后在前端渲染预览表格，支持编辑 |
| 列映射 | 根据 `excelConfig.columns` 匹配列名与表单字段 |
| 校验 | 前端校验数据类型、必填项、格式 |

#### 10.2.4 后端 Maven 依赖清单

```xml
<!-- luban-workflow/pom.xml 核心依赖 -->

<!-- 基础：复用 luban-core 的 JPA、Security 等 -->
<dependency>
    <groupId>com.luban</groupId>
    <artifactId>luban-core</artifactId>
    <version>${project.version}</version>
</dependency>

<!-- Spring Boot Starter Web（复用 luban-core） -->
<!-- Spring Boot Starter Data JPA（复用 luban-core） -->
<!-- Spring Boot Starter Security（复用 luban-core） -->

<!-- Excel 解析 -->
<dependency>
    <groupId>org.apache.poi</groupId>
    <artifactId>poi-ooxml</artifactId>
    <version>5.2.5</version>
</dependency>

<!-- WebSocket 通知 -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-websocket</artifactId>
</dependency>

<!-- 可选：Groovy 脚本引擎（动态审批人脚本） -->
<dependency>
    <groupId>org.apache.groovy</groupId>
    <artifactId>groovy</artifactId>
    <version>4.0.22</version>
    <optional>true</optional>
</dependency>
```

#### 10.2.5 前端 package.json 新增依赖

```json
{
  "dependencies": {
    "@xyflow/react": "^12.4.0",
    "xlsx": "^0.18.5",
    "file-saver": "^2.0.5"
  },
  "devDependencies": {
    "@types/file-saver": "^2.0.7"
  }
}
```

### 10.3 项目结构调整

#### 10.3.1 后端拆分

现有 `backend/src/` 代码迁移至 `backend/luban-core/`，新增 `backend/luban-workflow/` 子模块。父 POM 聚合两个子模块，一键编译启动。

```xml
<!-- backend/pom.xml（父 POM） -->
<modules>
    <module>luban-core</module>
    <module>luban-workflow</module>
</modules>
```

```xml
<!-- backend/luban-core/pom.xml -->
<dependency>
    <groupId>com.luban</groupId>
    <artifactId>luban-workflow</artifactId>
    <optional>true</optional>   <!-- 可选依赖，不存在时也不报错 -->
</dependency>
```

#### 10.3.2 前端不拆分

前端保持单项目结构，工作流相关代码直接放入 `frontend/src/` 对应目录，无需额外 npm 包或子项目。路由、状态、组件统一管理，降低维护成本。

---

## 十一、开放问题（待确认）

1. ~~流程引擎选型~~ → **已决策**：自研轻量级状态机，不引入 Flowable/Camunda。详见 10.2.2。
2. **组织同步频率**：实时同步还是定时同步？增量还是全量？
3. **移动端适配**：表单填写和审批是否需要移动端（H5/小程序）？
4. **通知渠道**：优先支持哪些通知方式（站内/邮件/钉钉/企微）？
5. ~~表单与 CodePage 的关系~~ → **已决策**：表单复用 CodePage 的 HTML/CSS/JS 机制，`form_definitions.code_page_id` 关联 CodePage 存储表单代码，`form_definitions.fields` 存储字段 Schema 供工作流引擎读取。详见第二章。
6. **跨应用流程**：是否需要跨应用的流程？（如集团级审批跨子公司）
7. **数据归档策略**：已完成的流程实例保留多久？是否需要自动归档到冷存储？