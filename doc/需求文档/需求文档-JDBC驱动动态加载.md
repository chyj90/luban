# 需求文档：JDBC 驱动动态加载（数仓数据源接入）

## 版本

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1.0 | 2026-08-30 | — | 初始版本，Maven 自动下载驱动 |
| v1.1 | 2026-08-30 | — | 改为从 Maven 仓库自动下载，去掉上传 JAR |
| v1.2 | 2026-08-30 | — | 安装进度展示纳入本期，删除 Phase 2 后续需求 |
| v1.3 | 2026-08-30 | — | 去掉驱动管理页，安装入口嵌入新建数据源流程 |
| v1.4 | 2026-08-30 | — | 增加密码安全：加密存储、加密传输、不回传前端、编辑不覆盖 |

---

## 一、需求背景

### 1.1 现状问题

当前平台「问数」功能仅支持 **MySQL** 和 **PostgreSQL** 两种 JDBC 数据源，类型硬编码在 `DatasourceService` 的 switch-case 中：

```java
// DatasourceService.java - 硬编码，每次新增数据源需改代码、重新部署
switch (ds.getType().toLowerCase()) {
    case "mysql", "postgresql" -> testJdbc(...);
    case "rest_api" -> testApi(...);
    default -> throw new IllegalArgumentException("不支持的数据源类型");
}
```

**痛点**：
- 新增数仓（ClickHouse、StarRocks、Doris、Hive、Trino 等）需改后端代码 + 重新部署
- JDBC Driver 依赖写死在 `pom.xml`，无法按需加载
- 每种数仓 JDBC URL 格式不同，硬编码维护成本高
- 前端数据源类型选择仅展示 MySQL/PostgreSQL，无法扩展

### 1.2 需求目标

1. **从 Maven 仓库自动下载 JDBC 驱动**：新建数据源时选择驱动类型 → 自动从 Maven Central 下载 JAR + 依赖 → 动态加载，无需改代码、无需重新部署
2. **内联安装体验**：安装流程嵌入新建数据源弹窗，选类型即触发安装，安装完成自动进入连接配置，无需跳转
3. **预置驱动库**：内置常见数仓驱动的完整元数据（含 Maven 坐标），选择后自动下载
4. **零侵入现有数据源**：MySQL/PostgreSQL 作为内置驱动保留，已有功能不受影响
5. **密码安全**：数据源密码加密存储（AES-256-GCM）、HTTPS 加密传输、API 响应不回传密码（含加密密文）、编辑时空密码不覆盖已有密码

---

## 二、需求范围

### 2.1 本次范围（Phase 1）

| 模块 | 内容 |
|------|------|
| 驱动注册 | 后端驱动元数据实体 + CRUD，含 Maven 坐标 |
| Maven 下载 | `MavenDependencyResolver` 从 Maven Central 下载 JAR 及传递依赖 |
| 动态加载 | `URLClassLoader` 隔离加载已下载的 JAR，`DriverShim` 代理注册 |
| 预置驱动库 | 内置 12 种常见数仓驱动模板（含 Maven groupId:artifactId:version），一键安装 |
| 可视化界面 | 新建数据源时类型下拉显示全部预置驱动，未安装的点击即装（内联安装弹窗 + 进度条） |
| 数据源联动 | 新建数据源时类型下拉动态获取，已安装驱动可直接填写连接信息，未安装驱动触发安装 |
| 连接池适配 | `Nl2sqlConnectionPool` 支持动态 `driverClassName` |
| 安装进度 | 安装时展示下载进度，含 SSE 实时推送每个 JAR 的下载状态 |
| 密码安全 | AES-256-GCM 加密存储 + HTTPS 传输 + API 不回传密码 + 编辑时空密码不覆盖 + 日志脱敏 |

---

## 三、数据模型设计

### 3.1 新增表：`jdbc_drivers`

