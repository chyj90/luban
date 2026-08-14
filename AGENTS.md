# AGENTS.md — 鲁班 (Luban) AI 开发指南

> 本文档为 AI 开发助手（如 Claude、Codex 等）提供项目上下文和开发规范，确保 AI 生成的代码与现有代码库风格一致、可复用、可维护。

---

## 一、项目概览

鲁班是一个 AI 驱动的所见即所得应用构建平台。项目为前后端分离架构：

| 目录 | 技术栈 |
|------|--------|
| `frontend/` | React 19 + TypeScript + Vite 8 |
| `backend/` | Java 21 + Spring Boot 3.3.2 + MySQL 8.0 |

**关键依赖：** Zustand（状态管理）、Monaco Editor（代码编辑器）、@xyflow/react（流程设计器）、Axios（HTTP）、react-router-dom v7（路由）、react-markdown（Markdown 渲染）、lucide-react（图标库）、dagre（图布局）

---

## 二、UI 风格与视觉规范

### 2.1 核心原则：蓝白风格 · 不使用第三方 UI 组件库

本项目整体采用**蓝白风格**（Blue-White Theme）：以白色为底，蓝色（`#1677ff`）为主色调贯穿按钮、链接、选中态、聚焦态等交互元素，整体视觉干净、清爽、专业。

本项目**不使用** Ant Design、MUI、shadcn/ui 等任何第三方 UI 组件库。所有 UI 组件均使用**原生 HTML + 自定义 CSS** 构建。图标使用 `lucide-react` 或内联 SVG。

### 2.2 设计令牌（Design Tokens）

```css
/* 主色调 */
--color-primary: #1677ff;
--color-primary-hover: #4096ff;
--color-primary-light: #e6f4ff;
--color-primary-shadow: rgba(22, 119, 255, 0.1);

/* 背景色 */
--color-bg: #f4f6f9;
--color-bg-white: #fff;
--color-bg-hover: #f7fafc;

/* 边框 */
--color-border: #e8edf3;
--color-border-light: #e8ecf1;

/* 文字 */
--color-text: #1f1f1f;
--color-text-secondary: #555;
--color-text-muted: #8c9cab;
--color-text-label: #5a6a7e;

/* 语义色 */
--color-success: #52c41a;
--color-error: #ff4d4f;
--color-warning: #ffc107;
--color-info: #1677ff;
```

### 2.3 基础样式（已在 `index.css` 中定义）

- `font-family`: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- `font-size`: 14px（基准）
- 所有元素 `box-sizing: border-box`
- 按钮默认样式：`border-radius: 6px; padding: 8px 16px; background: #1677ff; color: #fff`
- 输入框默认样式：`border: 1px solid #e8edf3; border-radius: 6px; padding: 8px 12px`
- 输入框聚焦：`border-color: #1677ff; box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.1)`

### 2.4 新组件开发时

- **优先复用现有组件**：检查 `src/components/` 目录下是否已有可用的组件
- **如无现成组件**：创建新组件，放入 `src/components/` 目录，每个组件一个文件夹，包含 `index.tsx` 和对应 CSS 文件
- **组件应具备通用性**：设计为可复用的，通过 props 定制行为
- **CSS 命名**：使用 BEM 风格命名，以组件名作为前缀，如 `.devtoolbar-{子元素}`
- **CSS 文件组织**：通用组件使用普通 CSS 文件（`ComponentName.css`）；页面级或复杂组件可使用 CSS Modules（`ComponentName.module.css`）

---

## 三、项目结构规范

```
frontend/src/
├── api/              # API 请求层（每个模块一个文件）
│   ├── client.ts     # Axios 实例 + 通用 get/post/put/del 方法
│   ├── application.ts
│   ├── auth.ts
│   └── ...
├── components/       # 可复用组件（每个组件一个文件夹）
│   ├── ComponentName/
│   │   ├── index.tsx
│   │   └── ComponentName.css
├── hooks/            # 自定义 Hooks
├── pages/            # 页面组件
│   └── PageName/
│       ├── PageName.tsx
│       └── PageName.css
├── stores/           # Zustand 状态管理
├── types/            # TypeScript 类型定义
├── utils/            # 工具函数
├── router/           # 路由配置
├── agent/            # AI Agent 核心逻辑
├── App.tsx           # 根组件
├── main.tsx          # 入口文件
└── index.css         # 全局样式
```

### 3.1 命名规范

- **组件文件夹**：PascalCase（如 `DevToolbar/`、`GlobalHeader/`）
- **组件导出**：命名导出 `export function ComponentName()`
- **CSS 文件**：与组件同名（如 `DevToolbar.css`）
- **类型文件**：camelCase（如 `application.ts`、`workflow.ts`）
- **Store 文件**：`{domain}Store.ts`（如 `authStore.ts`、`toastStore.ts`）
- **路径别名**：`@/` 映射到 `src/`，所有导入使用 `@/` 前缀

### 3.2 导入顺序

```typescript
// 1. React / 第三方库
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// 2. 内部 Stores
import { useAuthStore } from '@/stores/authStore';

// 3. 内部 API
import { getApplication } from '@/api/application';

// 4. 内部 Components
import { Toast } from '@/components/Toast';

// 5. 内部 Types
import type { Application } from '@/types/application';

// 6. 样式
import './ComponentName.css';
```

