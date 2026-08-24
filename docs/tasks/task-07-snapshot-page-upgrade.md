# Task-07: 快照页面升级为变更审计中心

## 涉及页面

| 页面 | 类型 | 说明 |
|------|------|------|
| `ConceptSnapshotPage.tsx` | 重写 | 从孤立快照列表升级为变更审计中心 |
| `ConceptSnapshotPage.css` | 修改 | 新增 diff 对比视图、回滚确认弹窗样式 |

## 新增页面

无

## 具体开发工作

### 后端

| 文件 | 工作内容 |
|------|----------|
| 新建 `ConceptSnapshotService.java` | 新增方法：<br/>  1. `autoSnapshot(groupId, changeDescription, sourceFeedbackId)`：超管在反馈页执行变更时自动调用，版本号自动生成 `v{groupCode}-{YYYYMMDD}-{序号}`<br/>  2. `diffSnapshots(snapshotId1, snapshotId2)`：对比两个快照版本，返回差异（新增概念、删除概念、重命名概念、映射变更、JOIN 变更），每个变更标注来源（feedbackId / 手动 / 导入）<br/>  3. `rollback(snapshotId)`：回滚到指定快照，回滚前自动创建当前状态快照（安全兜底），回滚后触发 FAISS 索引重建<br/>  4. `listByFeedbackId(feedbackId)`：查询某反馈关联的快照列表 |
| 新建 `ConceptSnapshotController.java` | 新增接口：<br/>  - `POST /api/v1/concept-snapshots/auto`：自动创建快照<br/>  - `GET /api/v1/concept-snapshots/{id1}/diff/{id2}`：快照对比<br/>  - `POST /api/v1/concept-snapshots/{id}/rollback`：回滚<br/>  - `GET /api/v1/concept-snapshots/by-feedback/{feedbackId}`：反馈关联查询 |
| `ConceptFeedbackService.java` | `applySuggestion()` 方法中调用 `ConceptSnapshotService.autoSnapshot()` |

### 前端

| 文件 | 工作内容 |
|------|----------|
| `ConceptSnapshotPage.tsx` | **列表增强**：<br/>  - 新增列：关联反馈数（点击可跳转到反馈列表）<br/>  - 新增列：变更前后监控指标对比（匹配率变化）<br/>  - 新增操作：对比、回滚、查看详情<br/>**快照对比（Diff）— 核心功能**：<br/>  - 选择两个快照版本<br/>  - 展示差异：新增概念（+N）、删除概念（-N）、重命名概念（old→new）、映射变更（字段级）、JOIN 变更（条件级）<br/>  - 每个变更标注来源（反馈 ID / 手动 / 导入）<br/>**快照回滚**：<br/>  - 选择目标快照 → 预览回滚影响 → 确认弹窗 → 执行<br/>  - 回滚后提示"已回滚到快照 vX.X.X，FAISS 索引正在重建中"<br/>**快照详情**：<br/>  - 关联的反馈列表（点击跳转）<br/>  - 创建前后的监控指标变化<br/>  - 此快照包含的概念列表 |
| `ConceptSnapshotPage.css` | 新增 diff 对比视图样式、回滚确认弹窗样式 |

### 与反馈页面联动

```
反馈页 [确认执行] → 自动调用 autoSnapshot() → 创建快照 → 快照列表显示关联反馈
反馈页 [预览变更] → 可手动点击 [创建快照] → 归档当前状态
快照页 [回滚] → 选择快照 → 确认 → 恢复概念状态 + 重建 FAISS
```

## 最终目标

ConceptSnapshotPage 成为变更审计中心，每次反馈驱动的变更自动存档，支持 diff 对比和回滚，保障本体变更安全可追溯。