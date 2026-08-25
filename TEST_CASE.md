# 端到端测试用例：权限申请流程

---

## 一、测试账号初始化

### 1.1 系统种子数据

启动后端后，系统自动初始化以下数据（`PlatformSeedDataInitializer`）：

**平台角色：**

| slug | 名称 | 说明 |
|------|------|------|
| super_admin | 超级管理员 | 系统最高权限 |
| system_admin | 系统管理员 | 负责某系统的管理 |
| developer | 外部开发者 | 负责 API 开发集成 |
| user | 普通用户 | 普通业务用户 |

**超管账号：**

| 账号 | 密码 | 角色 |
|------|------|------|
| root | 123456 | super_admin |

**平台工作流：**

| 名称 | 说明 |
|------|------|
| 系统权限审批 | 直属领导审批 → 部门负责人审批 |
| 工具权限审批 | 系统管理员审批（角色审批） |

### 1.2 获取超管 Token

```bash
TOKEN=$(curl -s -X POST 'http://localhost:8080/api/v1/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"root@luban.local","account":"root","password":"123456"}' | jq -r '.data.token')
echo "TOKEN=$TOKEN"
```

### 1.3 创建测试部门

使用超管 Token 创建组织架构：

```bash
# 创建部门
curl -s -X POST 'http://localhost:8080/api/v1/departments' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"总经办","path":"/总经办","provider":"local","orderNum":0}'

curl -s -X POST 'http://localhost:8080/api/v1/departments' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"技术部","path":"/技术部","provider":"local","orderNum":1}'

curl -s -X POST 'http://localhost:8080/api/v1/departments' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"财务部","path":"/财务部","provider":"local","orderNum":2}'

curl -s -X POST 'http://localhost:8080/api/v1/departments' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"人事部","path":"/人事部","provider":"local","orderNum":3}'
```

记录返回的部门 ID（假设总经办=1, 技术部=2, 财务部=3, 人事部=4）。

### 1.4 注册测试用户

```bash
# 注册 7 个测试用户（注册接口无需鉴权）
curl -s -X POST 'http://localhost:8080/api/v1/auth/register' \
  -H 'Content-Type: application/json' \
  -d '{"email":"zhou@luban.local","account":"周九","password":"123456"}'

curl -s -X POST 'http://localhost:8080/api/v1/auth/register' \
  -H 'Content-Type: application/json' \
  -d '{"email":"zhang@luban.local","account":"张三","password":"123456"}'

curl -s -X POST 'http://localhost:8080/api/v1/auth/register' \
  -H 'Content-Type: application/json' \
  -d '{"email":"li@luban.local","account":"李四","password":"123456"}'

curl -s -X POST 'http://localhost:8080/api/v1/auth/register' \
  -H 'Content-Type: application/json' \
  -d '{"email":"zhao@luban.local","account":"赵六","password":"123456"}'

curl -s -X POST 'http://localhost:8080/api/v1/auth/register' \
  -H 'Content-Type: application/json' \
  -d '{"email":"wang@luban.local","account":"王五","password":"123456"}'

curl -s -X POST 'http://localhost:8080/api/v1/auth/register' \
  -H 'Content-Type: application/json' \
  -d '{"email":"sun@luban.local","account":"孙七","password":"123456"}'

curl -s -X POST 'http://localhost:8080/api/v1/auth/register' \
  -H 'Content-Type: application/json' \
  -d '{"email":"qian@luban.local","account":"钱八","password":"123456"}'
```

### 1.5 分配部门与职位

使用超管 Token 为用户设置部门和职位：

```bash
# 查询用户列表获取各用户 ID
curl -s 'http://localhost:8080/api/v1/users' \
  -H 'Authorization: Bearer '"$TOKEN" | jq '.data.items[] | {id, account, email}'
```

假设返回的 ID 为：root=1, 周九=2, 张三=3, 李四=4, 赵六=5, 王五=6, 孙七=7, 钱八=8

