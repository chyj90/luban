/**
 * Prompt Fragments（Prompt 片段）
 *
 * 各 Skill 的 capability summary，用于注入到 Agent 的 System Prompt 中。
 * 从 tools/ 迁移至此，与 Skill 定义放在一起，统一管理。
 */

export function getPageSkillSummary(): string {
  return `## 页面管理
- 删除/重命名页面
- 通过 list_pages 查看所有页面
- **推荐**：用 create_page_scaffold 生成脚手架，再 update_code_page 逐步完善
- 也可用 create_code_page 一步创建（代码有非语法错误时仍会创建成功，再逐步修复）
- 不确定目标页面时主动向用户确认`;
}

/** 外部库与内置能力规则：分析阶段（填 libraries 时）与执行阶段都必须可见 */
export function getLibraryRulesSummary(): string {
  return `## 外部库与内置能力（声明 libraries 前必读）
- **ECharts 与 echarts-gl 已内置**，libraries 禁止引入 echarts 相关 CDN（echarts.min.js、echarts-gl、china.js 等地图 JS）
- **中国地图已内置注册**：map: 'china' 可直接使用；省级地图下钻用 LubanUI.loadProvinceMap(adcode)；geoJSON 属于内置能力，禁止引入 china.js / geo.datav.aliyun.com / .json 数据 URL——提交分析时会被自动剥离
- **地图默认用 GIS**：凡是有地图的页面，中央/主视图优先用 LubanUI.gis（真实瓦片底观感更佳），打点/飞线/下钻能力齐全
- **逻辑地图（LubanUI.map / map: 'china'）仅作兜底**，只允许两种例外：① 需要省份级填色统计（choropleth，各省按数值着色）；② 明确的无外网部署环境（GIS 瓦片需要网络）。其余情况用逻辑地图前必须向用户说明理由
- 绝大多数页面 libraries 应为空数组`;
}

export function getCodePageSkillSummary(): string {
  return `## 代码页面
- HTML/CSS/JS 纯原生，CSS Grid/Flexbox 响应式布局
- 外部库通过 libraries 参数引入 CDN URL，系统按后缀自动以 <script> 或 <link> 加载
- **ECharts 与 echarts-gl 已内置**，图表直接使用全局 echarts 或 LubanUI.chart()，libraries 中禁止再引入 echarts 相关 CDN
- **中国地图已内置注册**：map: 'china' 可直接使用；省级地图下钻用 LubanUI.loadProvinceMap(adcode)；中国地图 geoJSON 属于内置能力，禁止引入 china.js 等 CDN 地图 JS

### ⭐ 推荐工作流：脚手架 + 逐步完善
1. **create_page_scaffold** → 生成正确的初始模板（初始化模式、DataQuery 调用、LubanUI 组件）
2. **update_code_page** → 补充表格列、表单字段等业务逻辑
3. 如有待修问题 → 每次修 1-2 个，逐步完善
这种方式对 LLM 最友好，避免一次生成大量代码导致多个错误。

### ⚠️ DataQuery 调用规则（详细示例请调用 get_dataquery_guide 工具）
- **唯一正确方式**：DataQuery.queryName(params).then(fn)，返回 Promise<{rows, columns, totalCount}>
- 写操作同样用 DataQuery，返回 Promise<{affectedRows, success}>
- 禁止 .run() / result.data.rows / async function 声明 / JSON.stringify(row) / TODO假成功
- 可用查询名在 window.__QUERIES__ 数组中列出
- 写操作必须有对应 DataQuery 写查询，否则委派 DBA 创建

### 其他规则
- API 调用：window.__LUBAN__.callApi(apiName, params)
- **定时器/监听必须注册清理**：页面内使用 setInterval/setTimeout/addEventListener 时，用 window.__LUBAN__.onPageUnload(function(){ clearInterval(t); window.removeEventListener(...); }) 注册清理函数，页面切换和热更新时平台会自动调用，否则会泄漏并重复执行
- **禁止 fetch() 获取平台内部数据**（/api/... 会被 CORS 拦截）。fetch() 仅允许第三方公开数据源
- 字段名必须与查询 columns 完全一致，禁止编造
- queryIds / toolIds 必须填写实际 ID，不能留空数组
- **筛选/搜索必须服务端完成**：在 filterParams 中声明筛选参数，禁止全量加载后 JS 过滤
- 平台注入：window.__LUBAN_USER__（当前用户）、window.__LUBAN__（navigateToPage/callApi/startWorkflow/getPageParams/getAllPages）
- 跨页面参数名必须一致：navigateToPageByName('详情', { orderNo }) → 目标页面 params.orderNo`;
}

