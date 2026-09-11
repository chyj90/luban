"""
Luban Sandbox Manager - Docker container pool for secure Python script execution.

Provides SandboxContainer (single reusable container) and SandboxPool (pre-warmed pool).
All Python execution (execute-code, parse-file, execute-script) routes through the pool,
replacing direct subprocess.run(["python3", ...]) calls on the host.

Usage:
    from sandbox_manager import sandbox_pool

    # At startup:
    sandbox_pool.start()

    # Per request:
    container = sandbox_pool.acquire(timeout=10)
    try:
        result = container.execute(script_path, env=env, timeout=30)
    finally:
        sandbox_pool.release(container)

    # At shutdown:
    sandbox_pool.shutdown()
"""

import subprocess
import json
import os
import tempfile
import threading
import queue
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
            "sleep", "3600"
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

    def stop(self):
        if self.container_id:
            subprocess.run(
                ["docker", "rm", "-f", self.name], capture_output=True, timeout=10
            )
            self.container_id = None
        if os.path.exists(self.mount_dir):
            shutil.rmtree(self.mount_dir, ignore_errors=True)


class SandboxPool:
    """Pre-warmed container pool, thread-safe."""

    def __init__(self, size: int = POOL_SIZE):
        self.size = size
        self._pool = queue.Queue(maxsize=size)
        self._started = False

    def start(self):
        if self._started:
            return
        started_count = 0
        for i in range(self.size):
            name = f"luban-sandbox-{i}"
            result = subprocess.run(
                ["docker", "ps", "-q", "-f", f"name={name}"],
                capture_output=True, text=True, timeout=5
            )
            if result.stdout.strip():
                log.info("Removing stale container %s", name)
                subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=10)
            container = SandboxContainer(name)
            try:
                container.start()
                self._pool.put(container)
                started_count += 1
            except Exception as e:
                log.error("Failed to warm up container %d: %s", i, e)
        self._started = started_count > 0
        log.info("Sandbox pool started with %d containers", started_count)

    def acquire(self, timeout: float = 30.0) -> SandboxContainer:
        try:
            container = self._pool.get(timeout=timeout)
        except queue.Empty:
            raise RuntimeError("Sandbox pool exhausted, all containers busy")
        if not container.health_check():
            log.warn("Container %s unhealthy, replacing", container.name)
            container.stop()
            container = SandboxContainer(container.name)
            container.start()
        return container

    def release(self, container: SandboxContainer):
        container.cleanup()
        self._pool.put(container)

    def shutdown(self):
        while not self._pool.empty():
            try:
                container = self._pool.get_nowait()
                container.stop()
            except queue.Empty:
                break
        self._started = False
        log.info("Sandbox pool shutdown complete")


sandbox_pool = SandboxPool()