```bash
# 设置用户部门（deptId 作为 URL 查询参数）
# 周九 → 总经办(1), CEO
curl -s -X PUT 'http://localhost:8080/api/v1/users/2/department?deptId=1' \
  -H 'Authorization: Bearer '"$TOKEN"

# 张三 → 技术部(2), 技术总监, 上级周九
curl -s -X PUT 'http://localhost:8080/api/v1/users/3/department?deptId=2' \
  -H 'Authorization: Bearer '"$TOKEN"
curl -s -X PUT 'http://localhost:8080/api/v1/users/3/leader?leaderId=2' \
  -H 'Authorization: Bearer '"$TOKEN"

# 李四 → 财务部(3), 财务经理, 上级周九
curl -s -X PUT 'http://localhost:8080/api/v1/users/4/department?deptId=3' \
  -H 'Authorization: Bearer '"$TOKEN"
curl -s -X PUT 'http://localhost:8080/api/v1/users/4/leader?leaderId=2' \
  -H 'Authorization: Bearer '"$TOKEN"

# 赵六 → 人事部(4), HR总监, 上级周九
curl -s -X PUT 'http://localhost:8080/api/v1/users/5/department?deptId=4' \
  -H 'Authorization: Bearer '"$TOKEN"
curl -s -X PUT 'http://localhost:8080/api/v1/users/5/leader?leaderId=2' \
  -H 'Authorization: Bearer '"$TOKEN"

# 王五 → 技术部(2), 高级工程师, 上级张三
curl -s -X PUT 'http://localhost:8080/api/v1/users/6/department?deptId=2' \
  -H 'Authorization: Bearer '"$TOKEN"
curl -s -X PUT 'http://localhost:8080/api/v1/users/6/leader?leaderId=3' \
  -H 'Authorization: Bearer '"$TOKEN"

# 孙七 → 财务部(3), 会计, 上级李四
curl -s -X PUT 'http://localhost:8080/api/v1/users/7/department?deptId=3' \
  -H 'Authorization: Bearer '"$TOKEN"
curl -s -X PUT 'http://localhost:8080/api/v1/users/7/leader?leaderId=4' \
  -H 'Authorization: Bearer '"$TOKEN"

# 钱八 → 人事部(4), HR专员, 上级赵六
curl -s -X PUT 'http://localhost:8080/api/v1/users/8/department?deptId=4' \
  -H 'Authorization: Bearer '"$TOKEN"
curl -s -X PUT 'http://localhost:8080/api/v1/users/8/leader?leaderId=5' \
  -H 'Authorization: Bearer '"$TOKEN"
```

### 1.6 设置部门负责人

```bash
# 更新部门的 managerId
curl -s -X PUT 'http://localhost:8080/api/v1/departments/1' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"总经办","managerId":2}'

curl -s -X PUT 'http://localhost:8080/api/v1/departments/2' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"技术部","managerId":3}'

curl -s -X PUT 'http://localhost:8080/api/v1/departments/3' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"财务部","managerId":4}'

curl -s -X PUT 'http://localhost:8080/api/v1/departments/4' \
  -H 'Authorization: Bearer '"$TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"人事部","managerId":5}'
```

---------------------------------------------------------------------

### 1.7 验证数据

```bash
# 确认用户列表
curl -s 'http://localhost:8080/api/v1/users' \
  -H 'Authorization: Bearer '"$TOKEN" | jq '.data.items[] | {id, account, deptName, leaderId}'
```

**最终组织架构：**

| ID | 姓名 | 部门 | 职位 | 上级 |
|----|------|------|------|------|
| 1 | root | - | 超级管理员 | - |
| 2 | 周九 | 总经办 | CEO | - |
| 3 | 张三 | 技术部 | 技术总监 | 周九 |
| 4 | 李四 | 财务部 | 财务经理 | 周九 |
| 5 | 赵六 | 人事部 | HR 总监 | 周九 |
| 6 | 王五 | 技术部 | 高级工程师 | 张三 |
| 7 | 孙七 | 财务部 | 会计 | 李四 |
| 8 | 钱八 | 人事部 | HR 专员 | 赵六 |

