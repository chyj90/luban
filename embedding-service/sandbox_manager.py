"""
Luban Sandbox Manager - secure Python script execution pool.

v3（2026-09 多实例 + K8s 生产改造）：
- 双 runtime：docker（compose/裸机 dev）与 k8s（生产，SANDBOX_RUNTIME=k8s/auto）。
  k8s runtime 用 Pod 池替代 docker 容器池——不再挂 docker.sock（等同交出节点 root，
  且 containerd 集群没有 docker.sock），改经 ServiceAccount 管理 Pod + exec 执行。
- 槽位名带实例后缀：luban-sandbox-{实例}-{i}。多副本语义服务在同一 Docker 宿主机 /
  同一 K8s 命名空间内互不冲突（v2 固定 luban-sandbox-{i} 会互相删对方的容器）。
- k8s 沙箱 Pod：luban-sandbox 镜像 + readOnlyRootFilesystem + emptyDir /tmp +
  NetworkPolicy 断网（由部署侧按标签 luban.io/role: sandbox 全拒实现）+
  可选只读挂载附件 PVC（SANDBOX_FILES_PVC，execute-code file_paths 用）。
  检测到 POD_NAME/POD_UID（downward API）时挂 ownerReference，语义服务 Pod 被删
  时沙箱 Pod 级联回收，不留孤儿。
- 协议不变：execute(env=INPUT_DATA...) 对调用方透明；K8s exec 不支持 -e 传环境变量，
  INPUT_DATA 等经 base64 文件注入，执行包装为 VAR=$(cat ...) 前缀。
- 池化协议不变（v2）：常驻巡检 + 浅/深探活 + 退避重建 + 熔断 + pool_status 全量可观测。

Usage:
    from sandbox_manager import sandbox_pool

    sandbox_pool.start()                       # 幂等；失败交给巡检线程继续重试
    slot = sandbox_pool.acquire(timeout=10)    # raises SandboxUnavailable(reason=...)
    try:
        result = slot["container"].execute(script_path, env=env, timeout=30)
        sandbox_pool.request_ok()
    finally:
        sandbox_pool.release(slot)
    sandbox_pool.shutdown()
"""

import base64
import logging
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger(__name__)

SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "luban-sandbox:latest")
POOL_SIZE = int(os.environ.get("SANDBOX_POOL_SIZE", "3"))
MAX_MEMORY = os.environ.get("SANDBOX_MEMORY", "512m")
MAX_CPUS = os.environ.get("SANDBOX_CPUS", "1")
EXEC_TIMEOUT = int(os.environ.get("SANDBOX_TIMEOUT", "30"))
SANDBOX_ENABLED = os.environ.get("SANDBOX_ENABLED", "false").lower() in ("true", "1", "yes")
CHECK_INTERVAL = float(os.environ.get("SANDBOX_CHECK_INTERVAL", "30"))
DEEP_CHECK_EVERY = int(os.environ.get("SANDBOX_DEEP_CHECK_EVERY", "10"))
CIRCUIT_FAILURE_THRESHOLD = int(os.environ.get("SANDBOX_CIRCUIT_FAILURES", "5"))
CIRCUIT_OPEN_SECONDS = float(os.environ.get("SANDBOX_CIRCUIT_SECONDS", "60"))
REBUILD_BACKOFF = [5, 15, 60, 300]
# k8s runtime 专属
SANDBOX_RUNTIME_CONF = os.environ.get("SANDBOX_RUNTIME", "auto").strip().lower()  # auto|docker|k8s|external
SANDBOX_FILES_PVC = os.environ.get("SANDBOX_FILES_PVC", "").strip()  # 只读挂载到沙箱 /mnt/files
# external runtime 专属（受限 K8s：无 API 权限，沙箱 Pod 由运维人工部署为 Deployment，
# 镜像内运行 sandbox_agent.py HTTP 服务；本服务只能探活/执行，不能启停 Pod）
SANDBOX_ENDPOINTS = [e.strip() for e in os.environ.get("SANDBOX_ENDPOINTS", "").split(",") if e.strip()]
SANDBOX_AGENT_TOKEN = os.environ.get("SANDBOX_AGENT_TOKEN", "").strip()
SANDBOX_AGENT_PORT = int(os.environ.get("SANDBOX_AGENT_PORT", "9000"))
STALE_SCRIPT_PREFIX = "luban-run-"