export function getDataQueryGuide(): string {
  return `## DataQuery 完整使用指南

平台在 window.DataQuery 上自动注册了所有绑定查询的包装函数，包括读（SELECT）和写（INSERT/UPDATE/DELETE），**这是唯一正确的数据调用方式**。

\`\`\`js
// ✅ 读操作：DataQuery.queryName(params) — 返回 Promise<{rows, columns, totalCount}>
DataQuery.getCustomerList(params).then(function(result) {
  var rows = result.rows;
});

// ✅ 写操作：同样用 DataQuery，DBA 会为 INSERT/UPDATE/DELETE 创建对应查询
// 写查询返回 Promise<{affectedRows, success}>
DataQuery.insertCustomer(formData).then(function(result) {
  LubanUI.toast.success('保存成功');
  searchData();
});
DataQuery.updateCustomer({ id: editId, ...formData }).then(function(result) {
  LubanUI.toast.success('更新成功');
  searchData();
});
DataQuery.deleteCustomer({ id: deleteId }).then(function(result) {
  LubanUI.toast.success('删除成功');
  searchData();
});

// ❌ 禁止：直接调 .run()（容易写错查询名/命名空间/回调模式）
getCustomers.run(params)          // 禁止
__getCustomers.run(params)        // 禁止（__前缀不存在）
window.QueryApi.getCustomers.run() // 禁止（QueryApi不存在）
getCustomers.run(params, cb)      // 禁止（.run()不支持回调）
result.data.rows                  // 禁止（没有.data包裹）

// ❌ 禁止：TODO + 假成功（没有调用 DataQuery 就 toast.success）
// TODO: 调用API
LubanUI.toast.success('保存成功'); // 禁止！这是假成功，数据没有持久化

// ❌ 禁止：async function 声明（onclick 无法访问，运行时 ReferenceError）
async function saveCustomer() { ... }  // 禁止！onclick="saveCustomer()" 会报 is not defined
// ✅ 正确：用 function + .then() 或 var + async function 表达式
function saveCustomer() {
  DataQuery.insertCustomer(formData).then(function(result) { ... });
}
// 或
var saveCustomer = async function() {
  var result = await DataQuery.insertCustomer(formData);
};

// ❌ 禁止：JSON.stringify(row) 在 render 中使用（触发 toJSON 属性访问导致字段名校验报错）
render: { operation: function(v, row) {
  return '<button onclick="openEdit(' + JSON.stringify(row) + ')">编辑</button>';  // 禁止！
}}
// ✅ 正确：只传 id，编辑时从 table.getData() 查找行数据
render: { operation: function(v, row) {
  return '<button onclick="openEdit(' + row.id + ')">编辑</button>';
}}
function openEdit(id) {
  var row = table.getData().find(function(item) { return item.id === id; });
  // 回填表单...
}
\`\`\`

**写操作（新增/编辑/删除）必须调用对应的 DataQuery 写查询，禁止写 TODO 或假成功。如果 DataQuery 上没有写查询，说明需求分析遗漏了，应委派 DBA 创建。**`;
}

export function getDelegateQuerySkillSummary(): string {
  return `## 数据操作
- 你**不知道**数据库结构，**不能**直接操作查询、数据源或 API
- 所有数据相关操作委派给数据辅助智能体（DBA），用自然语言描述需求即可，DBA 会自行判断该做什么
- 仔细阅读 DBA 的回复：如果 DBA 请求确认，转达给用户；如果 DBA 汇报完成，继续下一步`;}

export function getFindWorkflowSkillSummary(): string {
  return `## 流程管理
- 你**不直接**操作流程、表单、组织架构，全部委派给流程设计助手
- 任何流程相关的需求，调用 delegate_workflow 工具，用自然语言描述需求
- 支持的任务类型：
  - design_form：设计表单
  - design_workflow：设计审批流程（可仅设计流程，不设计表单，页面通过弹窗发起）
  - query_org：查询成员/部门/角色
  - approval_task：处理审批（通过/驳回/加签/委派/驳回至节点/逐级驳回）
  - process_ops：流程运维（冻结/解冻/取消/强制终止/强制撤回/修改处理人）
  - lint：代码校验（表单代码/字段Schema/流程定义/条件表达式）
  - copy_preview：复制/预览/验证/版本
  - general：通用流程问题
- 如果用户明确说不需要表单，或页面有自己的弹窗，委派时说明「仅设计流程，不需要表单」`;
}