### 1.8 分配平台角色

测试用户需要 `user` 平台角色才能访问工作台。`user` 角色已预置 `workbench:read`、`apps:read` 权限（`apps:read` 用于应用开发入口，普通用户只需 `workbench:read` 即可在工作台使用应用）。

```bash
# 查询 user 角色 ID
USER_ROLE_ID=$(curl -s 'http://localhost:8080/api/v1/roles?scope=PLATFORM' \
  -H 'Authorization: Bearer '"$TOKEN" | jq '.data[] | select(.slug=="user") | .id')

# 为所有测试用户分配 user 角色（root 除外，ID 2-8）
for uid in 2 3 4 5 6 7 8; do
  curl -s -X POST "http://localhost:8080/api/v1/roles/${USER_ROLE_ID}/users" \
    -H 'Authorization: Bearer '"$TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"userIds\":[$uid]}"
done
```

---

## 二、创建应用

### 2.1 操作步骤

1. 以超管身份登录（root/123456）
2. 顶部导航点击 **应用开发**（需要 `apps:read` 权限）
3. 点击 **新建应用**
4. 填写：
   - 应用名称：`权限测试应用`
   - 描述：`用于测试流程审批和权限控制`
5. 点击保存
6. 记录应用 ID，假设为 `appId = 1`

### 2.2 创建应用页面

1. 进入应用，左侧菜单 → **页面管理**
2. 点击 **新建页面**
3. 填写：
   - 页面名称：`欢迎页`
   - 页面路径：`/welcome`
   - 设为默认页：✅
4. 点击保存

### 2.3 创建应用角色

方式一：应用编辑器左侧点击「设置」按钮 → 自动跳转到平台角色管理并筛选当前应用
方式二：直接访问 **组织与用户 → 平台角色**，在页面顶部筛选应用

创建以下角色（scope 选择"应用级"，关联应用选择刚创建的应用）：

| 角色名 | slug | 说明 |
|--------|------|------|
| 财务审批组 | `role_finance` | 财务相关审批 |
| HR 审批组 | `role_hr` | 人事相关审批 |
| 高管审批组 | `role_executive` | 高管审批 |
| 部门负责人 | `role_dept_manager` | 各部门负责人 |

---

## 三、分配角色成员

### 3.1 操作步骤

在 **组织与用户 → 平台角色** 页面（筛选对应应用）：
2. 点击 **财务审批组**，添加成员：李四、孙七
3. 点击 **HR 审批组**，添加成员：赵六、钱八
4. 点击 **高管审批组**，添加成员：周九
5. 点击 **部门负责人**，添加成员：张三、李四、赵六

### 3.2 验证

| 角色 | 成员 |
|------|------|
| 财务审批组 | 李四、孙七 |
| HR 审批组 | 赵六、钱八 |
| 高管审批组 | 周九 |
| 部门负责人 | 张三、李四、赵六 |

### 3.3 授予应用角色页面权限

在 **组织与用户 → 平台角色** 页面，为每个应用角色授予页面访问权限：

1. 点击角色 → **权限** 标签 → **应用权限** 子标签
2. 勾选「欢迎页」页面权限
3. 点击保存

> 为所有四个应用角色（财务审批组、HR审批组、高管审批组、部门负责人）都授予「欢迎页」权限。

### 3.4 验证可用应用入口

1. 以王五身份登录
2. 进入 **工作台**（默认登录后跳转）
3. 左侧侧边栏 **可用应用** 下应显示「权限测试应用」
4. 展开应用可见「欢迎页」，点击可查看页面内容