```sql
CREATE TABLE jdbc_drivers (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(50)   NOT NULL UNIQUE,     -- 唯一标识，如 'clickhouse', 'starrocks'
    display_name    VARCHAR(50)   NOT NULL,             -- 展示名，如 'ClickHouse'
    description     VARCHAR(255),                       -- 描述
    category        VARCHAR(50)   NOT NULL DEFAULT 'OTHER', -- 分类：OLAP/DATALAKE/QUERY_ENGINE/RELATIONAL/CLOUD
    driver_class    VARCHAR(255)  NOT NULL,             -- 驱动类名
    jdbc_url_template VARCHAR(512) NOT NULL,            -- URL 模板，如 'jdbc:clickhouse://{host}:{port}/{database}'
    default_port    INT           NOT NULL,             -- 默认端口

    -- Maven 坐标
    group_id        VARCHAR(255)  NOT NULL,             -- 如 'com.clickhouse'
    artifact_id     VARCHAR(255)  NOT NULL,             -- 如 'clickhouse-jdbc'
    version         VARCHAR(50)   NOT NULL,             -- 如 '0.6.0'
    classifier      VARCHAR(50)   DEFAULT NULL,         -- 分类器，如 Hive 的 'standalone'

    -- 运行时状态
    installed       BOOLEAN       NOT NULL DEFAULT FALSE, -- 是否已下载安装
    builtin         BOOLEAN       NOT NULL DEFAULT FALSE, -- 是否为内置驱动（MySQL/PostgreSQL 为 TRUE）
    enabled         BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 3.2 新增表：`jdbc_driver_jars`

记录已下载的 JAR 文件信息（一个驱动可能包含多个 JAR：主包 + 传递依赖）：

```sql
CREATE TABLE jdbc_driver_jars (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    driver_id       BIGINT        NOT NULL,             -- 关联 jdbc_drivers.id
    group_id        VARCHAR(255)  NOT NULL,
    artifact_id     VARCHAR(255)  NOT NULL,
    version         VARCHAR(50)   NOT NULL,
    file_name       VARCHAR(255)  NOT NULL,             -- 本地文件名
    file_size       BIGINT,                             -- 文件大小（字节）
    is_main         BOOLEAN       NOT NULL DEFAULT FALSE, -- 是否为主 JAR
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES jdbc_drivers(id) ON DELETE CASCADE
);
```

### 3.3 现有表改动

`datasources` 表 **无需改动**。`type` 字段值从硬编码枚举（`mysql`/`postgresql`/`rest_api`）变为引用 `jdbc_drivers.name`。

### 3.4 预置驱动库（含 Maven 坐标）

系统首次启动时自动注册以下驱动元数据。

#### 内置驱动（builtin = TRUE，pom.xml 已有依赖，无需下载）

| name | display_name | driver_class | group_id | artifact_id | version | default_port |
|------|-------------|-------------|----------|-------------|---------|-------------|
| mysql | MySQL | `com.mysql.cj.jdbc.Driver` | `com.mysql` | `mysql-connector-j` | — | 3306 |
| postgresql | PostgreSQL | `org.postgresql.Driver` | `org.postgresql` | `postgresql` | — | 5432 |

> `builtin = TRUE` 的驱动 `installed = TRUE`，`group_id` 仅用于展示，实际由 App ClassLoader 加载。

#### 预置驱动模板（builtin = FALSE，一键安装后自动从 Maven 下载）

| name | display_name | 分类 | driver_class | group_id | artifact_id | version | default_port |
|------|-------------|------|-------------|----------|-------------|---------|-------------|
| clickhouse | ClickHouse | OLAP | `com.clickhouse.jdbc.ClickHouseDriver` | `com.clickhouse` | `clickhouse-jdbc` | `0.6.0` | 8123 |
| starrocks | StarRocks | OLAP | `com.mysql.cj.jdbc.Driver` | `com.mysql` | `mysql-connector-j` | `8.0.33` | 9030 |
| doris | Apache Doris | OLAP | `com.mysql.cj.jdbc.Driver` | `com.mysql` | `mysql-connector-j` | `8.0.33` | 9030 |
| hive | Apache Hive | DATALAKE | `org.apache.hive.jdbc.HiveDriver` | `org.apache.hive` | `hive-jdbc` | `3.1.3` | 10000 |
| trino | Trino | QUERY_ENGINE | `io.trino.jdbc.TrinoDriver` | `io.trino` | `trino-jdbc` | `449` | 8080 |
| presto | Presto | QUERY_ENGINE | `com.facebook.presto.jdbc.PrestoDriver` | `com.facebook.presto` | `presto-jdbc` | `0.283` | 8080 |
| oracle | Oracle | RELATIONAL | `oracle.jdbc.OracleDriver` | `com.oracle.database.jdbc` | `ojdbc8` | `21.9.0.0` | 1521 |
| sqlserver | SQL Server | RELATIONAL | `com.microsoft.sqlserver.jdbc.SQLServerDriver` | `com.microsoft.sqlserver` | `mssql-jdbc` | `12.4.0.jre11` | 1433 |
| db2 | IBM DB2 | RELATIONAL | `com.ibm.db2.jcc.DB2Driver` | `com.ibm.db2` | `jcc` | `11.5.8.0` | 50000 |
| snowflake | Snowflake | CLOUD | `net.snowflake.client.jdbc.SnowflakeDriver` | `net.snowflake` | `snowflake-jdbc` | `3.14.0` | 443 |
| redshift | Amazon Redshift | CLOUD | `com.amazon.redshift.jdbc.Driver` | `com.amazon.redshift` | `redshift-jdbc42` | `2.1.0.9` | 5439 |
| bigquery | Google BigQuery | CLOUD | `com.simba.googlebigquery.jdbc.Driver` | `com.simba` | `googlebigquery-jdbc` | `1.6.0.1001` | 443 |

> **注意**：
> - StarRocks 和 Doris 复用 MySQL Driver，但 URL 模板不同，`jdbc_driver_jars` 中 `is_main = FALSE`（共享同一个 JAR 文件，避免重复下载）
> - Hive 需要 `classifier = 'standalone'`，因为 `hive-jdbc` 的 standalone 打包包含所有依赖
> - Oracle 需要从 Oracle Maven 仓库下载，如不可访问则提示用户手动提供

---

## 四、架构设计

### 4.1 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        前端 (React)                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  DatasourcePanel (改造后)                                 │   │
│  │  - 类型下拉显示全部 14 种预置驱动（含未安装）              │   │
│  │  - 点击未安装驱动 → 内联安装弹窗（确认信息 + 进度条）     │   │
│  │  - 安装完成 → 自动进入连接信息填写                        │   │
│  └───────────────────────────┬──────────────────────────────┘   │
└────────────┼──────────────────────────────┼──────────────────────┘
             │ REST API                      │ REST API
             ▼                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      后端 (Spring Boot)                           │
│  ┌──────────────────────┐  ┌──────────────────────────────┐     │
│  │  JdbcDriverController │  │  DatasourceController (改造) │     │
│  │  GET  /drivers        │  │  GET /datasources            │     │
│  │  POST /drivers/{id}/  │  │  POST /datasources           │     │
│  │       install (SSE)   │  │  POST /datasources/{id}/test │     │
│  └──────────┬───────────┘  └──────────────┬───────────────┘     │
│             │                              │                      │
│             ▼                              ▼                      │
│  ┌──────────────────────┐  ┌──────────────────────────────┐     │
│  │  JdbcDriverService    │  │  DatasourceService (重构)     │     │
│  │  - CRUD 驱动元数据    │  │  - test() 查驱动库替代 switch │     │
│  │  - 构建 JDBC URL      │  │  - getStructure() 同上       │     │
│  │  - install() 触发下载 │  │  - buildJdbcUrl() 委托驱动库 │     │
│  └──────────┬───────────┘  └──────────────────────────────┘     │
│             │                                                     │
│             ▼                                                     │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  MavenDependencyResolver (核心)                       │       │
│  │  - resolve(groupId, artifactId, version)              │       │
│  │  - 从 Maven Central 下载 JAR + POM                    │       │
│  │  - 解析 POM 获取传递依赖并递归下载                     │       │
│  │  - 存储到 {luban.drivers.storage-path}/               │       │
│  └──────────────────────────┬───────────────────────────┘       │
│                             │                                     │
│                             ▼                                     │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  DriverClassLoaderManager                             │       │
│  │  - Map<Long, URLClassLoader> 按驱动隔离               │       │
│  │  - loadDriver(driverId) 加载所有 JAR + 注册 Driver    │       │
│  │  - unloadDriver(driverId) 关闭 ClassLoader            │       │
│  │  - DriverShim 代理模式绕过 ClassLoader 隔离            │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  Nl2sqlConnectionPool (改造)                           │       │
│  │  - getConnection() 增加 driverClassName 参数          │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  文件系统: {luban.drivers.storage-path}/               │       │
│  │  ├── clickhouse/                                      │       │
│  │  │   ├── clickhouse-jdbc-0.6.0.jar                    │       │
│  │  │   └── ... (传递依赖)                                │       │
│  │  ├── hive/                                            │       │
│  │  │   └── hive-jdbc-3.1.3-standalone.jar               │       │
│  │  └── trino/                                           │       │
│  │      └── trino-jdbc-449.jar                           │       │
│  └──────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 内联安装流程（新建数据源时触发）

```
用户在新建数据源面板选择类型（如 ClickHouse）
    │
    ├── 驱动已安装？
    │   └── YES → 直接显示连接信息表单（host/port/database/username/password）
    │
    └── 驱动未安装？
        │
        ▼