export function getFindAnalysisSkillSummary(): string {
  return `## 需求分析
- 收到用户需求后，**自行完成需求分析**，不再委派给其他智能体
- 分析规范详见「需求分析规范」章节，必须严格遵守 8 章节格式和内容具体化原则
- **⚠️ 分析报告和 submit_analysis 必须在同一次回复中完成**：先输出分析报告文本，然后立即在同一个 assistant message 中调用 submit_analysis 工具，提交结构化数据+自评打分。系统会自动推导执行计划，无需手动构造步骤
- submit_analysis 需提交分析报告的结构化数据（pages + workflows + interactions + analysisReport + score），计划步骤由系统自动推导
- **analysisReport 为必填**：将完整分析报告文本传入，执行阶段会注入此报告作为上下文，确保每步执行能获取完整分析内容
- **score 为必填**，按以下评分标准自评：
  - **模块展开深度（0-25）**：每个模块有展示内容+数据来源+交互方式得满分；笼统描述（如"相关指标"）扣分；漏推断组件（如需求涉及地理但无地图）扣分
  - **交互复杂度（0-25）**：纯展示页满分；有交互按丰富度加分（筛选+联动+下钻+图表点击+跨组件刷新各+4）；无交互说明得0分
  - **数据覆盖度（0-25）**：每个模块有对应查询/API得满分；模块无数据来源扣分
  - **字段具体性（0-25）**：字段有类型标注（文本/数字/日期/选项）得满分；笼统字段扣分；needsNewTable 但缺 fields 扣分
- **submit_analysis 必须在输出分析报告的同一个 assistant message 中调用**：先输出报告文本，紧接着调用 submit_analysis（不要分两条消息）。submit_analysis 返回后计划自动展示，此时不要重复报告内容，等待用户确认。**禁止只输出报告文本而不调 submit_analysis——这会导致计划无法生成**
- **禁止自行调用 confirm_plan**，用户明确回复后（如"确认"、"开始"）才调用 confirm_plan 开始执行
- 不要在分析阶段调用其他工具（数据操作、创建页面等）
- 分析结果中的字段都是业务语言描述，实际的数据库字段由 DBA 负责映射`;
}

export function getPlanPromptFragment(): string {
  return `## 计划管理能力

你可以使用以下计划管理工具来组织复杂任务：

### 何时使用计划
- 用户需求明确，需要多个步骤才能完成
- 涉及创建页面、修改代码、配置数据源等多个操作
- 用户明确说"开始执行"、"确认"、"没问题"等确认信号

### 何时不用计划
- 需求不明确，需要先向用户提问澄清
- 简单问答、闲聊、单个操作
- 用户只是询问信息，不需要执行操作

### 计划工作流
1. **需求澄清** → 需求不明确时直接提问，不创建计划
2. **提交分析** → 调用 submit_analysis，提交结构化分析数据（pages + workflows）。**系统自动推导执行步骤**，无需手动构造 items：
   - 每个数据查询需求 → 系统自动生成 delegate_query 步骤
   - 每个编排需求（pages[].orchestrations） → 系统自动生成 delegate_orchestration 步骤（依赖对应查询步骤）
   - 每个已有 API 引用（pages[].apis） → 仅作为页面绑定信息，不生成步骤
   - 每个新增页面 → 系统自动生成 create_code_page 步骤（依赖对应查询 + 编排步骤）
   - 每个需修改的页面 → 系统自动生成 update_code_page 步骤
   - 每个流程需求 → 系统自动生成 delegate_workflow 步骤（先 form 后 workflow）
   - 步骤依赖关系 → 系统自动推导（页面依赖查询+编排，编排依赖查询，流程依赖表单）
3. **用户确认** → 计划展示给用户，确认所有步骤
4. **执行步骤** → 按顺序调用工具，每步用 update_plan_item 标记状态。**禁止跳过任何步骤**，一个代码更新可能覆盖多个步骤，但每个步骤都必须单独标记为 completed
5. **完成验证** → 所有步骤标记完成后，调用 validate_plan 检查。如果 validate_plan 返回未完成的步骤，必须立即标记完成

### 计划灵活性
- 执行中用户补充需求 → 调用 adjust_plan 追加步骤
- 用户说"先做别的" → 调用 list_unfinished_plans 查看，set_focus_plan 切换
- 步骤失败 → 自动标记为 error，继续执行后续步骤
- **⚠️ 计划完整性检查**：展示计划给用户前，确认所有需求（含编排/工作流）都在计划步骤中有对应项。若用户需求涉及编排但计划缺少 delegate_orchestration 步骤，立即调用 adjust_plan 补上`;
}