---

## 四、创建表单

### 4.1 操作步骤

1. 在应用内，左侧菜单 → **表单管理**
2. 点击 **新建表单**
3. 填写表单信息：表单名称 `请假申请单`，描述 `员工请假申请表单`

4. **添加表单字段：**

| 序号 | 字段名 | 标签 | 类型 | 必填 | 占位提示 |
|------|--------|------|------|------|----------|
| 1 | applicant_name | 申请人 | 文本 | ✅ | 请输入姓名 |
| 2 | department | 部门 | 下拉选择 | ✅ | 请选择部门 |
| 3 | leave_type | 请假类型 | 下拉选择 | ✅ | 请选择 |
| 4 | start_date | 开始日期 | 日期 | ✅ | |
| 5 | end_date | 结束日期 | 日期 | ✅ | |
| 6 | days | 天数 | 数字 | ✅ | 请输入天数 |
| 7 | reason | 请假原因 | 多行文本 | ✅ | 请输入请假原因 |

5. **配置下拉选项：**
   - department：技术部、财务部、人事部、总经办
   - leave_type：年假、事假、病假、婚假、产假

6. 点击 **保存**，记录表单 ID（假设为 `formId = 1`）

---

## 五、流程设计

### 5.1 创建流程

1. 在应用内，左侧菜单 → **流程设计**
2. 点击 **新建流程**
3. 填写：流程名称 `综合审批流程`，描述 `覆盖所有审批类型的综合测试流程`

### 5.2 最终流程拓扑

```
发起人 ──→ 节点1 ──→ 节点2 ──→ 节点3 ──→ 节点4 ──→ 节点5 ──→ 结束
          指定人员   指定角色   直属上级   部门负责人   指定角色
          或签       会签       或签       会签       依次审批
```

### 5.3 逐节点配置

#### 节点 1：指定人员审批（或签）

- 节点名称：`指定人员审批`
- 审批人类型：指定人员
- 选择人员：张三
- 协作模式：或签

#### 节点 2：指定角色审批（会签）

- 节点名称：`财务审批组`
- 审批人类型：指定角色
- 选择角色：财务审批组
- 协作模式：会签

#### 节点 3：直属上级审批（或签）

- 节点名称：`直属上级审批`
- 审批人类型：直属上级
- 协作模式：或签
- 说明：系统根据发起人的 `leaderId` 自动解析

#### 节点 4：部门负责人审批（会签）

- 节点名称：`部门负责人审批`
- 审批人类型：部门负责人
- 协作模式：会签
- 说明：系统根据发起人所在部门的 `managerId` 自动解析

#### 节点 5：指定角色审批（依次审批）

- 节点名称：`高管审批`
- 审批人类型：指定角色
- 选择角色：高管审批组
- 协作模式：依次审批

### 5.4 保存并发布

点击顶部 **保存**，然后 **发布**。

---

## 六、绑定表单

1. 在流程设计页面，找到 **表单绑定** 区域
2. 点击 **绑定表单**，选择「请假申请单」
3. 点击确认

---

## 七、测试场景

### 7.1 获取各用户 Token

```bash
login() {
  curl -s -X POST 'http://localhost:8080/api/v1/auth/login' \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1@luban.local\",\"account\":\"$2\",\"password\":\"123456\"}" | jq -r '.data.token'
}

T_WANG=$(login wang 王五)
T_ZHANG=$(login zhang 张三)
T_LI=$(login li 李四)
T_SUN=$(login sun 孙七)
T_ZHAO=$(login zhao 赵六)
T_QIAN=$(login qian 钱八)
T_ZHOU=$(login zhou 周九)
```

### 7.2 场景 A：王五（技术部）发起请假

