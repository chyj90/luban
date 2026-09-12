import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Table',
  category: 'data-display',
  spec: `### 表格 Table
\`\`\`html
<table class="luban-table" id="myTable">
  <thead><tr><th class="sortable">列名</th><th>列名</th></tr></thead>
  <tbody></tbody>
</table>
\`\`\`
\`\`\`js
var table = LubanUI.table('myTable', {
  columns: ['field1', 'field2', 'status'],
  pageSize: 10,
  emptyText: '暂无数据',
  emptyDescription: '请先添加数据或调整筛选条件',
  emptyAction: 'showAddModal()',
  emptyActionText: '添加数据',
  render: { status: function(v) { return '<span class="luban-badge luban-badge-success">'+v+'</span>'; } },
  onRowClick: function(row, idx) { LubanUI.modal.open('detailModal'); }
});
table.setData(result.rows);
// 后端分页：pagination: 'server', totalCount: 0, onPageChange: fn
// table.setData(rows, totalCount) / table.setTotalCount(n) / table.getData() / table.getSelectedData()
// table.setLoading(true/false) / table.setPage(n)
// render 签名：function(val, row) — val 单元格值，row 整行数据
// 操作列：id: function(val, row) { return '<button onclick="edit(' + val + ')">编辑</button>'; }
// 编辑回填：var row = table.getData().find(function(r) { return r.id === id; });
\`\`\`
列头加 class="sortable" 支持点击排序。空态由组件自动渲染，禁止手写空状态 div。`,
} satisfies ComponentSpec;