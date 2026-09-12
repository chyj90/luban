import type { ComponentSpec } from '../componentSpecs';

export default {
  name: 'Pagination',
  category: 'navigation',
  spec: `### 分页 Pagination
分页由 LubanUI.table() 内置管理，无需手写。后端分页配置：pagination: 'server', totalCount: 0, onPageChange: fn。`,
} satisfies ComponentSpec;