| 步骤 | 用户 | 操作 | 预期 |
|------|------|------|------|
| 1 | 王五 | 发起「综合审批流程」，填写表单（部门=技术部、类型=年假、3天） | 提交成功 |
| 2 | - | 查看状态 | 节点1：等待张三（指定人员/或签） |
| 3 | 张三 | 审批通过 | 节点1完成 |
| 4 | - | 查看状态 | 节点2：等待李四+孙七（财务审批组/会签） |
| 5 | 李四 | 审批通过 | 等待孙七 |
| 6 | 孙七 | 审批通过 | 节点2完成 |
| 7 | - | 查看状态 | 节点3：等待张三（王五的直属上级） |
| 8 | 张三 | 审批通过 | 节点3完成 |
| 9 | - | 查看状态 | 节点4：等待张三（技术部负责人） |
| 10 | 张三 | 审批通过 | 节点4完成 |
| 11 | - | 查看状态 | 节点5：等待周九（高管审批组/依次审批） |
| 12 | 周九 | 审批通过 | **流程完成** ✅ |

### 7.3 场景 B：孙七（财务部）发起请假

| 步骤 | 用户 | 操作 | 预期 |
|------|------|------|------|
| 1 | 孙七 | 发起流程（部门=财务部） | 提交成功 |
| 2 | 张三 | 审批通过 | 节点1完成 |
| 3 | 李四 | 审批通过 | 节点2：财务审批组（会签），李四+孙七 |
| 4 | - | 孙七是审批人之一 | 系统自动跳过或需手动审批 |
| 5 | - | 查看状态 | 节点3：等待李四（孙七的直属上级） |
| 6 | 李四 | 审批通过 | 节点3完成 |
| 7 | - | 查看状态 | 节点4：等待李四（财务部负责人） |
| 8 | 李四 | 审批通过 | 节点4完成 |
| 9 | 周九 | 审批通过 | 节点5完成，**流程完成** ✅ |

### 7.4 场景 C：钱八（人事部）发起请假

| 步骤 | 用户 | 操作 | 预期 |
|------|------|------|------|
| 1 | 钱八 | 发起流程（部门=人事部） | 提交成功 |
| 2 | 张三 | 审批通过 | 节点1完成 |
| 3 | 李四 | 审批通过 | 节点2：等待李四+孙七 |
| 4 | 孙七 | 审批通过 | 节点2完成 |
| 5 | - | 查看状态 | 节点3：等待赵六（钱八的直属上级） |
| 6 | 赵六 | 审批通过 | 节点3完成 |
| 7 | - | 查看状态 | 节点4：等待赵六（人事部负责人） |
| 8 | 赵六 | 审批通过 | 节点4完成 |
| 9 | 周九 | 审批通过 | 节点5完成，**流程完成** ✅ |

---

## 八、覆盖矩阵

### 审批类型覆盖

| 审批类型 | 对应节点 | 测试场景 |
|----------|---------|----------|
| 指定人员 | 节点 1 | A、B、C |
| 指定角色 | 节点 2、5 | A、B、C |
| 直属上级 | 节点 3 | A、B、C |
| 部门负责人 | 节点 4 | A、B、C |

### 协作模式覆盖

| 协作模式 | 对应节点 | 含义 |
|----------|---------|------|
| 或签 | 节点 1、3 | 任一人通过即可 |
| 会签 | 节点 2、4 | 所有人必须通过 |
| 依次审批 | 节点 5 | 按顺序逐一审批 |

### 上级解析覆盖

| 场景 | 发起人 | 上级 | 部门负责人 |
|------|--------|------|-----------|
| 技术部员工 | 王五 | 张三 | 张三 |
| 财务部员工 | 孙七 | 李四 | 李四 |
| 人事部员工 | 钱八 | 赵六 | 赵六 |

### 应用级/平台级隔离

| 验证点 | 说明 |
|--------|------|
| 角色按 applicationId 过滤 | 节点 2/5 的「指定角色」只能查到本应用的角色 |
| 平台级流程不过滤 | 平台级流程可查询所有角色 |