class SandboxUnavailable(RuntimeError):
    """池不可用（reason: docker_down / k8s_down / image_missing / rebuild_failed / pool_empty / pool_exhausted / circuit_open）"""

    def __init__(self, reason: str, message: str = ""):
        super().__init__(message or reason)
        self.reason = reason


def _detect_runtime() -> str:
    """auto：K8s 内（SA token 目录 / KUBERNETES_SERVICE_HOST）→ k8s，否则 docker。
    受限 K8s（无 API 权限）必须显式 SANDBOX_RUNTIME=external。"""
    if SANDBOX_RUNTIME_CONF in ("docker", "k8s", "external"):
        return SANDBOX_RUNTIME_CONF
    in_cluster = (
        os.path.isdir("/var/run/secrets/kubernetes.io/serviceaccount")
        or bool(os.environ.get("KUBERNETES_SERVICE_HOST"))
    )
    return "k8s" if in_cluster else "docker"


def _docker_available() -> bool:
    """Check if Docker is installed and the socket is accessible."""
    try:
        result = subprocess.run(
            ["docker", "info"], capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _k8s_available() -> bool:
    """K8s runtime 就绪 = python client 可导入且 incluster 配置可加载。"""
    try:
        import kubernetes
        from kubernetes.config import load_incluster_config
        load_incluster_config()
        return True
    except Exception as e:
        log.warning("K8s runtime unavailable: %s", e)
        return False


SANDBOX_RUNTIME = _detect_runtime()
_INSTANCE_RAW = os.environ.get("POD_NAME") or socket.gethostname()
INSTANCE_ID = re.sub(r"[^a-z0-9-]", "-", _INSTANCE_RAW.lower())[:30].strip("-") or "node"


def _runtime_ready() -> bool:
    if SANDBOX_RUNTIME == "k8s":
        return _k8s_available()
    if SANDBOX_RUNTIME == "external":
        return bool(SANDBOX_ENDPOINTS)
    return _docker_available()


# 自动降级：runtime 不可用时强制关闭沙箱模式（LLM 代码在本容器 subprocess 直跑）
if SANDBOX_ENABLED and not _runtime_ready():
    SANDBOX_ENABLED = False
    log.warning(
        "SANDBOX_ENABLED=true but sandbox runtime '%s' is not available. "
        "Automatically falling back to direct subprocess execution. "
        "This weakens isolation for LLM-generated code — fix the runtime instead of living with it.",
        SANDBOX_RUNTIME,
    )

log.info("Sandbox mode: %s (runtime=%s, instance=%s)",
         "ENABLED" if SANDBOX_ENABLED else "DISABLED (direct subprocess)",
         SANDBOX_RUNTIME, INSTANCE_ID)


def _slot_name(i: int) -> str:
    return f"luban-sandbox-{INSTANCE_ID}-{i}"


class ExternalSandboxContainer:
    """外部托管沙箱（受限 K8s：本服务无 K8s API 权限，Pod 由运维以 Deployment 人工部署）。

    沙箱镜像内运行 sandbox_agent.py（HTTP，默认 :9000）：本类只做三件事——
    探活（GET /health）、执行（POST /execute）、清理（POST /cleanup）；
    启停/扩缩完全由部署方管理，stop() 永不触碰外部 Pod。

    SANDBOX_ENDPOINTS 可以是：
    - 普通 Service 地址（推荐，如 http://luban-sandbox:9000）：Agent 每请求独立 workdir，
      并发安全；建议 Deployment 副本数 >= SANDBOX_POOL_SIZE；
    - 或逐 Pod 地址列表（headless/人工固定）：槽位与实例 1:1 绑定。
    槽位 i 绑定 endpoints[i % len]，槽内并发由 acquire/release 互斥保证。
    """

    def __init__(self, name: str, endpoint: str):
        self.name = name
        self.endpoint = endpoint.rstrip("/")

    def _request(self, method: str, path: str, payload: dict = None,
                 timeout: int = 10) -> dict:
        import json as _json
        import urllib.request
        import urllib.error
        url = f"{self.endpoint}{path}"
        body = _json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Content-Type", "application/json")
        if SANDBOX_AGENT_TOKEN:
            req.add_header("X-Sandbox-Token", SANDBOX_AGENT_TOKEN)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return _json.loads(resp.read().decode("utf-8"))

    def start(self):
        # 无生命周期操作：start = 探活确认可达（不可达抛错 → 槽位 broken → 巡检退避重试，
        # 运维修复 Deployment 后自动恢复）
        health = self._request("GET", "/health", timeout=10)
        if health.get("status") != "ok":
            raise RuntimeError(f"sandbox agent unhealthy: {health}")

    def execute(self, script_path: str, env: dict = None,
                stdin_data: str = None, timeout: int = EXEC_TIMEOUT) -> dict:
        import base64
        with open(script_path, "r", encoding="utf-8") as f:
            script_b64 = base64.b64encode(f.read().encode("utf-8")).decode("ascii")
        payload = {"script": script_b64, "env": env or {}, "timeout": timeout}
        if stdin_data is not None:
            payload["stdin"] = base64.b64encode(stdin_data.encode("utf-8")).decode("ascii")
        # Agent 侧自己执行超时控制并返回超时结果；HTTP 超时仅作兜底缓冲
        try:
            return self._request("POST", "/execute", payload, timeout=timeout + 15)
        except Exception as e:
            reason = getattr(e, "reason", None) or e
            return {"success": False, "stderr": f"sandbox agent call failed: {reason}",
                    "exit_code": -1}

    def cleanup(self):
        try:
            self._request("POST", "/cleanup", {}, timeout=5)
        except Exception:
            pass

    def health_check(self) -> bool:
        try:
            return self._request("GET", "/health", timeout=5).get("status") == "ok"
        except Exception:
            return False

    def deep_health_check(self) -> bool:
        result = self.execute_script_inline("print(1)")
        return result.get("success") is True and "1" in (result.get("stdout") or "")

    def execute_script_inline(self, code: str, timeout: int = 10) -> dict:
        import base64
        payload = {
            "script": base64.b64encode(code.encode("utf-8")).decode("ascii"),
            "timeout": timeout,
        }
        try:
            return self._request("POST", "/execute", payload, timeout=timeout + 10)
        except Exception as e:
            return {"success": False, "stdout": "", "stderr": str(e)}

    def stop(self):
        pass  # 外部托管：永不触碰 Pod 生命周期


def _k8s_quantity_memory(v: str) -> str:
    m = re.fullmatch(r"(\d+)([mk]?)m?", v.strip().lower())
    if not m:
        return "512Mi"
    num, unit = m.group(1), m.group(2)
    return f"{num}Mi" if unit in ("", "m") else f"{num}Ki"


class _ExecResult(dict):
    """execute()/inline 的返回形状：{success, stdout, stderr, exit_code, ...}"""


class DockerSandboxContainer:
    """A pre-started Docker container that can be reused for multiple script executions."""

    def __init__(self, name: str):
        self.name = name
        self.container_id = None
        self.mount_dir = tempfile.mkdtemp(prefix=f"sandbox_{name}_")

    def start(self):
        # sleep infinity：容器常驻，生命周期完全由池管理。
        cmd = [
            "docker", "run", "-d",
            "--name", self.name,
            "--network=none",
            "--memory", MAX_MEMORY,
            "--cpus", MAX_CPUS,
            "--read-only",
            "--tmpfs", "/tmp:size=100m,exec",
            "-v", f"{self.mount_dir}:/mnt:rw",
            SANDBOX_IMAGE,
            "sleep", "infinity"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if result.returncode != 0:
            raise RuntimeError(f"Failed to start container: {result.stderr}")
        self.container_id = result.stdout.strip()
        log.info("Sandbox container %s started: %s", self.name, self.container_id[:12])

    def execute(self, script_path: str, env: dict = None,
                stdin_data: str = None, timeout: int = EXEC_TIMEOUT) -> dict:
        container_script = script_path
        if script_path.startswith(self.mount_dir):
            container_script = script_path.replace(self.mount_dir, "/mnt", 1)

        env_args = []
        if env:
            for k, v in env.items():
                env_args.extend(["-e", f"{k}={v}"])

        cmd = [
            "docker", "exec", "-i",
            *env_args,
            self.name,
            "python3", container_script
        ]
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True,
                input=stdin_data, timeout=timeout
            )
            # stdout 超限截断必须显式告知调用方：[-5000:] 只保留末尾后，协议里"最后一行是结果 JSON"
            # 会被从头截掉，调用方若只看到"未返回 JSON 结果"无法区分代码错误与返回值超长（2026-09-17 Excel 全量明细案例）
            stdout = proc.stdout or ""
            return {
                "success": proc.returncode == 0,
                "stdout": stdout[-5000:],
                "stdout_truncated": len(stdout) > 5000,
                "stderr": proc.stderr[-2000:] if proc.stderr else "",
                "exit_code": proc.returncode,
            }
        except subprocess.TimeoutExpired:
            subprocess.run(
                ["docker", "exec", self.name, "pkill", "-9", "-f", "python3"],
                capture_output=True, timeout=5
            )
            return {"success": False, "stderr": f"Execution timed out ({timeout}s)", "exit_code": -1}
        except Exception as e:
            return {"success": False, "stderr": str(e), "exit_code": -1}

    def cleanup(self):
        subprocess.run(
            ["docker", "exec", self.name, "sh", "-c", "rm -rf /tmp/* /mnt/*"],
            capture_output=True, timeout=5
        )

    def health_check(self) -> bool:
        result = subprocess.run(
            ["docker", "exec", self.name, "echo", "ok"],
            capture_output=True, text=True, timeout=3
        )
        return result.returncode == 0 and "ok" in result.stdout

    def deep_health_check(self) -> bool:
        """深探活：容器活着但 Python 环境损坏时浅探活发现不了"""
        result = self.execute_script_inline("print(1)")
        return result.get("success") is True and "1" in (result.get("stdout") or "")

    def execute_script_inline(self, code: str, timeout: int = 10) -> dict:
        cmd = ["docker", "exec", self.name, "python3", "-c", code]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            return {"success": proc.returncode == 0, "stdout": proc.stdout, "stderr": proc.stderr}
        except Exception as e:
            return {"success": False, "stdout": "", "stderr": str(e)}

    def stop(self):
        if self.container_id:
            subprocess.run(
                ["docker", "rm", "-f", self.name], capture_output=True, timeout=10
            )
            self.container_id = None
        if os.path.exists(self.mount_dir):
            shutil.rmtree(self.mount_dir, ignore_errors=True)


class K8sSandboxContainer:
    """A pre-started K8s Pod used as a sandbox slot. Script/env transfer via base64 exec;
    run output collected through marker files inside the pod (K8s exec 无独立退出码通道)。"""

    def __init__(self, name: str):
        self.name = name
        self.namespace = (
            os.environ.get("SANDBOX_NAMESPACE")
            or self._read_incluster_namespace()
            or "default"
        )
        self.started = False

    @staticmethod
    def _read_incluster_namespace() -> str:
        try:
            with open("/var/run/secrets/kubernetes.io/serviceaccount/namespace") as f:
                return f.read().strip()
        except Exception:
            return None

    @staticmethod
    def _api():
        from kubernetes import client
        from kubernetes.config import load_incluster_config
        try:
            load_incluster_config()
        except Exception:
            pass  # 已加载过会抛异常，忽略
        return client.CoreV1Api(), client

    def _base_pod_spec(self):
        from kubernetes import client
        container = client.V1Container(
            name="sandbox",
            image=SANDBOX_IMAGE,
            command=["sleep", "infinity"],
            security_context=client.V1SecurityContext(
                read_only_root_filesystem=True,
                run_as_non_root=True,
            ),
            resources=client.V1ResourceRequirements(
                limits={"memory": _k8s_quantity_memory(MAX_MEMORY), "cpu": MAX_CPUS},
                requests={"memory": _k8s_quantity_memory(MAX_MEMORY), "cpu": MAX_CPUS},
            ),
            volume_mounts=[client.V1VolumeMount(name="tmp", mount_path="/tmp")],
        )
        volumes = [client.V1Volume(name="tmp", empty_dir=client.V1EmptyDirVolumeSource())]
        if SANDBOX_FILES_PVC:
            container.volume_mounts.append(
                client.V1VolumeMount(name="files", mount_path="/mnt/files", read_only=True))
            volumes.append(client.V1Volume(
                name="files",
                persistent_volume_claim=client.V1PersistentVolumeClaimVolumeSource(
                    claim_name=SANDBOX_FILES_PVC, read_only=True)))
        spec = client.V1PodSpec(
            containers=[container],
            volumes=volumes,
            restart_policy="Never",
            automount_service_account_token=False,
        )
        return spec

    def start(self):
        from kubernetes import client as k8sclient
        api, _ = self._api()
        # 残留同名 Pod（进程崩溃/宿主重启）先清掉
        try:
            api.delete_namespaced_pod(self.name, self.namespace)
        except Exception:
            pass
        metadata = k8sclient.V1ObjectMeta(
            name=self.name, namespace=self.namespace,
            labels={"luban.io/role": "sandbox", "app": "luban-sandbox"},
        )
        pod_uid = os.environ.get("POD_UID")
        pod_name = os.environ.get("POD_NAME")
        if pod_uid and pod_name:
            metadata.owner_references = [k8sclient.V1OwnerReference(
                api_version="v1", kind="Pod", name=pod_name, uid=pod_uid,
                controller=False, block_owner_deletion=False)]
        pod = k8sclient.V1Pod(metadata=metadata, spec=self._base_pod_spec())
        api.create_namespaced_pod(self.namespace, pod)
        self.started = True
        log.info("Sandbox pod %s/%s created", self.namespace, self.name)

    def _exec_capture(self, command: list, timeout: int) -> dict:
        """Run a command in the pod, capture stdout/stderr via markers. Hard-timeout via thread."""
        from kubernetes.stream import stream
        def _run():
            api, _ = self._api()
            resp = stream(
                api.connect_get_namespaced_pod_exec,
                self.name, self.namespace,
                container="sandbox",
                command=command,
                stderr=True, stdin=False, stdout=True, tty=False,
                _preload_content=False,
            )
            resp.run_forever(timeout=timeout)
            out = resp.read_channel(resp.channel.STDOUT_CHANNEL) or ""
            err = resp.read_channel(resp.channel.STDERR_CHANNEL) or ""
            return {"stdout": out, "stderr": err}
        pool = getattr(self.__class__, "_exec_pool", None)
        if pool is None:
            pool = self.__class__._exec_pool = ThreadPoolExecutor(
                max_workers=POOL_SIZE * 2, thread_name_prefix="k8s-exec")
        future = pool.submit(_run)
        try:
            return future.result(timeout=timeout + 5)
        except TimeoutError:
            future.cancel()
            # 超时后先杀远端 python3，避免占住槽位；悬挂的 exec 线程随守护池自行消亡
            try:
                self._exec_capture(["pkill", "-9", "-f", "python3"], 5)
            except Exception:
                pass
            raise

    def _run_remote_script(self, remote_script: str, env: dict = None,
                           stdin_data: str = None, timeout: int = EXEC_TIMEOUT) -> dict:
        """Execute /tmp/<script> with env/stdin injected as files; collect output via markers."""
        env_parts = []
        files = []
        for k, v in (env or {}).items():
            f = f"/tmp/.env_{re.sub(r'[^A-Za-z0-9_]', '_', k)}"
            self._write_remote_file(f, v, timeout)
            env_parts.append(f"{k}=$(cat {f})")
            files.append(f)
        stdin_redirect = "</dev/null"
        if stdin_data is not None:
            self._write_remote_file("/tmp/.stdin", stdin_data, timeout)
            stdin_redirect = "</tmp/.stdin"
        cmd = [
            "sh", "-c",
            (f"{' '.join(env_parts)} python3 {remote_script} {stdin_redirect} "
             f">/tmp/.out 2>/tmp/.err; echo $? >/tmp/.rc; "
             f"echo '<<RC>>'$(cat /tmp/.rc); echo '<<OUT>>'; cat /tmp/.out; "
             f"echo '<<ERR>>'; cat /tmp/.err")
        ]
        try:
            result = self._exec_capture(cmd, timeout)
        except TimeoutError:
            try:
                self._exec_capture(["pkill", "-9", "-f", "python3"], 5)
            except Exception:
                pass
            return {"success": False, "stderr": f"Execution timed out ({timeout}s)", "exit_code": -1}
        stdout, stderr, rc = self._parse_markers(result.get("stdout", ""))
        if not stderr:
            stderr = result.get("stderr", "")
        return {
            "success": rc == 0,
            "stdout": (stdout or "")[-5000:],
            "stdout_truncated": len(stdout or "") > 5000,
            "stderr": (stderr or "")[-2000:],
            "exit_code": rc,
        }

    @staticmethod
    def _parse_markers(raw: str):
        rc = -1
        stdout = ""
        stderr = ""
        try:
            rc = int(raw.split("<<RC>>", 1)[1].splitlines()[0].strip())
        except Exception:
            pass
        if "<<OUT>>" in raw and "<<ERR>>" in raw:
            stdout = raw.split("<<OUT>>", 1)[1].split("<<ERR>>", 1)[0]
            stderr = raw.split("<<ERR>>", 1)[1]
        return stdout, stderr, rc

    def _write_remote_file(self, remote_path: str, content: str, timeout: int):
        b64 = base64.b64encode((content or "").encode("utf-8")).decode("ascii")
        self._exec_capture(["sh", "-c", f"echo {b64} | base64 -d > {remote_path}"], timeout)

    def execute(self, script_path: str, env: dict = None,
                stdin_data: str = None, timeout: int = EXEC_TIMEOUT) -> dict:
        remote = f"/tmp/{STALE_SCRIPT_PREFIX}run.py"
        with open(script_path, "r", encoding="utf-8") as f:
            self._write_remote_file(remote, f.read(), timeout)
        return self._run_remote_script(remote, env=env, stdin_data=stdin_data, timeout=timeout)

    def cleanup(self):
        try:
            self._exec_capture(
                ["sh", "-c", "rm -rf /tmp/* /tmp/.[!.]* 2>/dev/null; true"], 5)
        except Exception:
            pass

    def health_check(self) -> bool:
        try:
            result = self._exec_capture(["echo", "ok"], 5)
            return "ok" in (result.get("stdout") or "")
        except Exception:
            return False

    def deep_health_check(self) -> bool:
        result = self.execute_script_inline("print(1)")
        return result.get("success") is True and "1" in (result.get("stdout") or "")

    def execute_script_inline(self, code: str, timeout: int = 10) -> dict:
        try:
            result = self._exec_capture(["python3", "-c", code], timeout)
            return {"success": True, "stdout": result.get("stdout", ""),
                    "stderr": result.get("stderr", "")}
        except Exception as e:
            return {"success": False, "stdout": "", "stderr": str(e)}

    def stop(self):
        try:
            api, _ = self._api()
            api.delete_namespaced_pod(self.name, self.namespace)
        except Exception:
            pass


def _create_container(name: str, slot_index: int = 0):
    if SANDBOX_RUNTIME == "k8s":
        return K8sSandboxContainer(name)
    if SANDBOX_RUNTIME == "external":
        if not SANDBOX_ENDPOINTS:
            raise RuntimeError("SANDBOX_RUNTIME=external 但未配置 SANDBOX_ENDPOINTS")
        endpoint = SANDBOX_ENDPOINTS[slot_index % len(SANDBOX_ENDPOINTS)]
        return ExternalSandboxContainer(name, endpoint)
    return DockerSandboxContainer(name)


class SandboxPool:
    """Pre-warmed container/pod pool with background inspection & self-healing. Thread-safe.

    槽位模型：固定 size 个槽（luban-sandbox-{instance}-{i}），状态 empty/healthy/broken/busy。
    healthy 且空闲的槽进入就绪列表供 acquire 取用；broken/empty 由巡检线程按退避重建——
    槽位永不丢失（v1 的 acquire 失败路径会让池永久缩容直至全空 503）。
    """

    def __init__(self, size: int = POOL_SIZE):
        self.size = max(1, size)
        self._slots = [
            {"name": _slot_name(i), "container": None, "state": "empty",
             "last_error": None, "restarts": 0, "failures": 0, "last_attempt_at": 0.0}
            for i in range(self.size)
        ]
        self._cond = threading.Condition()
        self._ready: list[int] = []
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._inspector = None
        self._started = False
        self._rebuild_total = 0
        self._consecutive_failures = 0
        self._circuit_open_until = 0.0
        self._last_error = None
        self._last_check_at = None
        self._check_round = 0
        self._runtime_ok = None

    # ---------- 生命周期 ----------

    def start(self):
        if self._started:
            return
        self._started = True
        ok = self._fill_once()
        self._inspector = threading.Thread(target=self._inspection_loop, daemon=True,
                                           name="sandbox-pool-inspector")
        self._inspector.start()
        if not ok:
            # 预热全败（镜像缺失/runtime 未就绪）：不再放弃，巡检线程按退避持续重建，
            # 恢复后池自动补齐——v1 在这里直接躺平，之后每个请求 503 且无人知晓
            log.warning("Sandbox pool warm-up failed; inspector thread will keep retrying")
        else:
            log.info("Sandbox pool started with %d healthy slots", self._healthy_count())

    def shutdown(self):
        self._stop.set()
        self._wake.set()
        if self._inspector:
            self._inspector.join(timeout=5)
        for slot in self._slots:
            if slot["container"]:
                slot["container"].stop()
                slot["container"] = None
            slot["state"] = "empty"
        with self._cond:
            self._ready.clear()
            self._cond.notify_all()
        self._started = False
        log.info("Sandbox pool shutdown complete")

    # ---------- 请求路径 ----------

    def acquire(self, timeout: float = 30.0) -> dict:
        """取一个健康槽位。不可用时抛 SandboxUnavailable（带 reason），并唤醒巡检立即补池。"""
        if time.time() < self._circuit_open_until:
            raise SandboxUnavailable(
                "circuit_open",
                f"沙箱池熔断中（连续 {self._consecutive_failures} 次基础设施失败），"
                f"{max(0, int(self._circuit_open_until - time.time()))}s 后自动半开")
        deadline = time.time() + timeout
        with self._cond:
            while True:
                if self._ready:
                    idx = self._ready.pop(0)
                    slot = self._slots[idx]
                    if slot["state"] == "healthy" and slot["container"]:
                        slot["state"] = "busy"
                        return slot
                    continue  # 状态过期的残留项，跳过
                remaining = deadline - time.time()
                if remaining <= 0:
                    break
                self._cond.wait(timeout=min(remaining, 1.0))
        broken = sum(1 for s in self._slots if s["state"] in ("broken", "empty"))
        reason = "pool_empty" if broken > 0 else "pool_exhausted"
        self._wake.set()
        raise SandboxUnavailable(reason,
                                 "沙箱池无可用容器（有空槽位损坏/未就绪，正在自动重建）"
                                 if reason == "pool_empty" else "沙箱池耗尽，全部容器忙")

    def release(self, slot: dict):
        idx = self._slots.index(slot)
        container = slot["container"]
        if container:
            container.cleanup()
        with self._cond:
            if slot["state"] == "busy":
                slot["state"] = "healthy"
                self._ready.append(idx)
            self._cond.notify_all()

    def mark_unhealthy(self, slot: dict, error: str):
        """执行中感知槽位损坏（exec 连接类失败）：标记 broken 并立即触发重建"""
        idx = self._slots.index(slot)
        with self._cond:
            slot["state"] = "broken"
            slot["last_error"] = str(error)[:300]
            if idx in self._ready:
                self._ready.remove(idx)
        self._wake.set()
        log.warning("Sandbox slot %s marked unhealthy: %s", slot["name"], error)

    def request_ok(self):
        # 成功请求直接闭合熔断（时间窗只负责自动半开试跑，显式成功才能确认恢复）
        self._consecutive_failures = 0
        self._circuit_open_until = 0.0

    def request_failed(self, reason: str = None):
        self._last_error = reason or self._last_error
        self._consecutive_failures += 1
        if self._consecutive_failures >= CIRCUIT_FAILURE_THRESHOLD:
            self._circuit_open_until = time.time() + CIRCUIT_OPEN_SECONDS
            log.warning("Sandbox pool circuit OPEN for %ss (consecutive failures=%d, last_reason=%s)",
                        CIRCUIT_OPEN_SECONDS, self._consecutive_failures, reason)

    # ---------- 巡检与重建 ----------

    def _fill_once(self) -> bool:
        self._runtime_ok = _runtime_ready()
        ok = False
        for slot in self._slots:
            if self._rebuild_slot(slot):
                ok = True
        return ok

    def _inspection_loop(self):
        while not self._stop.is_set():
            self._wake.wait(timeout=CHECK_INTERVAL)
            self._wake.clear()
            if self._stop.is_set():
                return
            try:
                self._inspect_round()
            except Exception as e:
                log.error("Sandbox inspection round failed: %s", e)

    def _inspect_round(self):
        self._check_round += 1
        self._last_check_at = time.strftime("%Y-%m-%dT%H:%M:%S")
        self._runtime_ok = _runtime_ready()

        for slot in self._slots:
            if slot["state"] in ("empty", "broken"):
                if not self._runtime_ok:
                    slot["last_error"] = f"{SANDBOX_RUNTIME}_down"
                    continue
                # 重建退避：连续失败按档位拉长重试间隔，避免故障时打爆 runtime
                backoff = REBUILD_BACKOFF[min(slot["failures"], len(REBUILD_BACKOFF) - 1)]
                if slot["failures"] > 0 and time.time() - slot["last_attempt_at"] < backoff:
                    continue
                self._rebuild_slot(slot)
            elif slot["state"] == "healthy" and slot["container"]:
                if not self._runtime_ok:
                    slot["state"] = "broken"
                    slot["last_error"] = f"{SANDBOX_RUNTIME}_down"
                    self._remove_ready(self._slots.index(slot))
                    continue
                healthy = slot["container"].health_check()
                if healthy and self._check_round % max(1, DEEP_CHECK_EVERY) == 0:
                    healthy = slot["container"].deep_health_check()
                if not healthy:
                    self._remove_ready(self._slots.index(slot))
                    slot["state"] = "broken"
                    slot["failures"] += 1
                    slot["last_error"] = "health check failed"
                    log.warning("Sandbox slot %s unhealthy, scheduling rebuild", slot["name"])
                    self._rebuild_slot(slot)

    def _remove_ready(self, idx: int):
        with self._cond:
            if idx in self._ready:
                self._ready.remove(idx)

    def _rebuild_slot(self, slot: dict) -> bool:
        slot["last_attempt_at"] = time.time()
        if not _runtime_ready():
            slot["last_error"] = f"{SANDBOX_RUNTIME}_down"
            return False
        try:
            if slot["container"]:
                slot["container"].stop()
            container = _create_container(slot["name"], self._slots.index(slot))
            container.start()
            if not container.health_check():
                raise RuntimeError("slot started but health check failed")
            slot["container"] = container
            slot["state"] = "healthy"
            slot["last_error"] = None
            slot["restarts"] += 1
            slot["failures"] = 0
            self._rebuild_total += 1
            with self._cond:
                if self._slots.index(slot) not in self._ready:
                    self._ready.append(self._slots.index(slot))
                self._cond.notify_all()
            log.info("Sandbox slot %s rebuilt (restarts=%d)", slot["name"], slot["restarts"])
            return True
        except Exception as e:
            slot["state"] = "broken"
            slot["failures"] += 1
            msg = str(e)
            slot["last_error"] = msg[:300]
            if "Unable to find image" in msg or "No such image" in msg or "pull access denied" in msg \
                    or "ImagePullBackOff" in msg or "ErrImagePull" in msg:
                self._last_error = "image_missing"
            else:
                self._last_error = "rebuild_failed"
            log.error("Sandbox slot %s rebuild failed (failures=%d): %s",
                      slot["name"], slot["failures"], msg)
            return False

    def _healthy_count(self) -> int:
        return sum(1 for s in self._slots if s["state"] == "healthy")

    # ---------- 可观测 ----------

    def pool_status(self) -> dict:
        status = {
            "enabled": SANDBOX_ENABLED,
            "started": self._started,
            "runtime": SANDBOX_RUNTIME,
            "instance": INSTANCE_ID,
            f"{SANDBOX_RUNTIME}_ok": self._runtime_ok,
            "pool_size": self.size,
            "healthy": self._healthy_count(),
            "busy": sum(1 for s in self._slots if s["state"] == "busy"),
            "broken": sum(1 for s in self._slots if s["state"] in ("broken", "empty")),
            "rebuild_total": self._rebuild_total,
            "circuit_open": time.time() < self._circuit_open_until,
            "consecutive_failures": self._consecutive_failures,
            "last_error": self._last_error,
            "last_check_at": self._last_check_at,
            "slots": [
                {"name": s["name"], "state": s["state"], "restarts": s["restarts"],
                 "failures": s["failures"], "last_error": s["last_error"],
                 "endpoint": getattr(s["container"], "endpoint", None)}
                for s in self._slots
            ],
        }
        if SANDBOX_RUNTIME == "external":
            status["endpoints_configured"] = len(SANDBOX_ENDPOINTS)
        return status


sandbox_pool = SandboxPool()