弹出安装确认弹窗（展示 Maven 坐标、驱动类名、JDBC URL 模板）
    │
    ├── 用户取消 → 回到类型选择
    │
    └── 用户确认安装
        │
        ▼
POST /api/v1/drivers/{id}/install
    │
    ▼
JdbcDriverService.install(driverId)
    ├── 1. 查询 JdbcDriver 元数据（group_id, artifact_id, version）
    ├── 2. 调用 MavenDependencyResolver
    │      ├── 2.1 构建 Maven Central URL
    │      ├── 2.2 下载 JAR → {storage-path}/{name}/{artifactId}-{version}.jar
    │      ├── 2.3 下载 POM → 解析 <dependencies> 标签
    │      ├── 2.4 递归下载传递依赖（排除 scope=test/provided）
    │      └── 2.5 通过 SSE 实时推送每个 JAR 的下载进度
    ├── 3. 保存 jdbc_driver_jars 记录
    ├── 4. 更新 jdbc_drivers.installed = TRUE
    ├── 5. 调用 DriverClassLoaderManager.loadDriver(driver)
    │      ├── 创建 URLClassLoader(所有 JAR 的 URL[])
    │      ├── 加载 driverClass
    │      ├── 实例化 Driver
    │      └── DriverManager.registerDriver(new DriverShim(driver))
    └── 6. 安装完成 → 弹窗自动关闭 → 自动进入连接信息填写
```

### 4.3 Maven 仓库策略

```
默认仓库（优先级从高到低）：
  1. 自定义仓库（如配置了 luban.drivers.maven.repo-url）
  2. 阿里云 Maven 镜像（国内加速）
     https://maven.aliyun.com/repository/public/
  3. Maven Central
     https://repo1.maven.org/maven2/

下载超时：30 秒
重试次数：3 次（指数退避）
```

### 4.4 连接获取流程

```
DatasourceService.test(datasourceId)
    │
    ▼
查 Datasource → 获取 type (如 'clickhouse')
    │
    ▼
查 JdbcDriver WHERE name = 'clickhouse'
    │
    ├── builtin = TRUE?
    │   └── YES → 直接 DriverManager.getConnection(jdbcUrl, user, password)
    │
    └── builtin = FALSE?
        ├── installed = FALSE?
        │   └── 抛异常 "驱动未安装，请先选择该数据源类型完成安装"
        └── installed = TRUE?
            └── DriverClassLoaderManager 已加载?
                ├── YES → DriverManager.getConnection(...)
                └── NO  → 先 loadDriver(driver) → 再 getConnection
```

### 4.5 DriverShim 代理模式

```java
/**
 * 代理 Driver，解决 URLClassLoader 隔离问题。
 * JDK 的 DriverManager 只会调用与当前线程上下文 ClassLoader 同级
 * 或系统 ClassLoader 加载的 Driver。通过 DriverShim 将自定义 ClassLoader
 * 加载的 Driver 代理到系统 ClassLoader 可见的 Driver 实例。
 */
public class DriverShim implements Driver {
    private final Driver driver;

    public DriverShim(Driver driver) {
        this.driver = driver;
    }

    @Override
    public Connection connect(String url, Properties info) throws SQLException {
        return driver.connect(url, info);
    }

    @Override
    public boolean acceptsURL(String url) throws SQLException {
        return driver.acceptsURL(url);
    }

    @Override
    public int getMajorVersion() { return driver.getMajorVersion(); }

