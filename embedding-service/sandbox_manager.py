"""
Luban Sandbox Manager - Docker container pool for secure Python script execution.

v2（2026-09-15 沙箱 503 事故复盘）：
- 容器主进程 sleep 3600 → sleep infinity：此前满 1 小时 PID 1 退出、容器集体死亡，池毫无感知
- 常驻巡检线程：浅探活（docker exec echo）+ 定期深探活（python3 -c print(1)），
  不健康自动重建（退避重试，槽位永不丢失），池深不足自动补齐
- 启动容错：预热失败不再"置标志完事"，巡检线程持续重试直到 Docker/镜像恢复
- 请求路径不做健康检查（健康位由巡检维护）；acquire 失败带 reason 并唤醒巡检立即补池
- 熔断：连续基础设施失败时快速失败，避免每个 Python 节点都白等 acquire 超时
- 全量状态经 pool_status() 暴露给 /v1/sandbox/health——"挂了要知道"

All Python execution (execute-code, parse-file, execute-script) routes through the pool.

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

import subprocess
import os
import tempfile
import threading
import time
import logging
import shutil

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


class SandboxUnavailable(RuntimeError):
    """池不可用（reason: docker_down / image_missing / rebuild_failed / pool_empty / pool_exhausted / circuit_open）"""

    def __init__(self, reason: str, message: str = ""):
        super().__init__(message or reason)
        self.reason = reason


def _docker_available() -> bool:
    """Check if Docker is installed and the socket is accessible."""
    try:
        result = subprocess.run(
            ["docker", "info"], capture_output=True, text=True, timeout=5
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


# 自动降级：如果 Docker 不可用，强制关闭沙箱模式
if SANDBOX_ENABLED and not _docker_available():
    SANDBOX_ENABLED = False
    log.warning(
        "SANDBOX_ENABLED=true but Docker is not available (no socket or docker not installed). "
        "Automatically falling back to direct subprocess execution. "
        "This is expected when running inside a Docker container."
    )

log.info("Sandbox mode: %s", "ENABLED" if SANDBOX_ENABLED else "DISABLED (direct subprocess)")


class SandboxContainer:
    """A pre-started Docker container that can be reused for multiple script executions."""

    def __init__(self, name: str):
        self.name = name
        self.container_id = None
        self.mount_dir = tempfile.mkdtemp(prefix=f"sandbox_{name}_")

    def start(self):
        # sleep infinity：容器常驻，生命周期完全由池管理。
        # v1 用 sleep 3600——满 1 小时主进程退出容器停止，池毫无感知直到请求打进来才超时
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
            return {
                "success": proc.returncode == 0,
                "stdout": proc.stdout[-5000:] if proc.stdout else "",
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


class SandboxPool:
    """Pre-warmed container pool with background inspection & self-healing. Thread-safe.

    槽位模型：固定 size 个槽（luban-sandbox-{i}），状态 empty/healthy/broken/busy。
    healthy 且空闲的槽进入就绪列表供 acquire 取用；broken/empty 由巡检线程按退避重建——
    槽位永不丢失（v1 的 acquire 失败路径会让池永久缩容直至全空 503）。
    """

    def __init__(self, size: int = POOL_SIZE):
        self.size = max(1, size)
        self._slots = [
            {"name": f"luban-sandbox-{i}", "container": None, "state": "empty",
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
        self._docker_ok = None

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
            # 预热全败（镜像缺失/Docker 未就绪）：不再放弃，巡检线程按退避持续重建，
            # Docker 恢复后池自动补齐——v1 在这里直接躺平，之后每个请求 503 且无人知晓
            log.warning("Sandbox pool warm-up failed; inspector thread will keep retrying")
        else:
            log.info("Sandbox pool started with %d healthy containers", self._healthy_count())

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
        """执行中感知容器损坏（docker exec 连接类失败）：标记 broken 并立即触发重建"""
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
        self._docker_ok = _docker_available()
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
        self._docker_ok = _docker_available()

        for slot in self._slots:
            if slot["state"] in ("empty", "broken"):
                if not self._docker_ok:
                    slot["last_error"] = "docker_down"
                    continue
                # 重建退避：连续失败按档位拉长重试间隔，避免 Docker 故障时打爆 daemon
                backoff = REBUILD_BACKOFF[min(slot["failures"], len(REBUILD_BACKOFF) - 1)]
                if slot["failures"] > 0 and time.time() - slot["last_attempt_at"] < backoff:
                    continue
                self._rebuild_slot(slot)
            elif slot["state"] == "healthy" and slot["container"]:
                if not self._docker_ok:
                    slot["state"] = "broken"
                    slot["last_error"] = "docker_down"
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
        if not _docker_available():
            slot["last_error"] = "docker_down"
            return False
        try:
            # 重名残留（进程崩溃/宿主重启）先清掉
            subprocess.run(["docker", "rm", "-f", slot["name"]],
                           capture_output=True, timeout=10)
            if slot["container"]:
                slot["container"].stop()
            container = SandboxContainer(slot["name"])
            container.start()
            if not container.health_check():
                raise RuntimeError("container started but health check failed")
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
            if "Unable to find image" in msg or "No such image" in msg or "pull access denied" in msg:
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
        return {
            "enabled": SANDBOX_ENABLED,
            "started": self._started,
            "docker_ok": self._docker_ok,
            "pool_size": self.size,
            "healthy": self._healthy_count(),
            "busy": sum(1 for s in self._slots if s["state"] == "busy"),
            "broken": sum(1 for s in self._slots if s["state"] in ("broken", "empty")),
            "rebuild_total": self._rebuild_total,
            "circuit_open": time.time() < self._circuit_open_until,
            "consecutive_failures": self._consecutive_failures,
            "last_error": self._last_error,
            "last_check_at": self._last_check_at,
            "containers": [
                {"name": s["name"], "state": s["state"], "restarts": s["restarts"],
                 "failures": s["failures"], "last_error": s["last_error"]}
                for s in self._slots
            ],
        }


sandbox_pool = SandboxPool()