---

## 四、状态管理规范（Zustand）

### 4.1 Store 模式

```typescript
import { create } from 'zustand';

interface XxxState {
  data: DataType[];
  loading: boolean;
  error: string | null;
  fetchData: () => Promise<void>;
  addData: (item: DataType) => void;
  removeData: (id: number) => void;
}

export const useXxxStore = create<XxxState>((set) => ({
  data: [],
  loading: false,
  error: null,
  fetchData: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetchFromApi();
      set({ data: res.data });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },
  // ...
}));
```

### 4.2 需要持久化时使用 `persist` 中间件

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({ /* ... */ }),
    { name: 'luban-auth' }
  )
);
```

### 4.3 外部调用 Store（非 React 环境）

```typescript
import { useToastStore } from '@/stores/toastStore';

// 在普通函数中
useToastStore.getState().show('message', 'success');
```

---

## 五、API 调用规范

### 5.1 使用封装好的 HTTP 方法

```typescript
import { get, post, put, del } from '@/api/client';

// 所有方法返回 Promise<ApiResponse<T>>
const res = await get<User[]>('/users');
const res = await post<Application>('/applications', { name: '新应用' });
const res = await put<Application>(`/applications/${id}`, { name: '新名称' });
const res = await del(`/applications/${id}`);
```

### 5.2 API 响应类型

```typescript
// src/types/api.ts
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
}
```

### 5.3 新增 API 模块

在 `src/api/` 下新建文件，如 `src/api/feature.ts`：

```typescript
import { get, post, put, del } from './client';
import type { FeatureType } from '@/types/feature';

export function listFeatures(appId: number) {
  return get<FeatureType[]>(`/applications/${appId}/features`);
}

export function createFeature(appId: number, data: CreateFeatureRequest) {
  return post<FeatureType>(`/applications/${appId}/features`, data);
}
```

---

## 六、组件开发规范

### 6.1 组件模板

```typescript
import { useState, useEffect, useRef } from 'react';
import { useXxxStore } from '@/stores/xxxStore';
import { toast } from '@/stores/toastStore';
import type { SomeType } from '@/types/xxx';
import './ComponentName.css';

interface ComponentNameProps {
  appId: number;
  onAction?: (result: SomeType) => void;
}