    @Override
    public int getMinorVersion() { return driver.getMinorVersion(); }

    @Override
    public boolean jdbcCompliant() { return driver.jdbcCompliant(); }

    @Override
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        return driver.getParentLogger();
    }
}
```

### 4.6 密码安全流程

```
┌─ 创建/编辑数据源 ─────────────────────────────────────────────┐
│                                                               │
│  前端 (HTTPS)                                                  │
│  ├── 密码输入框 type="password"                                │
│  ├── 编辑时显示占位符 "••••••••"（不展示真实密码）              │
│  └── POST/PUT 请求体包含 password 明文 → HTTPS 加密传输        │
│                                                               │
│  后端                                                         │
│  ├── 创建时：AES-256-GCM 加密 password → 存入 config JSON      │
│  ├── 编辑时：password 为空或为占位符 → 保留原密码，不覆盖      │
│  ├── 使用时：从 config JSON 取出 → AES-256-GCM 解密 → 拼 JDBC  │
│  └── 回传时：config.remove("password")，加密密文也不返回       │
│                                                               │
└───────────────────────────────────────────────────────────────┘

加密细节：
┌────────────────────────────────────────────────────────────────┐
│  AES-256-GCM（认证加密，防篡改）                                │
│                                                                │
│  密钥来源：${LUBAN_DATASOURCE_SECRET} 环境变量                   │
│  未配置时：启动报错，拒绝启动（防止误用明文）                     │
│                                                                │
│  加密流程：                                                     │
│  1. 生成 12 字节随机 IV（Nonce）                               │
│  2. AES/GCM/NoPadding 加密                                     │
│  3. 输出：Base64(IV + ciphertext) → 存入 config.password       │
│                                                                │
│  解密流程：                                                     │
│  1. Base64 解码                                                │
│  2. 取前 12 字节为 IV，其余为 ciphertext                       │
│  3. AES/GCM/NoPadding 解密                                     │
│  4. 返回明文密码（仅用于拼 JDBC URL，不记录日志）                │
│                                                                │
│  日志脱敏：                                                     │
│  - 所有 log 语句中，config Map 打印前先 clone 并移除 password   │
│  - 异常堆栈中如包含 JDBC URL，确保 URL 不含密码参数              │
│  - 连接失败时只记录 "连接失败: {type}@{host}:{port}"，不记密码  │
└────────────────────────────────────────────────────────────────┘
```

---

## 五、接口设计

### 5.1 驱动管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/drivers` | 列出所有驱动（含预置元数据 + 安装状态），供新建数据源类型下拉 |
| `GET` | `/api/v1/drivers/{id}` | 获取驱动详情（含 JAR 文件列表） |
| `POST` | `/api/v1/drivers/{id}/install` | 安装驱动：从 Maven 下载 JAR + 依赖，通过 SSE 推送进度 |

> 无需前端管理页面，驱动元数据系统启动时自动注册，安装通过新建数据源触发。

### 5.2 安装驱动请求

```
POST /api/v1/drivers/{id}/install
Content-Type: application/json

安装过程通过 SSE 实时推送进度事件：
  event: progress
  data: {"phase": "DOWNLOADING", "fileName": "clickhouse-jdbc-0.6.0.jar", "current": 1, "total": 3, "percent": 33}

  event: progress
  data: {"phase": "DOWNLOADING", "fileName": "clickhouse-client-0.6.0.jar", "current": 2, "total": 3, "percent": 66}

  event: progress
  data: {"phase": "REGISTERING", "message": "注册驱动类...", "percent": 90}

  event: complete
  data: {"success": true, "driverId": 3, "name": "clickhouse", "displayName": "ClickHouse"}

  event: error
  data: {"success": false, "message": "下载失败: connect timeout"}
```

### 5.3 数据源接口改动

现有接口 **路径和方法不变**，内部逻辑改为查驱动库：

- `POST /api/v1/datasources` — `type` 字段值从枚举变为 `jdbc_drivers.name`
- `POST /api/v1/datasources/{id}/test` — 根据 `type` 查驱动库获取连接方式，未安装则报错
- `GET /api/v1/datasources/{id}/structure` — 同上
- `GET /api/v1/drivers` — 新增，供前端类型下拉获取全部驱动（含安装状态）

**密码处理规则**：

| 规则 | 说明 |
|------|------|
| 请求接受 | `POST/PUT` 请求体 `config.password` 接受明文（依赖 HTTPS 加密传输） |
| 存储加密 | 后端 AES-256-GCM 加密后写入 `datasources.config` JSON |
| 响应脱敏 | 所有 `GET` 响应中 `config` 不包含 `password` 字段（加密密文也不返回） |
| 编辑不覆盖 | `PUT` 更新时若 `config.password` 为空字符串/`null`/`"••••••••"`，保留原密码 |
| 日志脱敏 | 所有日志输出前移除 password，异常信息不包含密码 |

---

## 六、前端设计

### 6.1 新建数据源——类型选择

