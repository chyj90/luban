# 需求文档：多实例部署（backend / 语义服务）与沙箱 K8s 化

> 2026-09-19。背景：平台以 K8s 为生产部署形态，需要 backend 与 embedding-service 支持多副本；
> 且 K8s 是生产环境，LLM 生成代码的沙箱隔离是硬性安全要求（此前沙箱基于 docker CLI + docker.sock，
> K8s 内不可用，`SANDBOX_ENABLED=true` 会被静默降级为 subprocess 直跑）。系统未上线，无兼容包袱，
> 一次性把多实例能力做彻底：所有进程内状态要么消除、要么改为"可从 MySQL 重建的缓存"并配自愈与对账。
> 部署侧操作见《部署文档》附录 G。

## A. 核心设计决策

**索引 = 可重建缓存，MySQL 是唯一事实源。** 概念向量、列向量均已持久化在平台库；FAISS（IndexFlatIP）
全量重建为毫秒级，因此放弃增量索引维护（增量 add/remove 在多副本下只会落到单个 EB 实例，是索引发散的
根源），统一走"全量构建广播 + 检索失败自愈 + 定时对账"三层机制。

**EB 扩容单位是容器/Pod，不是进程内 worker。** Flask 进程内全局变量（FAISS、沙箱池）决定了 gunicorn
多 worker 不可用，多实例 = 多 Pod。

## B. embedding-service

### B1 沙箱池三 runtime（v3）
- runtime 由 `SANDBOX_RUNTIME` 选择（`auto|docker|k8s|external`；auto 按 in-cluster 探测），
  池化协议一致（探活/熔断/巡检/超时/pool_status）。
- **external（受限 K8s，无 API 权限的交付默认场景）**：K8s 集群不授予 API 权限，Pod 由运维以
  Deployment 人工部署；沙箱镜像内置 `sandbox_agent.py` HTTP 服务（纯 stdlib，:9000，Agent 作为
  容器主进程常驻），语义服务通过 `ExternalSandboxContainer` 只做探活（GET /health、?deep=1 深探活）
  与执行（POST /execute，脚本/INPUT_DATA base64 注入、独立 workdir、Agent 侧超时控制）、清理
  （POST /cleanup），**不控制 Pod 启停**。`SANDBOX_ENDPOINTS` 指向 Service（每请求独立 workdir
  并发安全）或逐 Pod 地址；`SANDBOX_AGENT_TOKEN` 共享令牌鉴权；槽位不可达时按退避重探、
  恢复后自动纳管（无需重建）。端到端冒烟覆盖：health/deep/execute+env/超时/cleanup。
- **docker（dev）**：docker 容器池（原 v2 行为）。
- **k8s（允许 API 的集群，保留能力）**：Pod 池替代 docker 容器池——`luban-sandbox` 镜像 +
  `readOnlyRootFilesystem` + emptyDir /tmp + `automountServiceAccountToken: false`；
  `--network=none` 等价物由部署侧 NetworkPolicy（标签 `luban.io/role: sandbox` 全拒）实现。
  执行走 K8s exec（脚本/INPUT_DATA/base64 文件注入，marker 文件回采 stdout/stderr/exit code——
  K8s exec 无独立退出码通道）。超时先 pkill 远端 python3。
- 槽位名带实例后缀 `luban-sandbox-{实例}-{i}`：多副本语义服务同宿主机/同命名空间互不删对方容器
  （v2 固定 `luban-sandbox-{i}` 会互相 `docker rm -f`，重建风暴）。
- k8s runtime 检测到 `POD_NAME`/`POD_UID`（downward API）时给沙箱 Pod 挂 ownerReference：
  语义服务 Pod 被删/驱逐时沙箱 Pod 级联回收，不留孤儿。
- k8s runtime 可选 `SANDBOX_FILES_PVC`：附件 PVC 只读挂进沙箱 `/mnt/files`（execute-code 文件
  绑定协议不变）；external 模式由运维在沙箱 Deployment 挂同一只读 PVC。
- k8s runtime RBAC 最小化：Role 仅 `pods create/get/list/delete` + `pods/exec create`。
  `requirements.txt` 增 `kubernetes>=28.1.0`（docker/external runtime 不触发加载）。
- 三种模式部署 YAML 与验收步骤见《部署文档》附录 G.4（受限集群走 G.4.1）。

### B2 列级 FAISS 索引按数据源分槽（协议升级）
- v2 单槽全局变量（`column_index`/`column_index_built_for`）：多数据源逐个 build 时后建覆盖先建，
  多数据源语义剪枝本来就是坏的。改为 `column_indexes: {datasource_id: {index, ids, dim, fingerprint}}`。
- `build-column-index` 带 `fingerprint`（后端按表列 id 集合 SHA-256 计算，结构增删/改名即失配重建）；
  `column-index-status` 校验指纹；`search-columns` 接收 `datasource_ids` 列表，跨槽合并去重取 top_k，
  未构建的数据源以 `missing` 返回（不 500），后端据此自愈。