export function getAnalysisPromptFragment(): string {
  return `## 需求分析规范

### 输出格式（8 章节，不得增减）

\`\`\`
# 需求分析报告
## 1. 需求概述（业务背景 → 核心目标 → 模块间数据关系）
## 2. 功能模块（逐模块展开：展示内容、数据来源、交互方式）
## 3. 页面规划（新增/修改，页面间跳转关系）
## 4. UI 分析（ASCII 布局图 + 组件清单，含弹窗/抽屉/空状态）
## 5. 数据字段（按模块分组：列表字段 + 表单字段 + 筛选字段）
## 6. 待确认问题（无则写"无"）
## 7. 数据需求（每个页面声明查询/API 需求，见下方格式）
## 8. 交互与联动（操作路径 + 数据刷新范围 + 异常处理，逐条列出）
\`\`\`

### 第 2 章「功能模块」规则
- **必须逐模块展开**，每个模块写明：展示内容、数据来源、交互方式
- 禁止一句话概括（❌ "告警指标统计（总数/critical/warning/已恢复）"）
- **领域组件推断**：根据需求领域主动推断组件类型（地理/位置/区域/线路/站点→ECharts地图、监控/运维→统计卡片、占比→饼图、排名/对比→柱状图、列表/明细→表格+筛选），不要只写显而易见的模块

### 第 7 章「数据需求」规则
- 每个查询必须声明**筛选参数**（来自第5章的筛选字段），即使当前无筛选也要显式写"无筛选参数"
- ⚠️ **主智能体不写 SQL**：只需声明筛选参数的名称、类型、匹配方式（如 keyword(文本,模糊搜索)/level(选项,精确匹配)），SQL 由 DBA 根据筛选参数自动生成参数化查询（OGNL <where><if> 标签）
- 禁止在数据需求中写 SELECT / WHERE / JOIN 等 SQL 语句
- 每个页面独立声明查询/API 需求
- 查询名称用英文驼峰（如 GetAlertsWide），对应代码中 QueryName.run() 调用
- 需要新建宽表时，标注"新建宽表"并列出字段（⚠️ Agent 禁止 DDL，建表需人工在数据源面板操作）
- **建模注意——快照指标与明细分离**：全网汇总类指标（在线设备数、今日告警数、总销售额等"一天/一时点一行"的快照）必须声明为独立表，禁止混进站点/订单等明细表的每一行，否则行数增长导致指标重复、查询只能靠"取第一行"出数
- 无数据页面标注"无需数据加载"
- 自查：每个模块的数据来源是否在第 7 章有对应查询？每个字段是否被查询覆盖？

### 第 8 章「交互与联动」规则
- **必须逐条列出完整的触发→响应链路**，禁止省略或写"无"
- 每条包含：触发动作 → 响应行为（含数据刷新范围） → 异常处理
- 格式：触发动作 → 响应（如：筛选查询 → 刷新统计卡片+图表+表格 → 无数据时显示空状态）
- **交互模式**：联动（操作一个组件影响其他组件）、下钻（点击进入更细粒度视图）、跳转（导航到其他页面）、展开收起
- **可点击组件必须写出交互**：地图标记、图表扇区/柱子、表格行等可点击元素，必须写出点击后触发什么（联动筛选/下钻详情/弹窗/跳转）
- 无交互时写"纯展示页面，无交互联动"

### 提交分析规则
调用 submit_analysis 时，只需提交结构化数据（pages + workflows），计划步骤由系统自动推导：
- L4 新建页面：pages 中 action=create，queries 填写查询需求 → 系统自动生成 delegate_query + create_code_page
- L3 页面改造（需新查询）：pages 中 action=update，queries 填写新增查询 → 系统自动生成 delegate_query + update_code_page
- L3 页面改造（无需新查询）：pages 中 action=update，queries 为空 → 系统只生成 update_code_page
- 审批流程：workflows 中 hasForm=true, hasWorkflow=true → 系统自动生成 design_form + design_workflow
- **已有查询直接绑定**：探查发现查询已存在时，在 pages[].queries 中填 queryId（同时保留 queryName/purpose）——系统只绑定页面、不生成创建步骤。禁止把已有查询留空 queries 或塞进 apis（apis 仅用于平台 API/工具，查询不是 API）
建表 ≠ 创建查询：建表是 DDL，创建查询是 SQL SELECT。needsNewTable=true 仅表示需要新表，实际建表需人工操作，Agent 只负责创建查询。

⚠️ **完整示例（客户管理/监控大屏/审批流程）请调用 get_analysis_examples 工具获取**。L4 新建页面时建议先查看示例再写分析报告。`;
}