[DatasourcePanel](file:///Users/chengyajie/Project/luban/frontend/src/components/DatasourcePanel/index.tsx) 改造：

- 类型下拉从 `GET /api/v1/drivers` 动态获取全部 14 种预置驱动
- 已安装驱动：直接选中进入连接信息填写
- 未安装驱动：hover 显示「点击安装」提示，选中后弹出安装确认弹窗

```
┌──────────────────────────────────────────────────────────┐
│  新建数据源                                              │
│                                                          │
│  选择数据源类型：                                        │
│  ┌────────┐ ┌────────┐ ┌──────────┐ ┌────────┐          │
│  │ ● MySQL│ │ ● PG   │ │ ClickHouse│ │StarRocks│          │
│  │  ✓     │ │  ✓     │ │  ⬇ 安装  │ │  ⬇ 安装 │          │
│  └────────┘ └────────┘ └──────────┘ └────────┘          │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐             │
│  │ Doris  │ │  Hive  │ │ Trino  │ │ Presto │             │
│  │  ⬇ 安装│ │  ⬇ 安装│ │  ⬇ 安装│ │  ⬇ 安装│             │
│  └────────┘ └────────┘ └────────┘ └────────┘             │
│                                                          │
│  数据源名称：[                    ]                       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 6.2 安装确认弹窗

选中未安装驱动后弹出，展示驱动信息，用户确认后触发安装：

```
┌──────────────────────────────────────────────────────┐
│  安装 ClickHouse JDBC 驱动                            │
│                                                      │
│  📦 Maven 坐标                                       │
│  com.clickhouse:clickhouse-jdbc:0.6.0                │
│                                                      │
│  🔧 驱动类名                                         │
│  com.clickhouse.jdbc.ClickHouseDriver                │
│                                                      │
│  🔗 JDBC URL 模板                                    │
│  jdbc:clickhouse://{host}:{port}/{database}           │
│                                                      │
│  📡 默认端口: 8123                                   │
│                                                      │
│  将从 Maven Central 自动下载 JAR 及传递依赖           │
│                                                      │
│  [取消]                        [确认安装]             │
└──────────────────────────────────────────────────────┘
```

### 6.3 安装进度（SSE 实时推送）

点击确认后，弹窗切换为进度展示，通过 SSE 接收后端实时推送：

```
┌──────────────────────────────────────────────────────┐
│  正在安装 ClickHouse JDBC 驱动...                     │
│                                                      │
│  ████████████████████░░░░░░ 66%                      │
│                                                      │
│  ✅ 下载 clickhouse-jdbc-0.6.0.jar (12.3 MB)         │
│  ⏳ 下载 clickhouse-client-0.6.0.jar (2.4 MB)...     │
│  ⬜ 注册驱动类...                                     │
│                                                      │
└──────────────────────────────────────────────────────┘
```

安装完成后弹窗自动关闭，选中类型切换为已安装状态，自动进入连接信息填写。

### 6.4 连接信息填写（安装完成后）

安装完成或已安装驱动选中后，显示连接表单：

```
┌──────────────────────────────────────────────────────┐
│  新建数据源 — ClickHouse                              │
│                                                      │
│  数据源名称：[ClickHouse 生产库         ]             │
│  主机地址：  [192.168.1.100            ]             │
│  端口：      [8123                      ]             │
│  数据库名：  [analytics                 ]             │
│  用户名：    [default                   ]             │
│  密码：      [********                  ]             │
│                                                      │
│  [测试连接]                              [保存]       │
└──────────────────────────────────────────────────────┘
```

**编辑数据源时的密码字段**：

```
新建：密码输入框为空，用户必须填写
编辑：密码输入框显示占位符 "••••••••"（后端不返回真实密码）
      - 用户修改为其他值 → 保存新密码
      - 用户不做修改（保持 "••••••••"）→ 保留原密码，不覆盖
      - 前端在提交时，若密码值 === "••••••••" 则发送空字符串，后端识别为空不覆盖
```

### 6.5 前端新增/改造文件清单

| 文件 | 改动 |
|------|------|
| [DatasourcePanel/index.tsx](file:///Users/chengyajie/Project/luban/frontend/src/components/DatasourcePanel/index.tsx) | 类型下拉动态获取、内联安装弹窗、SSE 进度条、密码字段占位符逻辑 |
| `api/driver.ts` | 新增：`getDrivers()`、`installDriver(id, onProgress)` |
| [types/datasource.ts](file:///Users/chengyajie/Project/luban/frontend/src/types/datasource.ts) | `DatasourceType` 从字面量改为 `string`，新增 `DriverInfo` 类型，密码字段类型标记 |

---

## 七、实现细节

### 7.1 后端新增文件清单

| 文件 | 路径 | 说明 |
|------|------|------|
| `JdbcDriver.java` | `entity/` | 驱动元数据实体 |
| `JdbcDriverJar.java` | `entity/` | 已下载 JAR 文件实体 |
| `JdbcDriverRepository.java` | `repository/` | 驱动数据访问层 |
| `JdbcDriverJarRepository.java` | `repository/` | JAR 文件数据访问层 |
| `JdbcDriverService.java` | `service/` | 驱动管理服务（含 install） |
| `MavenDependencyResolver.java` | `service/` | Maven 依赖解析与下载 |
| `DriverClassLoaderManager.java` | `service/` | ClassLoader 隔离管理 |
| `DriverShim.java` | `service/` | Driver 代理 |
| `JdbcDriverController.java` | `controller/` | 驱动管理接口 |
| `DriverDataInitializer.java` | `config/` | 预置驱动初始化 |
| `CryptoUtil.java` | `util/` | AES-256-GCM 加密/解密工具类 |

### 7.2 后端改造文件清单

| 文件 | 改动 |
|------|------|
| [DatasourceService.java](file:///Users/chengyajie/Project/luban/backend/src/main/java/com/luban/service/DatasourceService.java) | 消灭 switch-case，委托 `JdbcDriverService`；`create()` 加密密码；`update()` 空密码不覆盖；所有连接方法解密密码；日志脱敏 |
| [Nl2sqlConnectionPool.java](file:///Users/chengyajie/Project/luban/backend/src/main/java/com/luban/service/Nl2sqlConnectionPool.java) | 增加 `driverClassName` 参数；连接时解密密码 |
| [SqlExecutionService.java](file:///Users/chengyajie/Project/luban/backend/src/main/java/com/luban/service/SqlExecutionService.java) | 读取密码时先解密 |
| [QueryService.java](file:///Users/chengyajie/Project/luban/backend/src/main/java/com/luban/service/QueryService.java) | 读取密码时先解密 |
| [SqlSecurityValidator.java](file:///Users/chengyajie/Project/luban/backend/src/main/java/com/luban/service/SqlSecurityValidator.java) | 按驱动类型差异化禁止操作列表 |
| `application.yml` | 增加 `luban.drivers` 配置段 |

### 7.3 前端新增文件清单

| 文件 | 路径 | 说明 |
|------|------|------|
| `driver.ts` | `api/` | 驱动 API 调用（`getDrivers`、`installDriver`） |
| `driver.ts` | `types/` | 驱动类型定义（`DriverInfo`、`InstallProgress`） |

### 7.4 前端改造文件清单

| 文件 | 改动 |
|------|------|
| [DatasourcePanel/index.tsx](file:///Users/chengyajie/Project/luban/frontend/src/components/DatasourcePanel/index.tsx) | 类型下拉动态获取全部驱动、内联安装弹窗、SSE 进度条 |
| [datasource.ts](file:///Users/chengyajie/Project/luban/frontend/src/types/datasource.ts) | `DatasourceType` 从字面量改为 `string`，新增 `DriverInfo` 类型 |

### 7.5 配置项

```yaml
# application.yml 新增
luban:
  drivers:
    storage-path: drivers              # JAR 文件存储目录（相对于工作目录）
    maven:
      repo-url: https://maven.aliyun.com/repository/public/   # 优先使用的 Maven 仓库（国内加速）
      fallback-url: https://repo1.maven.org/maven2/           # 备选 Maven Central
      connect-timeout: 10s             # 连接超时
      read-timeout: 30s                # 读取超时
      max-retries: 3                   # 下载失败重试次数
    auto-load-on-startup: true         # 启动时自动加载所有已安装驱动的 JAR

  datasource:
    secret: ${LUBAN_DATASOURCE_SECRET} # 密码加密密钥（必须配置，否则启动失败）
                                       # 生成命令：openssl rand -base64 32
                                       # 警告：密钥变更后，所有已存密码将无法解密！
```

### 7.6 Maven 依赖解析实现

`MavenDependencyResolver` 核心逻辑：

```java
/**
 * 从 Maven 仓库下载 JAR 及传递依赖。
 * 使用轻量级 HTTP 下载 + POM XML 解析，无需引入完整的 Maven Resolver 库。
 */
public class MavenDependencyResolver {

    /**
     * 解析并下载驱动及其所有传递依赖
     * @param progressCallback 进度回调，用于 SSE 推送
     */
    public List<Path> resolve(String groupId, String artifactId, String version, String classifier,
                              Consumer<DownloadProgress> progressCallback) {
        Set<String> visited = new HashSet<>();  // 防止循环依赖
        List<Path> jars = new ArrayList<>();

        // 1. 下载主 JAR
        progressCallback.accept(new DownloadProgress("DOWNLOADING", artifactId, 0, -1, 0));
        Path mainJar = downloadArtifact(groupId, artifactId, version, classifier, "jar");
        jars.add(mainJar);
        progressCallback.accept(new DownloadProgress("DOWNLOADING", mainJar.getFileName(), 1, -1, 20));

        // 2. 下载 POM，解析传递依赖
        Path pom = downloadArtifact(groupId, artifactId, version, null, "pom");
        List<Dependency> deps = parsePomDependencies(pom);

        // 3. 递归下载传递依赖（排除 scope=test/provided/optional）
        int total = deps.size() + 1;
        int current = 1;
        for (Dependency dep : deps) {
            String key = dep.groupId + ":" + dep.artifactId;
            if (visited.contains(key)) continue;
            visited.add(key);
            if (dep.scope != null && List.of("test", "provided").contains(dep.scope)) continue;
            if (dep.optional) continue;
            Path jar = downloadArtifact(dep.groupId, dep.artifactId, dep.version, null, "jar");
            jars.add(jar);
            current++;
            progressCallback.accept(new DownloadProgress("DOWNLOADING",
                jar.getFileName().toString(), current, total, 20 + (int)(60.0 * current / total)));
        }

        return jars;
    }
}
```

### 7.7 安全考量

| 风险 | 缓解措施 |
|------|---------|
| 下载恶意 JAR | 仅从配置的 Maven 仓库下载，不允许用户指定 URL；校验 JAR 文件 MAGIC 字节 `0xCAFEBABE` |
| ClassLoader 泄漏 | ① `DriverClassLoaderManager` 每次 reload 先 close 旧 loader ② `@PreDestroy` 清理所有 loader |
| 驱动冲突 | 每个驱动独立 `URLClassLoader`，完全隔离，互不影响 |
| 网络下载失败 | 3 次重试 + 指数退避 + SSE 推送错误事件，前端友好提示 |
| 磁盘空间不足 | 下载前检查 `storage-path` 可用空间 > 100MB |
| 密码明文存储 | AES-256-GCM 加密后存储，密钥来自环境变量，不写入代码或配置文件 |
| 密码日志泄露 | 所有日志输出前移除 password；连接失败只记录 type@host:port，不打印 JDBC URL |
| 密码 API 泄露 | `buildDatasourceMap()` 移除 password（加密密文也不返回）；编辑时前端不展示真实密码 |
| 密钥泄露 | 密钥仅存于环境变量，不写入代码仓库；生产环境使用密钥管理服务（KMS） |
| 密钥丢失 | 文档明确警告：密钥变更后所有已存密码无法解密，需重新录入 |

### 7.8 启动流程

```
Spring Boot 启动
    │
    ├── 1. DriverDataInitializer 检查数据库
    │      ├── jdbc_drivers 表为空? → 插入预置驱动元数据（14 条）
    │      └── jdbc_drivers 表已有数据? → INSERT IGNORE 增量更新
    │
    ├── 2. 遍历所有 installed = TRUE 的驱动
    │      └── DriverClassLoaderManager.loadDriver(driver)
    │
    └── 3. 启动完成
```

### 7.9 预置驱动增量更新策略

当系统升级、新增预置驱动模板时，使用 `INSERT IGNORE` 避免重复插入：

```sql
INSERT IGNORE INTO jdbc_drivers (name, display_name, category, driver_class, jdbc_url_template,
                                  default_port, group_id, artifact_id, version, builtin)
VALUES
('mysql', 'MySQL', 'RELATIONAL', 'com.mysql.cj.jdbc.Driver',
 'jdbc:mysql://{host}:{port}/{database}?useSSL=false&allowPublicKeyRetrieval=true',
 3306, 'com.mysql', 'mysql-connector-j', '8.0.33', TRUE),
('postgresql', 'PostgreSQL', 'RELATIONAL', 'org.postgresql.Driver',
 'jdbc:postgresql://{host}:{port}/{database}',
 5432, 'org.postgresql', 'postgresql', '42.7.1', TRUE),
-- ... 其余 12 条预置模板
```

### 7.10 CryptoUtil 密码加密实现

```java
/**
 * AES-256-GCM 密码加密工具。
 * 密钥来自环境变量 LUBAN_DATASOURCE_SECRET，未配置则启动失败。
 */
@Component
public class CryptoUtil {

    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12; // 96 bits
    private static final int GCM_TAG_LENGTH = 128; // bits

    private final SecretKey secretKey;

    public CryptoUtil(@Value("${luban.datasource.secret}") String base64Key) {
        if (base64Key == null || base64Key.isBlank()) {
            throw new IllegalStateException(
                "LUBAN_DATASOURCE_SECRET 未配置，拒绝启动。请设置环境变量后重启。");
        }
        byte[] keyBytes = Base64.getDecoder().decode(base64Key);
        if (keyBytes.length != 32) {
            throw new IllegalStateException("密钥长度必须为 32 字节 (AES-256)");
        }
        this.secretKey = new SecretKeySpec(keyBytes, "AES");
    }

    /**
     * 加密密码，返回 Base64(IV + ciphertext)
     */
    public String encrypt(String plainText) {
        try {
            byte[] iv = new byte[GCM_IV_LENGTH];
            SecureRandom.getInstanceStrong().nextBytes(iv);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));
            byte[] ciphertext = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));

            // IV + ciphertext
            ByteBuffer byteBuffer = ByteBuffer.allocate(iv.length + ciphertext.length);
            byteBuffer.put(iv);
            byteBuffer.put(ciphertext);
            return Base64.getEncoder().encodeToString(byteBuffer.array());
        } catch (Exception e) {
            throw new RuntimeException("密码加密失败", e);
        }
    }

    /**
     * 解密密码，密文格式为 Base64(IV + ciphertext)
     */
    public String decrypt(String encrypted) {
        try {
            byte[] data = Base64.getDecoder().decode(encrypted);
            ByteBuffer byteBuffer = ByteBuffer.wrap(data);

            byte[] iv = new byte[GCM_IV_LENGTH];
            byteBuffer.get(iv);
            byte[] ciphertext = new byte[byteBuffer.remaining()];
            byteBuffer.get(ciphertext);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH, iv));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new RuntimeException("密码解密失败，可能是密钥已变更", e);
        }
    }

    /**
     * 判断是否为加密后的密文（用于存量明文数据兼容）
     * 加密后的 Base64 长度 > 40（12字节IV + 至少16字节密文 + GCM tag）
     */
    public boolean isEncrypted(String value) {
        return value != null && value.length() > 40 && !value.contains(" ");
    }
}
```

**存量数据处理**：对于已有数据源的明文密码，`isEncrypted()` 返回 false 时说明是明文，需要兼容读取。但**新建和编辑时必须加密写入**，存量数据建议运维手动触发重新加密。

---

## 八、验证方案

### 8.1 功能验证清单

| 编号 | 验证项 | 预期结果 |
|:--:|------|------|
| F-01 | 系统启动后预置驱动自动注册 | 数据库 `jdbc_drivers` 表包含 14 条记录（2 内置 + 12 预置） |
| F-02 | 内置驱动 MySQL 连接测试 | 创建 MySQL 数据源 → 测试连接 → 成功 |
| F-03 | 内置驱动 PostgreSQL 连接测试 | 创建 PostgreSQL 数据源 → 测试连接 → 成功 |
| F-04 | 新建数据源类型下拉展示全部 14 种驱动 | 下拉列表含 MySQL/PG（✓）及 ClickHouse/StarRocks 等（⬇安装） |
| F-05 | 点击未安装驱动弹出安装确认弹窗 | 弹窗展示 Maven 坐标、驱动类名、URL 模板 |
| F-06 | 确认安装后 SSE 进度条实时展示 | 每个 JAR 下载状态实时更新、百分比 |
| F-07 | 安装完成后自动进入连接信息填写 | 弹窗关闭，表单自动填充端口等默认值 |
| F-08 | 已安装驱动选中直接进入连接信息填写 | 跳过安装弹窗，直接显示表单 |
| F-09 | ClickHouse 连接测试 | 创建 ClickHouse 数据源 → 测试连接 → 成功 |
| F-10 | StarRocks 连接测试 | 创建 StarRocks 数据源 → 测试连接 → 成功 |
| F-11 | 内置驱动 MySQL 不受影响 | 新建 MySQL 数据源 → 测试连接 → 成功（与现网一致） |
| F-12 | URL 模板占位符替换 | `{host}:{port}/{database}` 正确替换为用户输入 |
| F-13 | NL2SQL 链路完整性 | 概念映射 → 生成 SQL → 通过 Nl2sqlConnectionPool 执行 → 返回结果 |
| F-14 | 服务重启后驱动自动加载 | 已安装的驱动无需重新下载，自动加载可用 |
| F-15 | 新建数据源密码加密存储 | 数据库 `config` JSON 中 password 为 Base64 密文，非明文 |
| F-16 | 数据源列表 API 不返回密码 | `GET /api/v1/datasources` 响应中 config 不含 password 字段 |
| F-17 | 编辑数据源时空密码不覆盖 | 编辑时密码留空 → 保存 → 原密码仍可连接 |
| F-18 | 编辑数据源时修改密码 | 编辑时输入新密码 → 保存 → 新密码可连接，旧密码失效 |
| F-19 | 日志不包含密码 | 连接失败时日志只显示 type@host:port，无密码或 JDBC URL |
| F-20 | 未配置密钥时启动拒绝 | `LUBAN_DATASOURCE_SECRET` 为空 → 启动报错退出 |

### 8.2 场景验证清单

| 编号 | 场景 | 验证点 |
|:--:|------|------|
| S-01 | MySQL 问数 | 创建概念映射 → 自然语言提问 → 正确生成 SQL → 返回结果 |
| S-02 | PostgreSQL 问数 | 同上 |
| S-03 | ClickHouse 问数 | 新建数据源时安装驱动 → 建数据源 → 概念映射 → 提问 → OLAP 查询返回 |
| S-04 | StarRocks 问数 | 新建数据源时安装驱动（复用 MySQL Driver）→ 建数据源 → 概念映射 → 提问 → 返回 |
| S-05 | Hive 问数 | 新建数据源时安装驱动（standalone 包）→ 建数据源 → 概念映射 → 提问 → 返回 |
| S-06 | 多数据源混合 | 同一概念跨 MySQL + ClickHouse 映射 → 正确路由 |

---

## 附录 A：JDBC URL 模板规范

URL 模板使用 `{placeholder}` 语法，支持的占位符：

| 占位符 | 说明 | 来源 |
|--------|------|------|
| `{host}` | 主机地址 | 用户填写 |
| `{port}` | 端口号 | 用户填写，默认取 `default_port` |
| `{database}` | 数据库名 | 用户填写 |
| `{schema}` | Schema 名（Oracle/PG 等） | 用户填写 |

**模板示例**：

```
MySQL:      jdbc:mysql://{host}:{port}/{database}?useSSL=false&allowPublicKeyRetrieval=true
PostgreSQL: jdbc:postgresql://{host}:{port}/{database}
ClickHouse: jdbc:clickhouse://{host}:{port}/{database}
StarRocks:  jdbc:mysql://{host}:{port}/{database}?useSSL=false
Doris:      jdbc:mysql://{host}:{port}/{database}?useSSL=false
Hive:       jdbc:hive2://{host}:{port}/{database}
Trino:      jdbc:trino://{host}:{port}/{database}/{schema}
Presto:     jdbc:presto://{host}:{port}/{database}/{schema}
Oracle:     jdbc:oracle:thin:@{host}:{port}:{database}
SQL Server: jdbc:sqlserver://{host}:{port};databaseName={database};encrypt=false
DB2:        jdbc:db2://{host}:{port}/{database}
Snowflake:  jdbc:snowflake://{host}:{port}/?db={database}&schema={schema}
Redshift:   jdbc:redshift://{host}:{port}/{database}
BigQuery:   jdbc:bigquery://https://www.googleapis.com/bigquery/v2:443;ProjectId={database};
```

## 附录 B：Maven 依赖下载 URL 构造规则

```
Maven Central URL 格式:
  https://repo1.maven.org/maven2/
  {groupId with '.' → '/'}/{artifactId}/{version}/
  {artifactId}-{version}[-{classifier}].{extension}