- 移除 `/v1/faiss/add`、`/v1/faiss/remove` 增量接口。
- `/v1/faiss/search` 503 带 `reason: "index_not_built"`（机器可读，供后端自愈判别）。

## C. backend

### C1 索引一致性与自愈
- 新增 `EmbeddingEndpointRegistry`：EB 实例端点发现——`EMBEDDING_SERVICE_ENDPOINTS` 显式列表优先，
  否则按 base-url 主机名 DNS A 记录展开（K8s 指向 headless Service 即可），单地址自动退化为原行为。
- 构建类请求（概念索引 / 列索引）**广播到全部 EB 实例**；检索走 primary。
- 自愈链：`search`/`searchColumns` 捕获 503 `index_not_built`（`FaissIndexMissingException` /
  `FaissColumnIndexMissingException`，后者携带 missing 数据源与部分结果）→ 全量重建（MySQL
  `GET_LOCK('luban:faiss-rebuild')` 跨实例互斥）→ 重试一次；列索引仍缺失时降级用部分结果
  （该数据源退化为关键词匹配，不阻断）。
- 定时对账：概念索引 60s 逐 EB 实例核对 `index_size`，仅向落后实例广播重建（覆盖 EB 重启丢索引、
  新副本上线、广播部分失败三种漂移）；本体图 30s 指纹对账（见 C3）。
- 增量索引调用移除：`FaissService.addConcepts/removeConcepts` 删除；概念删除改为提交后全量重建
  （`ConceptEmbeddingService.scheduleRebuildAfterCommit`）。
- 修复存量 bug：`embedding.service.url` 此前未在 application.yml 定义，容器部署下 FAISS 检索指向
  `localhost:8765`（只有裸机同机部署碰巧可用）；现已接线 `LUBAN_EMBEDDING_BASE_URL`。

### C2 触发器派发多副本认领
- v2 裸 SELECT 抓 PENDING：多副本并发抓同一批行，幂等键只挡"已 SUCCESS 落库后"的重发，并发窗口内
  目标动作重复执行（审批回写/扣减类资损风险）。改为**条件 UPDATE 认领**：
  `PENDING→DISPATCHING`（`claimed_at` 记账），赢者派发、输者跳过；组门槛未就绪时释放认领归还队列。
- 崩溃残留：`DISPATCHING` 超过 5min（`STALE_CLAIM`）可被重认领；派发失败路径显式归还 PENDING +
  退避（v2 不回写状态）。幂等键 `"otb-"+id` 保留作第二道防线。

### C3 本体图跨实例同步
- v2 `reloadAfterCommit()` 只刷新收到请求的实例，其余实例内存图 stale 到重启（语义检索静默变差）。
  新增 30s 指纹对账：指纹 = 概念数+max(updated_at)、关系数+max(id)、关系类型数、变更台账 max(id)；
  变化即 reload（volatile 快照整体替换，读方无锁）。本实例仍走 reloadAfterCommit 即时刷新。

### C4 EB 客户端可用性自恢复
- v2 `EmbeddingHttpClient` 构造时健康判定一次，`available=false` 永不重查——backend 启动早于 EB 就绪
  （模型加载期）就永久降级 BM25。改为不可用时 15s 节流重查（`isAvailable()` 按需触发）。

### C5 多副本限流/并发参数化
- API Key 限流（`LUBAN_APIKEY_RATE_LIMIT_MAX` / `LUBAN_APIKEY_RATE_LIMIT_DAILY_QUOTA`）与问数并发
  （`LUBAN_AGENT_CONCURRENT_LIMIT`，默认 5）可配置；均为按 Pod 生效，全局值 = 配置值 × 副本数，
  文档明确按副本数校准。

## D. 验收

1. `mvn test` 全量通过（157 用例）；`python3 -m py_compile` 两个 EB 文件通过。
2. 验收（K8s 双副本 backend + 双副本 EB，EB 用 headless Service）：
   - 概念增删改后 ≤60s 内两台 EB 的 `/v1/faiss/health` index_size 一致；
   - 重启一台 EB：90s 内索引自动补齐，期间问数无 5xx 漏出（自愈重试）；
   - 同一触发器在双副本下只执行一次（invocation_trace 按幂等键 group 无重复 SUCCESS）；
   - 实例 A 上改本体，实例 B 30s 内 `analyzeContext` 感知新概念；
   - 沙箱：受限集群（external）`/v1/sandbox/health` 显示 `runtime=external` 满池，Agent 冒烟
     （health/deep/execute/超时/cleanup）通过，沙箱 Pod 网络被 NetworkPolicy 全拒；
     允许 API 的集群（k8s）显示 `runtime=k8s` 满池。