export function getAnalysisExamples(): string {
  return `## 需求分析完整示例

### 示例 1：普通业务页面（表格+表单+指标）— "客户管理页面"

\`\`\`
# 需求分析报告

## 1. 需求概述
销售人员需要客户管理页面，集中管理客户信息，支持新增/编辑/删除/搜索，并展示关键指标。

## 2. 功能模块
#### 模块 1：统计指标
- 展示内容：3 个卡片（客户总数、本月新增、待跟进）
- 数据来源：客户表 COUNT 聚合
- 交互方式：纯展示

#### 模块 2：筛选栏
- 展示内容：关键词搜索 + 客户等级下拉 + 来源下拉
- 数据来源：无（筛选条件）
- 交互方式：输入/选择后点查询刷新表格，点重置清空

#### 模块 3：客户列表
- 展示内容：表格，列：客户名称/等级/来源/负责人/最近跟进/状态
- 数据来源：客户表 SELECT 列表
- 交互方式：点击行查看详情（抽屉），操作列有编辑/删除按钮

#### 模块 4：新增/编辑弹窗
- 展示内容：表单，字段：客户名称(必填)/等级(必填)/来源/负责人/备注
- 数据来源：无（表单提交）
- 交互方式：点新增/编辑打开弹窗，填写后提交，成功关闭弹窗并刷新列表

## 3. 页面规划
- 新增页面：客户管理

## 4. UI 分析
┌──────────────────────────────────────┐
│ pageHeader - 客户管理  [新增客户按钮]   │
├──────────────────────────────────────┤
│ [客户总数] [本月新增] [待跟进]          │
├──────────────────────────────────────┤
│ 筛选：关键词 + 等级 + 来源 + 查询/重置  │
├──────────────────────────────────────┤
│ 客户列表表格                    [分页]  │
└──────────────────────────────────────┘
组件：PageHeader + StatsCard + FilterBar + Table + Modal(新增/编辑) + Drawer(详情) + ConfirmModal(删除)

## 5. 数据字段
#### 统计指标
- 客户总数(COUNT)、本月新增(COUNT WHERE 本月)、待跟进(COUNT WHERE status='待跟进')
#### 列表展示
- 客户名称(文本)、等级(选项：A/B/C)、来源(选项)、负责人(文本)、最近跟进(日期)、状态(选项：活跃/待跟进/流失)
#### 表单字段
- 客户名称(文本,必填)、等级(选项,必填)、来源(选项)、负责人(文本)、备注(多行文本)
#### 筛选字段
- 关键词(可搜索)、等级(可筛选)、来源(可筛选)

## 6. 待确认问题
无

## 7. 数据需求
### 页面：客户管理
- 查询需求：
  - 查询名称：GetCustomers
  - 用途：统计卡片 + 列表
  - 数据来源：已有表 customers（id, name, level, source, owner, last_follow_up, status, note, created_time）
  - 筛选参数：keyword(文本,模糊搜索name)、level(选项,精确匹配)、source(选项,精确匹配)
- API 需求：无
- 自查：✅ 每个模块有数据来源，每个字段被查询覆盖

## 8. 交互与联动
- 进入页面 → 自动加载统计卡片 + 列表
- 筛选查询 → 刷新统计卡片 + 列表表格 → 无数据时显示空状态
- 筛选重置 → 清空筛选 + 刷新统计卡片 + 列表表格
- 点击新增 → 打开弹窗表单
- 点击编辑 → 打开弹窗，回填该行数据
- 弹窗提交 → 成功：关闭弹窗 + toast + 刷新统计卡片 + 列表表格 → 失败：error toast
- 点击删除 → 弹出确认弹窗 → 确认后删除 + toast + 刷新统计卡片 + 列表表格
- 点击表格行 → 打开详情抽屉
\`\`\`

对应 submit_analysis 调用参数（系统自动推导步骤，无需手动构造 items）：
\`\`\`json
{
  "title": "创建客户管理页面",
  "summary": "新建客户管理页面，包含统计指标、筛选、列表、新增/编辑弹窗",
  "pages": [
    {
      "name": "客户管理",
      "action": "create",
      "queries": [{ "queryName": "GetCustomers", "purpose": "统计卡片+列表", "needsNewTable": false, "fields": "id,name,level,source,owner,last_follow_up,status,note,created_time", "filterParams": "keyword(文本,模糊搜索name), level(选项,精确匹配), source(选项,精确匹配)" }],
      "apis": []
    }
  ],
  "workflows": []
}
\`\`\`

---

### 示例 2：监控大屏（地图+表格+图表+指标）— "告警监控屏"

\`\`\`
# 需求分析报告

## 1. 需求概述
运维人员需要告警监控大屏，集中展示告警指标、地理分布、级别分布和实时列表，快速定位异常。

## 2. 功能模块
#### 模块 1：统计卡片区
- 展示内容：4 个卡片（总告警数、Critical 数、Warning 数、已恢复数）
- 数据来源：告警宽表 COUNT 聚合
- 交互方式：纯展示

#### 模块 2：告警地图
- 展示内容：地图上标注告警发生位置，按级别着色（红=Critical，橙=Warning）
- 数据来源：告警宽表（需含 location 字段）
- 交互方式：点击标记显示告警详情弹窗

#### 模块 3：告警级别分布
- 展示内容：饼图展示各级别占比
- 数据来源：告警宽表按 level 分组统计
- 交互方式：悬浮显示数值

#### 模块 4：告警来源分布
- 展示内容：柱状图按来源展示告警数量
- 数据来源：告警宽表按 source 分组统计
- 交互方式：悬浮显示数值

#### 模块 5：实时告警列表
- 展示内容：表格，列：名称/级别/来源/位置/时间/状态
- 数据来源：告警宽表 SELECT 列表
- 交互方式：按级别和来源筛选

## 3. 页面规划
- 新增页面：告警监控大屏

## 4. UI 分析
┌──────────────────────────────────────────┐
│ pageHeader - 告警监控大屏                   │
├──────────────────────────────────────────┤
│ [总告警] [Critical] [Warning] [已恢复]      │
├──────────────┬───────────────────────────┤
│ 告警地图      │ 饼图(级别)  │ 柱状图(来源)  │
├──────────────┴───────────────────────────┤
│ 筛选栏：级别 + 来源 + 查询/重置              │
├──────────────────────────────────────────┤
│ 告警列表表格                                │
└──────────────────────────────────────────┘
组件：PageHeader + StatsCard + ECharts地图 + ECharts(饼图+柱状图) + FilterBar + Table + EmptyState
外部库：无（ECharts 已内置，LubanUI.chart 直接使用）

## 5. 数据字段
#### 统计指标
- 总告警数(COUNT)、Critical数(COUNT)、Warning数(COUNT)、已恢复数(COUNT)
#### 地图标记
- 位置(文本/坐标)、级别(选项)、名称(文本)
- 使用 ECharts 的 scatter/effectScatter 在地图上标记点位，按级别着色（红=Critical，橙=Warning）
#### 图表
- 级别(选项)、级别数量(COUNT)、来源(文本)、来源数量(COUNT)
#### 告警列表
- 告警名称(文本)、级别(选项)、来源(文本)、位置(文本)、产生时间(日期)、状态(选项)
- 筛选字段：级别(可筛选)、来源(可筛选)

## 6. 待确认问题
无

## 7. 数据需求
### 页面：告警监控大屏
- 查询需求：
  - 查询名称：GetAlertsWide
  - 用途：统计卡片 + 地图标记 + 饼图 + 柱状图 + 列表（一个查询服务多模块）
  - 数据来源：已有表 alerts（id, alert_name, level, source, location, created_time, status）
  - 筛选参数：level(选项,精确匹配)、source(文本,模糊匹配)
- API 需求：无
- 自查：✅ 每个模块有数据来源，每个字段被查询覆盖

## 8. 交互与联动
- 进入页面 → 自动加载统计卡片 + 地图 + 饼图 + 柱状图 + 列表
- 筛选查询 → 刷新统计卡片 + 地图标记 + 饼图 + 柱状图 + 列表表格（一触全刷） → 无数据时显示空状态
- 筛选重置 → 清空筛选 + 恢复全量数据
- 地图点击标记 → 弹窗显示该告警详情（ECharts 点击事件）
- 饼图点击扇区 → 筛选栏自动选中对应级别 + 刷新表格
- 柱状图点击柱子 → 筛选栏自动选中对应来源 + 刷新表格
- 加载失败 → toast 提示
\`\`\`

对应 submit_analysis 调用参数（系统自动推导步骤，无需手动构造 items）：
\`\`\`json
{
  "title": "创建告警监控大屏",
  "summary": "新建告警监控大屏，包含统计卡片、地图、饼图、柱状图、筛选和列表",
  "pages": [
    {
      "name": "告警监控大屏",
      "action": "create",
      "queries": [{ "queryName": "GetAlertsWide", "purpose": "统计卡片+地图+饼图+柱状图+列表", "needsNewTable": false, "fields": "id,alert_name,level,source,location,created_time,status", "filterParams": "level(选项,精确匹配), source(文本,模糊匹配)" }],
      "apis": [],
      "libraries": []
    }
  ],
  "workflows": []
}
\`\`\`

---

### 示例 3：审批流程 — "请假审批"

\`\`\`
# 需求分析报告

## 1. 需求概述
员工需要请假审批流程，提交请假申请后按条件自动流转审批节点。

## 2. 功能模块
#### 模块 1：请假表单
- 展示内容：请假类型、起止日期、请假天数、请假原因
- 数据来源：无（表单提交）
- 交互方式：填写后提交发起审批

#### 模块 2：审批流程
- 展示内容：请假 ≤3 天 → 直属上级审批；>3 天 → 直属上级 → 部门经理审批
- 数据来源：无（流程引擎处理）
- 交互方式：审批人通过/驳回，可加签

## 3. 页面规划
- 无需创建页面（流程由流程设计助手处理，发起入口在已有页面中）

## 4. UI 分析
- 表单布局：纵向表单，请假类型(下拉) + 起止日期(日期范围) + 天数(数字) + 原因(多行文本)
- 无需绘制页面布局（非页面类需求）

## 5. 数据字段
#### 请假表单
- 请假类型(选项:年假/事假/病假/调休,必填)、开始日期(日期,必填)、结束日期(日期,必填)、请假天数(数字,必填)、请假原因(多行文本,必填)

## 6. 待确认问题
无

## 7. 数据需求
### 无页面数据需求
- 本需求为审批流程，不涉及页面数据加载

## 8. 交互与联动
- 填写表单 → 提交 → 流程自动流转
- 请假天数≤3天 → 直属上级审批 → 通过/驳回 → 结束
- 请假天数>3天 → 直属上级审批 → 通过 → 部门经理审批 → 通过/驳回 → 结束
- 任意节点驳回 → 退回发起人 → 修改后可重新提交
\`\`\`

对应 submit_analysis 调用参数（系统自动推导步骤，无需手动构造 items）：
\`\`\`json
{
  "title": "创建请假审批流程",
  "summary": "设计请假表单，再设计条件分支审批流程（≤3天直属上级，>3天加部门经理）",
  "pages": [],
  "workflows": [
    {
      "description": "请假审批",
      "hasForm": true,
      "formDescription": "设计请假表单，字段：请假类型(下拉选项:年假/事假/病假/调休,必填)、开始日期(日期,必填)、结束日期(日期,必填)、请假天数(数字,必填)、请假原因(多行文本,必填)",
      "hasWorkflow": true,
      "workflowDescription": "设计请假审批流程，条件分支：请假天数≤3天→直属上级审批；>3天→直属上级审批→部门经理审批。支持驳回退回发起人、加签"
    }
  ]
}
\`\`\`

⚠️ **审批流程至少两步**：先 design_form 设计表单，再 design_workflow 设计流程（依赖表单）。不创建页面步骤。`;
}