export function ComponentName({ appId, onAction }: ComponentNameProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    try {
      setLoading(true);
      // ... 业务逻辑
      toast.success('操作成功');
    } catch (e) {
      toast.error('操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="component-name">
      {/* ... */}
    </div>
  );
}
```

### 6.2 点击外部关闭下拉

```typescript
useEffect(() => {
  function handleClickOutside(e: MouseEvent) {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
      setDropdownOpen(false);
    }
  }
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, []);
```

### 6.3 已有可复用组件清单

| 组件 | 路径 | 用途 |
|------|------|------|
| `Toast` | `@/components/Toast` | 全局消息提示（success/error/warning/info） |
| `GlobalHeader` | `@/components/GlobalHeader` | 全局顶部导航 |
| `GlobalLoading` | `@/components/GlobalLoading` | 全局加载状态 |
| `ResizablePanel` | `@/components/ResizablePanel` | 可拖拽调整大小的面板 |
| `DevToolbar` | `@/components/DevToolbar` | 开发模式底部工具栏（模拟用户） |
| `Select` | `@/pages/workflow/Select` | 自定义下拉选择器（CSS Modules） |
| `ApproverSelector` | `@/pages/workflow/ApproverSelector` | 审批人选择器 |

---

## 七、路由规范

- 路由定义在 `src/router/index.tsx`
- 使用 `createBrowserRouter` + 路由守卫
- 需要登录的页面包裹在 `<ProtectedRoute>` 下
- 未登录页面包裹在 `<GuestRoute>` 下
- 页面级组件使用 `<AppLayout>` 作为布局（含 GlobalHeader）
- 新增路由时同步更新 `src/router/index.tsx`

---

## 八、类型定义规范

- 所有类型定义放在 `src/types/` 目录下
- 接口使用 `interface`（非 `type`），导出使用 `export interface`
- 请求体 DTO 命名：`{Action}{Resource}Request`（如 `CreateAppRequest`）
- 响应类型使用泛型 `ApiResponse<T>` 包裹
- 导入类型时使用 `import type` 语法

---

## 九、需求文档同步规则

### 9.1 需求文档位置

项目需求文档位于以下位置（如存在）：
- `doc/` 目录下的需求文档
- 各功能模块的 spec 文件
- Storyboard / 策划文档

### 9.2 同步规则

当 AI 在开发过程中出现以下情况时，**必须将变更同步回需求文档**：

1. **需求变更**：如果发现需求文档中的描述与实现不一致，需要更新需求文档
2. **新增功能**：如果在开发过程中新增了需求文档中未提及的功能，需要补充到需求文档
3. **删除功能**：如果某些需求被判定为不可行或已废弃，需要在需求文档中标记
4. **API 变更**：如果 API 接口签名、参数、返回值发生变化，需要更新对应的 API 文档
5. **UI 交互变更**：如果页面交互方式与设计稿/需求描述不一致，需要更新

### 9.3 同步方式

- 在需求文档中增加 `## 变更记录` 章节
- 每次变更记录：日期、变更内容、变更原因
- 示例格式：
  ```markdown
  ### 2024-01-15
  - 将审批节点从单选改为多选，原因是用户反馈需要多人会签
  - 新增「抄送节点」类型，支持通知非审批人员
  ```

---

## 十、代码质量规范

### 10.1 TypeScript

- 启用 `noUnusedLocals` 和 `noUnusedParameters`（`tsconfig.app.json`）
- 所有函数参数和返回值必须显式声明类型
- 避免使用 `any`，优先使用 `unknown` 或具体类型
- 使用 `import type` 导入纯类型

### 10.2 错误处理与用户提示

- API 调用必须使用 try/catch 包裹
- **禁止使用 `alert()`**：任何情况下不得使用浏览器原生 `alert()`，必须使用 `toast` 统一提示
- 用户可见的错误使用 `toast.error()` 提示
- 成功操作使用 `toast.success()` 提示
- 警告使用 `toast.warning()` 提示
- 开发调试错误使用 `console.error`
- 导入方式：`import { toast } from '@/stores/toastStore';`

### 10.3 性能

- 使用 `useCallback` 和 `useMemo` 避免不必要的重渲染
- 大列表考虑虚拟滚动或分页
- 避免在渲染函数中创建新对象/数组

### 10.4 提交前检查

```bash
cd frontend
npm run lint        # ESLint 检查
npm run build       # TypeScript 编译 + Vite 构建
```

---

## 十一、CSS 编写规范

### 11.1 选择器命名

- 使用 BEM 风格：`.{block}__{element}--{modifier}`
- 或使用单层连字符：`.{block}-{element}`
- 示例：`.devtoolbar` → `.devtoolbar-left` → `.devtoolbar-impersonate-btn`

### 11.2 CSS Modules（用于复杂页面）

- 文件命名：`ComponentName.module.css`
- 导入方式：`import styles from './ComponentName.module.css'`
- 使用方式：`className={styles.trigger}`

### 11.3 常用样式模式

```css
/* 按钮 hover 效果 */
.btn:hover {
  border-color: #1677ff;
  color: #1677ff;
}

/* 卡片 */
.card {
  background: #fff;
  border: 1px solid #e8edf3;
  border-radius: 8px;
  padding: 16px;
}

/* 过渡动画 */
transition: all 0.15s;
```

---

## 十二、重要约束

1. **不要引入新的 UI 组件库**。所有 UI 使用原生 HTML + CSS 构建
2. **不要引入新的状态管理库**。统一使用 Zustand
3. **不要修改 `src/index.css` 中的全局基础样式**，除非有充分理由
4. **不要修改 `src/api/client.ts` 中的 Axios 配置**，除非需要全局拦截器变更
5. **不要在组件中直接使用 `axios`**，使用 `client.ts` 导出的 `get/post/put/del` 方法
6. **新建组件必须放在 `src/components/` 目录下**，保持扁平化组织
7. **图标优先使用 `lucide-react`**，如无合适的图标再使用内联 SVG
8. **CSS 优先使用项目中已有的颜色变量值**，保持视觉一致性
9. **所有用户可见文本使用中文**
10. **禁用 Emoji 表情**：代码、UI 文案、注释、文档中均不得使用 emoji 表情符号，保持专业、简洁的文本风格

---

## 十三、后端开发规范（Java）

### 13.1 项目结构

```
backend/src/main/java/com/luban/
├── config/          # 配置类（Security、CORS、WebMvc）
├── controller/      # REST 控制器
├── dto/             # 数据传输对象
├── entity/          # JPA 实体
├── repository/      # Spring Data JPA Repository
├── service/         # 业务逻辑层
├── security/        # JWT 认证、模拟用户过滤器
└── workflow/        # 工作流引擎模块
```

### 13.2 分层规范

- **Controller**：只负责接收请求、参数校验、调用 Service、返回响应
- **Service**：包含业务逻辑，使用 `@Transactional` 管理事务
- **Repository**：继承 `JpaRepository<Entity, ID>`，不写自定义 SQL 除非必要
- **Entity**：使用 `@Entity` + `@Table` 注解，字段映射数据库列

### 13.3 API 响应格式

所有 API 返回统一格式：
```json
{
  "success": true,
  "data": {},
  "message": "操作成功"
}
```

---

## 十四、补充规则

1. **Git 提交**：不要自动提交代码，除非用户明确要求
2. **文件创建**：优先编辑现有文件，避免不必要的新文件
3. **文档创建**：不要创建 README 或其他 Markdown 文档，除非用户明确要求（本文件除外）
4. **代码注释**：代码应自解释，只在必要时添加注释。注释使用中文
5. **测试**：如需运行测试，先检查 `package.json` 中的 scripts 命令
6. **端口**：前端开发服务器运行在 `http://localhost:5173`，后端运行在 `http://localhost:8080`