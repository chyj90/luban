// LubanUI 组件展示页
// 当应用没有页面时，默认展示此页面，可以看到所有组件的样子

export const SHOWCASE_PAGE = {
  html: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LubanUI 组件库</title>
</head>
<body>
  <div class="showcase">
    <div class="showcase-header">
      <h1>LubanUI 组件库</h1>
      <p class="showcase-subtitle">平台内置 UI 组件，所有页面均可使用，风格与平台保持一致</p>
    </div>

    <!-- 统计卡片 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">统计卡片 Stats</h2>
      <div class="luban-stats-grid">
        <div class="luban-stat-card luban-stat-card-primary">
          <div class="luban-stat-label">总用户数</div>
          <div class="luban-stat-value">12,846</div>
          <div class="luban-stat-change luban-stat-up">↑ 12.5%</div>
        </div>
        <div class="luban-stat-card luban-stat-card-success">
          <div class="luban-stat-label">本月新增</div>
          <div class="luban-stat-value">1,204</div>
          <div class="luban-stat-change luban-stat-up">↑ 8.2%</div>
        </div>
        <div class="luban-stat-card luban-stat-card-warning">
          <div class="luban-stat-label">活跃用户</div>
          <div class="luban-stat-value">3,891</div>
          <div class="luban-stat-change luban-stat-down">↓ 3.1%</div>
        </div>
        <div class="luban-stat-card luban-stat-card-danger">
          <div class="luban-stat-label">转化率</div>
          <div class="luban-stat-value">24.6%</div>
          <div class="luban-stat-change luban-stat-up">↑ 5.3%</div>
        </div>
      </div>
    </section>

    <!-- 表格 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">表格 Table</h2>
      <div class="luban-table-toolbar">
        <span class="luban-table-info">共 5 条记录</span>
      </div>
      <table class="luban-table" id="demoTable">
        <thead>
          <tr>
            <th class="sortable">姓名</th>
            <th class="sortable">部门</th>
            <th class="sortable">职位</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <div class="luban-pagination" id="demoTablePagination"></div>
    </section>

    <!-- 按钮 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">按钮 Button</h2>
      <div class="showcase-row">
        <button class="luban-btn luban-btn-primary">主按钮</button>
        <button class="luban-btn luban-btn-secondary">次要按钮</button>
        <button class="luban-btn">默认按钮</button>
        <button class="luban-btn" disabled>禁用</button>
        <button class="luban-btn luban-btn-danger">危险按钮</button>
        <button class="luban-btn luban-btn-success">成功按钮</button>
        <button class="luban-btn luban-btn-text">文字按钮</button>
      </div>
      <div class="showcase-row" style="margin-top: 10px;">
        <button class="luban-btn luban-btn-primary luban-btn-sm">小按钮</button>
        <button class="luban-btn luban-btn-primary luban-btn-lg">大按钮</button>
        <button class="luban-btn luban-btn-primary luban-btn-loading">加载中</button>
      </div>
      <div class="showcase-row" style="margin-top: 10px;">
        <button class="luban-btn luban-btn-primary luban-btn-block">全宽按钮</button>
      </div>
    </section>

    <!-- 输入框 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">输入框 Input</h2>
      <div class="showcase-grid">
        <div>
          <label class="luban-form-label">文本输入</label>
          <input class="luban-input" placeholder="请输入内容" style="margin-top: 4px;">
        </div>
        <div>
          <label class="luban-form-label">小尺寸</label>
          <input class="luban-input luban-input-sm" placeholder="小尺寸输入框" style="margin-top: 4px;">
        </div>
        <div>
          <label class="luban-form-label">大尺寸</label>
          <input class="luban-input luban-input-lg" placeholder="大尺寸输入框" style="margin-top: 4px;">
        </div>
        <div>
          <label class="luban-form-label">错误状态</label>
          <input class="luban-input luban-input-error" value="错误内容" style="margin-top: 4px;">
        </div>
        <div>
          <label class="luban-form-label">禁用状态</label>
          <input class="luban-input" disabled placeholder="禁用输入框" style="margin-top: 4px;">
        </div>
        <div>
          <label class="luban-form-label">多行文本</label>
          <textarea class="luban-textarea" placeholder="请输入多行文本" style="margin-top: 4px;">多行文本区域，支持自动换行和拖拽调整大小</textarea>
        </div>
        <div>
          <label class="luban-form-label">可清空</label>
          <div class="luban-input-clearable" style="margin-top: 4px;">
            <input class="luban-input" id="clearInput" placeholder="输入后出现清空按钮" value="可清空内容">
            <span class="luban-input-clear" onclick="this.previousElementSibling.value='';this.previousElementSibling.focus()">✕</span>
          </div>
        </div>
        <div>
          <label class="luban-form-label">前后缀</label>
          <div class="luban-input-affix" style="margin-top: 4px;">
            <span class="luban-input-prefix">¥</span>
            <input class="luban-input" placeholder="金额">
            <span class="luban-input-suffix">元</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 下拉选择 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">下拉选择 Select</h2>
      <div class="showcase-grid">
        <div>
          <label class="luban-form-label">下拉选择</label>
          <div style="margin-top: 4px;">
            <select class="luban-select">
              <option value="">请选择</option>
              <option value="1">选项一</option>
              <option value="2">选项二</option>
              <option value="3">选项三</option>
            </select>
          </div>
        </div>
        <div>
          <label class="luban-form-label">禁用状态</label>
          <div style="margin-top: 4px;">
            <select class="luban-select" disabled>
              <option>禁用下拉</option>
            </select>
          </div>
        </div>
      </div>
    </section>

    <!-- 数字输入 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">数字输入 InputNumber</h2>
      <div class="showcase-row">
        <div style="width: 200px;">
          <label class="luban-form-label">数字输入</label>
          <input type="number" class="luban-input-number" value="100" min="0" max="999" style="margin-top: 4px;">
        </div>
      </div>
    </section>

    <!-- 日期选择 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">日期选择 DatePicker</h2>
      <div class="showcase-grid">
        <div>
          <label class="luban-form-label">日期</label>
          <input type="date" class="luban-datepicker" style="margin-top: 4px;">
        </div>
        <div>
          <label class="luban-form-label">日期范围</label>
          <div class="luban-date-range" style="margin-top: 4px;">
            <input type="date" class="luban-datepicker">
            <span class="luban-date-range-separator">至</span>
            <input type="date" class="luban-datepicker">
          </div>
        </div>
      </div>
    </section>

    <!-- 复选框 & 单选框 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">复选框 Checkbox / 单选框 Radio</h2>
      <div class="showcase-row" style="gap: 32px;">
        <div>
          <label class="luban-form-label" style="margin-bottom: 8px; display: block;">复选框</label>
          <div class="luban-checkbox-group luban-checkbox-group-vertical">
            <label class="luban-checkbox"><input type="checkbox" checked> 选项 A</label>
            <label class="luban-checkbox"><input type="checkbox"> 选项 B</label>
            <label class="luban-checkbox"><input type="checkbox" disabled> 选项 C（禁用）</label>
          </div>
        </div>
        <div>
          <label class="luban-form-label" style="margin-bottom: 8px; display: block;">单选框</label>
          <div class="luban-radio-group luban-radio-group-vertical">
            <label class="luban-radio"><input type="radio" name="demo" checked> 选项 A</label>
            <label class="luban-radio"><input type="radio" name="demo"> 选项 B</label>
            <label class="luban-radio"><input type="radio" name="demo" disabled> 选项 C（禁用）</label>
          </div>
        </div>
        <div>
          <label class="luban-form-label" style="margin-bottom: 8px; display: block;">开关</label>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <label class="luban-switch"><input type="checkbox" checked> 开启</label>
            <label class="luban-switch"><input type="checkbox"> 关闭</label>
            <label class="luban-switch"><input type="checkbox" disabled> 禁用</label>
          </div>
        </div>
      </div>
    </section>

    <!-- 标签页 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">标签页 Tabs</h2>
      <div class="luban-tabs" id="demoTabs">
        <div class="luban-tabs-nav">
          <button class="luban-tab-item active" data-tab="tab1">标签一</button>
          <button class="luban-tab-item" data-tab="tab2">标签二</button>
          <button class="luban-tab-item" data-tab="tab3">标签三</button>
        </div>
        <div class="luban-tab-content active" data-tab="tab1">标签一的内容区域</div>
        <div class="luban-tab-content" data-tab="tab2">标签二的内容区域</div>
        <div class="luban-tab-content" data-tab="tab3">标签三的内容区域</div>
      </div>
    </section>

    <!-- 卡片 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">卡片 Card</h2>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <div class="luban-card luban-card-hoverable" style="flex:1;min-width:280px;">
          <div class="luban-card-header">
            <span class="luban-card-title">可悬停卡片</span>
            <button class="luban-btn luban-btn-sm">操作</button>
          </div>
          <div class="luban-card-body">
            <p>hover 时浮起并显示蓝色边框</p>
          </div>
        </div>
        <div class="luban-card luban-card-bordered" style="flex:1;min-width:280px;">
          <div class="luban-card-header">
            <span class="luban-card-title">纯边框卡片</span>
          </div>
          <div class="luban-card-body">
            <p>仅边框，无阴影</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 弹窗 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">弹窗 Modal</h2>
      <button class="luban-btn luban-btn-primary" onclick="LubanUI.modal.open('demoModal')">打开弹窗</button>
    </section>

    <!-- 标签 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">标签 Badge</h2>
      <div class="showcase-row">
        <span class="luban-badge luban-badge-default">默认</span>
        <span class="luban-badge luban-badge-primary">主要</span>
        <span class="luban-badge luban-badge-success">成功</span>
        <span class="luban-badge luban-badge-warning">警告</span>
        <span class="luban-badge luban-badge-danger">危险</span>
        <span class="luban-badge luban-badge-info">信息</span>
        <span class="luban-badge luban-badge-dot luban-badge-success"></span>
        <span class="luban-badge luban-badge-dot luban-badge-danger"></span>
        <span style="position:relative;display:inline-flex;padding:4px 8px;background:var(--luban-bg);border-radius:4px;font-size:13px;">
          消息
          <span class="luban-badge luban-badge-count">3</span>
        </span>
      </div>
    </section>

    <!-- 筛选栏 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">筛选栏 FilterBar</h2>
      <div class="luban-filter-bar">
        <div class="luban-filter-item">
          <span class="luban-filter-label">关键词</span>
          <input class="luban-input" placeholder="搜索...">
        </div>
        <div class="luban-filter-item">
          <span class="luban-filter-label">状态</span>
          <select class="luban-select">
            <option value="">全部</option>
            <option value="1">启用</option>
            <option value="0">禁用</option>
          </select>
        </div>
        <div class="luban-filter-actions">
          <button class="luban-btn luban-btn-primary">查询</button>
          <button class="luban-btn">重置</button>
        </div>
      </div>
    </section>

    <!-- 消息提示 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">消息提示 Toast</h2>
      <div class="showcase-row">
        <button class="luban-btn luban-btn-success" onclick="LubanUI.toast.success('操作成功')">成功提示</button>
        <button class="luban-btn luban-btn-danger" onclick="LubanUI.toast.error('操作失败')">错误提示</button>
        <button class="luban-btn" onclick="LubanUI.toast.warning('请注意')">警告提示</button>
        <button class="luban-btn" onclick="LubanUI.toast.info('提示信息')">信息提示</button>
      </div>
    </section>

    <!-- 空状态 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">空状态 Empty</h2>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <div class="luban-empty luban-empty-action" style="flex:1;min-width:280px;">
          <div class="luban-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
          </div>
          <div class="luban-empty-text">暂无数据</div>
          <div class="luban-empty-description">当前没有可显示的内容，点击下方按钮创建第一条记录</div>
          <button class="luban-btn luban-btn-primary">立即创建</button>
        </div>
        <div class="luban-empty luban-empty-simple" style="flex:1;min-width:280px;border:1px solid var(--luban-border);border-radius:var(--luban-radius-md);">
          <div class="luban-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </div>
          <div class="luban-empty-text">暂无数据</div>
        </div>
      </div>
    </section>

    <!-- 加载 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">加载 Loading</h2>
      <div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;">
        <div class="luban-loading" style="padding:24px;border:1px solid var(--luban-border);border-radius:var(--luban-radius-md);">
          <div class="luban-spinner"></div>
          <div class="luban-loading-text">加载中...</div>
        </div>
        <div class="luban-loading luban-loading-inline" style="padding:12px 16px;border:1px solid var(--luban-border);border-radius:var(--luban-radius-md);">
          <div class="luban-spinner"></div>
          <span>行内加载...</span>
        </div>
      </div>
    </section>

    <!-- 图表容器 -->
    <section class="showcase-section">
      <h2 class="showcase-section-title">图表 Chart</h2>
      <div class="luban-chart-item">
        <div class="luban-chart-title">图表容器示例</div>
        <div class="luban-chart">
          <div id="demoChart" style="height:300px;"></div>
        </div>
      </div>
    </section>
  </div>

  <!-- 弹窗示例 -->
  <div class="luban-modal-overlay" id="demoModal" style="display:none;">
    <div class="luban-modal">
      <div class="luban-modal-header">
        <span class="luban-modal-title">弹窗标题</span>
        <button class="luban-modal-close" data-modal-close>✕</button>
      </div>
      <div class="luban-modal-body">
        <div class="luban-form">
          <div class="luban-form-item">
            <label class="luban-form-label luban-form-label-required">名称</label>
            <input class="luban-input" placeholder="请输入名称">
          </div>
          <div class="luban-form-item">
            <label class="luban-form-label">描述</label>
            <textarea class="luban-textarea" placeholder="请输入描述"></textarea>
          </div>
        </div>
      </div>
      <div class="luban-modal-footer">
        <button class="luban-btn" data-modal-close>取消</button>
        <button class="luban-btn luban-btn-primary" onclick="LubanUI.toast.success('保存成功'); LubanUI.modal.close('demoModal')">保存</button>
      </div>
    </div>
  </div>
</body>
</html>`,
  css: '',
  js: `// 展示页初始化
(function() {
  // 初始化标签页
  LubanUI.initTabs('demoTabs');

  // 初始化所有下拉选择
  LubanUI.initSelects();

  // 树形选择示例
  var treeSelect = document.createElement('select');
  treeSelect.className = 'luban-select';
  treeSelect.innerHTML = '<option value="">请选择地区</option>';
  var selectSection = document.querySelector('.showcase-grid');
  if (selectSection) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = '<label class="luban-form-label">树形选择</label><div style="margin-top:4px;"></div>';
    wrapper.querySelector('div').appendChild(treeSelect);
    selectSection.appendChild(wrapper);
    LubanUI.select(treeSelect).setOptions([
      { value: 'china', label: '中国', children: [
        { value: 'beijing', label: '北京' },
        { value: 'shanghai', label: '上海' },
        { value: 'guangzhou', label: '广州' }
      ]},
      { value: 'usa', label: '美国', children: [
        { value: 'ny', label: '纽约' },
        { value: 'la', label: '洛杉矶' }
      ]},
      { value: 'japan', label: '日本' }
    ]);
  }

  // 初始化表格
  var demoData = [
    { name: '张三', dept: '技术部', title: '高级工程师', status: '在职' },
    { name: '李四', dept: '产品部', title: '产品经理', status: '在职' },
    { name: '王五', dept: '设计部', title: 'UI设计师', status: '在职' },
    { name: '赵六', dept: '市场部', title: '市场总监', status: '离职' },
    { name: '孙七', dept: '运营部', title: '运营专员', status: '在职' },
  ];

  LubanUI.table('demoTable', {
    columns: ['name', 'dept', 'title', 'status', 'action'],
    data: demoData,
    pageSize: 3,
    render: {
      status: function(val) {
        var cls = val === '在职' ? 'luban-badge luban-badge-success' : 'luban-badge luban-badge-default';
        return '<span class="' + cls + '">' + val + '</span>';
      },
      action: function() {
        return '<button class="luban-btn luban-btn-sm luban-btn-text">编辑</button>' +
               '<button class="luban-btn luban-btn-sm luban-btn-text" style="color:var(--luban-danger)">删除</button>';
      }
    }
  });

  // 绘制图表
  var chartContainer = document.getElementById('demoChart');
  if (chartContainer && typeof echarts !== 'undefined') {
    var chart = echarts.init(chartContainer);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['销售额', '利润'], bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
      xAxis: { type: 'category', data: ['1月', '2月', '3月', '4月', '5月', '6月'] },
      yAxis: { type: 'value' },
      series: [
        { name: '销售额', type: 'bar', data: [120, 200, 150, 80, 250, 180], itemStyle: { color: '#1677ff' } },
        { name: '利润', type: 'line', data: [30, 50, 35, 20, 60, 45], itemStyle: { color: '#52c41a' }, smooth: true }
      ]
    });
  }
})();`,
  libraries: [],
  queryIds: [],
  toolIds: [],
};