示例:
  com.clickhouse:clickhouse-jdbc:0.6.0
  → https://repo1.maven.org/maven2/com/clickhouse/clickhouse-jdbc/0.6.0/clickhouse-jdbc-0.6.0.jar
  → https://repo1.maven.org/maven2/com/clickhouse/clickhouse-jdbc/0.6.0/clickhouse-jdbc-0.6.0.pom

  org.apache.hive:hive-jdbc:3.1.3:standalone
  → https://repo1.maven.org/maven2/org/apache/hive/hive-jdbc/3.1.3/hive-jdbc-3.1.3-standalone.jar
```

## 附录 C：已知特殊处理

| 驱动 | 特殊处理 |
|------|---------|
| **Hive** | 需使用 `classifier = 'standalone'`，该 JAR 已包含所有传递依赖，跳过 POM 解析 |
| **StarRocks / Doris** | 复用 MySQL Driver，JAR 文件共享，`jdbc_driver_jars.is_main = FALSE`，避免重复下载 |
| **Oracle** | Oracle JDBC JAR 在 Maven Central 不可用（需 Oracle 授权），需从 Oracle Maven 仓库下载：`https://maven.oracle.com`，如不可访问则提示用户配置 VPN 或手动处理 |
| **BigQuery** | 依赖复杂（50+ 传递依赖），建议使用 `classifier = 'all'` 的 fat JAR（如存在）或提示用户此驱动安装时间较长 |