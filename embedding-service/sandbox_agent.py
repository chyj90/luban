"""
Luban Sandbox Agent — 在沙箱镜像（luban-sandbox）内运行的小型 HTTP 服务。

用途：受限 K8s 环境（不授予 K8s API 权限，Pod 由运维人工部署）下的外部托管沙箱池。
语义服务（embedding-service）通过 HTTP 与本 Agent 交互，只能做两件事：
  GET  /health   —— 浅探活（进程活着）+ ?deep=1 深探活（python 可执行）
  POST /execute  —— 运行一段 python 脚本（隔离 workdir，带超时），返回执行结果
Agent 不提供任何容器/Pod 生命周期操作——启停/扩缩完全由部署方（Deployment/人工）管理。

安全：本接口可以执行任意代码，必须做到 ①仅集群内可达（NetworkPolicy/不暴露 Ingress）；
②生产设置 SANDBOX_AGENT_TOKEN，调用方带 X-Sandbox-Token 头。
纯 stdlib 实现（http.server + subprocess），保持沙箱镜像零额外依赖。

启动：CMD ["python3", "/opt/sandbox_agent.py"]（作为容器主进程，长期常驻）。
"""

import base64
import json
import os
import shutil
import subprocess
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("SANDBOX_AGENT_TOKEN", "").strip()
PORT = int(os.environ.get("SANDBOX_AGENT_PORT", "9000"))
EXEC_TIMEOUT = int(os.environ.get("SANDBOX_TIMEOUT", "30"))
WORKROOT = "/tmp/agent-exec"

_LOCK = threading.Lock()


def _resp(handler, code, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 落 stdout 供容器日志收集
        print(f"[sandbox-agent] {self.address_string()} {fmt % args}", flush=True)

    def _authorized(self) -> bool:
        if not TOKEN:
            return True
        return self.headers.get("X-Sandbox-Token", "") == TOKEN

    def do_GET(self):
        if not self._authorized():
            _resp(self, 401, {"error": "unauthorized"})
            return
        if self.path.split("?")[0] != "/health":
            _resp(self, 404, {"error": "not found"})
            return
        payload = {"status": "ok"}
        if "deep=1" in (self.path or ""):
            # 深探活：python 环境损坏时浅探活发现不了
            try:
                proc = subprocess.run(["python3", "-c", "print(1)"],
                                      capture_output=True, text=True, timeout=10)
                payload["deep_ok"] = proc.returncode == 0 and "1" in (proc.stdout or "")
            except Exception as e:
                payload["deep_ok"] = False
                payload["deep_error"] = str(e)
        _resp(self, 200, payload)

    def do_POST(self):
        if not self._authorized():
            _resp(self, 401, {"error": "unauthorized"})
            return
        path = self.path.split("?")[0]
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
            data = json.loads(self.rfile.read(length) or b"{}") if length else {}
        except Exception as e:
            _resp(self, 400, {"error": f"bad request body: {e}"})
            return

        if path == "/cleanup":
            _cleanup_workroot()
            _resp(self, 200, {"status": "ok"})
            return
        if path != "/execute":
            _resp(self, 404, {"error": "not found"})
            return

        _resp(self, 200, _execute(data))


def _cleanup_workroot():
    try:
        os.makedirs(WORKROOT, exist_ok=True)
        with _LOCK:
            for name in os.listdir(WORKROOT):
                shutil.rmtree(os.path.join(WORKROOT, name), ignore_errors=True)
    except Exception as e:
        print(f"[sandbox-agent] cleanup error: {e}", flush=True)


def _execute(data: dict) -> dict:
    script_b64 = data.get("script")
    if not script_b64:
        return {"success": False, "stderr": "missing 'script'", "exit_code": -1}
    try:
        script = base64.b64decode(script_b64).decode("utf-8")
    except Exception as e:
        return {"success": False, "stderr": f"bad script encoding: {e}", "exit_code": -1}
    try:
        timeout = min(int(data.get("timeout", EXEC_TIMEOUT)), 180)
    except (TypeError, ValueError):
        timeout = EXEC_TIMEOUT

    env = {}
    for k, v in (data.get("env") or {}).items():
        env[str(k)] = str(v)

    # 每次执行独立 workdir：并发请求互不干扰，结束后清理
    os.makedirs(WORKROOT, exist_ok=True)
    workdir = os.path.join(WORKROOT, uuid.uuid4().hex)
    os.makedirs(workdir, exist_ok=True)
    script_path = os.path.join(workdir, "run.py")
    with open(script_path, "w", encoding="utf-8") as f:
        f.write(script)

    stdin_bytes = None
    if data.get("stdin"):
        try:
            stdin_bytes = base64.b64decode(data["stdin"])
        except Exception:
            stdin_bytes = None

    full_env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
                "HOME": "/tmp", "PYTHONUNBUFFERED": "1"}
    full_env.update(env)

    try:
        proc = subprocess.run(
            ["python3", script_path],
            capture_output=True, input=stdin_bytes,
            timeout=timeout, env=full_env, cwd=workdir,
        )
        stdout = proc.stdout.decode("utf-8", errors="replace")
        stderr = proc.stderr.decode("utf-8", errors="replace")
        result = {
            "success": proc.returncode == 0,
            "stdout": stdout[-5000:],
            "stdout_truncated": len(stdout) > 5000,
            "stderr": stderr[-2000:],
            "exit_code": proc.returncode,
        }
    except subprocess.TimeoutExpired:
        result = {"success": False, "stderr": f"Execution timed out ({timeout}s)", "exit_code": -1}
    except Exception as e:
        result = {"success": False, "stderr": str(e), "exit_code": -1}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    return result


def main():
    os.makedirs(WORKROOT, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[sandbox-agent] listening on :{PORT} "
          f"(auth={'token' if TOKEN else 'OFF — cluster-internal only!'}, "
          f"default_timeout={EXEC_TIMEOUT}s)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
