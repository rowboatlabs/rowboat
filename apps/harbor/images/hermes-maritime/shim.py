#!/usr/bin/env python3
"""Hermes inside a Maritime "custom" container: Rowboat's shim, PID 1.

Serves Maritime's contract on $PORT (`/health`, `/chat`, `/schedules`), keeps
`hermes gateway run` running as the `hermes` user, and pushes Hermes's cron jobs
to Maritime as wake triggers the moment they change. Standard library only.
See README.md beside this file for why it exists.
"""
from __future__ import annotations

import json
import os
import pwd
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.environ.get("HERMES_HOME") or "/data"
LEGACY_HOME = "/opt/data"
PORT = int(os.environ.get("PORT") or "8080")
GATEWAY_API = os.environ.get("HERMES_API_SERVER") or "http://127.0.0.1:8642"
REPLY_BUDGET_S = float(os.environ.get("REPLY_BUDGET_S") or "24")
JOBS_FILE = os.path.join(HOME, "cron", "jobs.json")
LOG_FILE = os.path.join(HOME, "logs", "shim.log")
# The prompt Maritime hands back at a scheduled occurrence; the shim fires that job.
SCHEDULE_PROMPT = "rowboat-cron "
JOBS_POLL_S = 5
REPUSH_S = 30 * 60

STATE: dict = {
    "started": time.time(),
    "gateway_pid": None,
    "gateway_starts": 0,
    "gateway_exits": [],
    "last_push": None,
    "last_push_ok": None,
    "schedules": 0,
}
_lock = threading.Lock()
_stopping = threading.Event()
_gateway: subprocess.Popen | None = None
PENDING: dict[str, str] = {}
RUNNING: set[str] = set()


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} shim {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


# --- the box ---------------------------------------------------------------------------------

def hermes_user() -> pwd.struct_passwd | None:
    try:
        return pwd.getpwnam("hermes")
    except KeyError:
        return None


def link_legacy_home() -> None:
    """`/opt/data` -> `/data`: Harbor's turn script was written for the template's layout.

    The image ships `/opt/data` as the hermes user's home with its skeleton files, so on
    first boot it is a populated directory on the root disk: whatever is not already on the
    volume moves across, the rest is kept beside it, and the path becomes the link.
    """
    if LEGACY_HOME == HOME:
        return
    try:
        if os.path.islink(LEGACY_HOME):
            if os.readlink(LEGACY_HOME) != HOME:
                os.unlink(LEGACY_HOME)
                os.symlink(HOME, LEGACY_HOME)
            return
        if os.path.isdir(LEGACY_HOME):
            if os.path.ismount(LEGACY_HOME):
                log(f"{LEGACY_HOME} is a mount; leaving it")
                return
            moved = 0
            for name in os.listdir(LEGACY_HOME):
                if not os.path.lexists(os.path.join(HOME, name)):
                    shutil.move(os.path.join(LEGACY_HOME, name), os.path.join(HOME, name))
                    moved += 1
            if os.listdir(LEGACY_HOME):
                kept = LEGACY_HOME + ".image"
                shutil.rmtree(kept, ignore_errors=True)
                os.rename(LEGACY_HOME, kept)
                log(f"moved {moved} entr{'y' if moved == 1 else 'ies'} from {LEGACY_HOME} to {HOME}; the rest kept at {kept}")
            else:
                os.rmdir(LEGACY_HOME)
                if moved:
                    log(f"moved {moved} entr{'y' if moved == 1 else 'ies'} from {LEGACY_HOME} to {HOME}")
        os.makedirs(os.path.dirname(LEGACY_HOME), exist_ok=True)
        os.symlink(HOME, LEGACY_HOME)
    except OSError as e:
        log(f"link {LEGACY_HOME}: {e}")


def prep() -> pwd.struct_passwd | None:
    os.makedirs(HOME, exist_ok=True)
    link_legacy_home()
    try:
        with open("/etc/hosts") as f:
            hosts = f.read()
        if "localhost" not in hosts:
            with open("/etc/hosts", "a") as f:
                f.write("127.0.0.1 localhost\n")
    except OSError as e:
        log(f"hosts: {e}")
    user = hermes_user()
    if user and os.geteuid() == 0:
        try:
            if os.stat(HOME).st_uid != user.pw_uid:
                subprocess.run(["chown", "-R", f"{user.pw_uid}:{user.pw_gid}", HOME], check=False)
        except OSError as e:
            log(f"chown: {e}")
    return user


def as_hermes(user: pwd.struct_passwd | None):
    """Popen's `preexec_fn` that drops to the hermes user, or None when already there."""
    if not user or os.geteuid() != 0:
        return None

    def demote() -> None:
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)

    return demote


# Hermes's own API server, on localhost: how a scheduled occurrence fires its job at once
# (`POST /api/jobs/<id>/run`), as Maritime's wrapper did on the `hermes` framework.
API_SERVER_ENV = {"API_SERVER_ENABLED": "true", "API_SERVER_HOST": "127.0.0.1", "API_SERVER_PORT": "8642"}


def hermes_env() -> dict[str, str]:
    env = dict(os.environ, HOME=HOME, HERMES_HOME=HOME)
    for k, v in API_SERVER_ENV.items():
        env.setdefault(k, v)
    return env


# --- the gateway -----------------------------------------------------------------------------

def supervise(user: pwd.struct_passwd | None) -> None:
    global _gateway
    backoff = 2.0
    while not _stopping.is_set():
        started = time.time()
        try:
            p = subprocess.Popen(["hermes", "gateway", "run"], env=hermes_env(), preexec_fn=as_hermes(user), cwd=HOME)
        except OSError as e:
            log(f"gateway spawn failed: {e}; retrying in {backoff:.0f}s")
            time.sleep(backoff)
            backoff = min(backoff * 2, 30)
            continue
        with _lock:
            _gateway = p
            STATE["gateway_pid"] = p.pid
            STATE["gateway_starts"] += 1
        log(f"gateway started pid={p.pid} start#{STATE['gateway_starts']}")
        rc = p.wait()
        with _lock:
            _gateway = None
            STATE["gateway_pid"] = None
            STATE["gateway_exits"].append({"at": time.time(), "rc": rc})
            STATE["gateway_exits"] = STATE["gateway_exits"][-20:]
        if _stopping.is_set():
            return
        if time.time() - started > 60:
            backoff = 2.0
        log(f"gateway exited rc={rc}; restarting in {backoff:.0f}s")
        time.sleep(backoff)
        backoff = min(backoff * 2, 30)


def stop(signum, _frame) -> None:
    log(f"signal {signum}: stopping")
    _stopping.set()
    with _lock:
        p = _gateway
    if p and p.poll() is None:
        p.terminate()
        try:
            p.wait(timeout=20)
        except subprocess.TimeoutExpired:
            p.kill()
    sys.exit(0)


# --- schedules --------------------------------------------------------------------------------

def read_jobs(path: str = JOBS_FILE) -> list[dict]:
    try:
        with open(path) as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return []
    jobs = doc.get("jobs") if isinstance(doc, dict) else doc
    return [j for j in (jobs or []) if isinstance(j, dict)]


def schedules(jobs: list[dict] | None = None) -> list[dict]:
    """Hermes's enabled cron jobs as Maritime schedule entries, each with the prompt that fires it."""
    out = []
    for j in (read_jobs() if jobs is None else jobs):
        if not j.get("enabled", True) or j.get("paused_at"):
            continue
        job_id = str(j.get("id") or "")
        if not job_id:
            continue
        s = j.get("schedule") or {}
        entry = {"id": job_id, "name": str(j.get("name") or job_id), "enabled": True, "prompt": SCHEDULE_PROMPT + job_id}
        if s.get("kind") == "cron" and s.get("expr"):
            entry.update({"cron": s["expr"], "tz": "UTC"})
        elif s.get("kind") == "once" and s.get("run_at"):
            entry["nextRunAt"] = s["run_at"]
        else:
            continue
        out.append(entry)
    return out


def push_schedules(entries: list[dict]) -> bool | None:
    """Push the full list to Maritime; None off-Maritime, else whether it was accepted."""
    base = os.environ.get("MARITIME_BACKEND_URL")
    agent = os.environ.get("MARITIME_AGENT_ID")
    token = os.environ.get("MARITIME_INTERNAL_TOKEN")
    if not base or not agent or not token:
        return None
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/agents/internal/schedules",
        data=json.dumps({"schedules": entries}).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "X-Maritime-Agent-Id": agent, "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            ok = 200 <= resp.status < 300
    except (urllib.error.URLError, OSError, ValueError) as e:
        log(f"schedule push failed: {e}")
        ok = False
    STATE["last_push"] = time.time()
    STATE["last_push_ok"] = ok
    STATE["schedules"] = len(entries)
    return ok


def watch_jobs() -> None:
    """Push at boot, whenever jobs.json changes, and every half hour regardless."""
    last_mtime: float | None = None
    last_push = 0.0
    while not _stopping.is_set():
        try:
            mtime: float | None = os.stat(JOBS_FILE).st_mtime
        except OSError:
            mtime = None
        now = time.time()
        if mtime != last_mtime or now - last_push > REPUSH_S:
            entries = schedules()
            ok = push_schedules(entries)
            if ok is not None:
                log(f"pushed {len(entries)} schedule(s): {'ok' if ok else 'rejected'}")
            last_mtime, last_push = mtime, now
        time.sleep(JOBS_POLL_S)


def fire_job(job_id: str, user: pwd.struct_passwd | None) -> None:
    """Run a job now: through the gateway's API, else by one scheduler tick."""
    req = urllib.request.Request(f"{GATEWAY_API}/api/jobs/{job_id}/run", data=b"{}", method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if 200 <= resp.status < 300:
                log(f"job {job_id}: run requested through the gateway")
                return
            log(f"job {job_id}: gateway answered {resp.status}")
    except (urllib.error.URLError, OSError) as e:
        log(f"job {job_id}: gateway api not reachable ({e}); ticking the scheduler")
    try:
        subprocess.run(["hermes", "cron", "tick"], env=hermes_env(), preexec_fn=as_hermes(user), cwd=HOME, timeout=600, check=False)
    except (OSError, subprocess.TimeoutExpired) as e:
        log(f"job {job_id}: tick failed: {e}")


# --- chat ---------------------------------------------------------------------------------------

def turn(message: str, conversation: str, user: pwd.struct_passwd | None) -> str:
    """One `hermes chat` turn in the conversation's own session; its final text."""
    d = os.path.join(HOME, "rowboat", "chat")
    os.makedirs(d, exist_ok=True)
    prompt = os.path.join(d, f"{conversation}.prompt")
    with open(prompt, "w") as f:
        f.write(message)
    if user and os.geteuid() == 0:
        os.chown(d, user.pw_uid, user.pw_gid)
        os.chown(prompt, user.pw_uid, user.pw_gid)
    cmd = ["hermes", "chat", "--query-file", prompt, "--oneshot", "--format", "stream-json", "-c", f"maritime-{conversation}", "--create-if-missing"]
    try:
        p = subprocess.run(cmd, env=hermes_env(), preexec_fn=as_hermes(user), cwd=HOME, capture_output=True, text=True, timeout=900)
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"The turn did not complete: {e}"
    text = ""
    for line in p.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "result" and isinstance(ev.get("text"), str):
            text = ev["text"].strip()
    if text:
        return text
    tail = (p.stderr or "").strip().splitlines()[-3:]
    return "Hermes ended without a reply. " + " ".join(tail) if tail else "Hermes ended without a reply."


def chat(message: str, conversation: str, user: pwd.struct_passwd | None) -> str:
    """Answer within the reply budget, or say so and hand the answer back on the next message."""
    with _lock:
        if conversation in PENDING:
            return PENDING.pop(conversation)
        if conversation in RUNNING:
            return "Still working on your last message. Ask again in a little while."
        RUNNING.add(conversation)
    box: dict[str, str] = {}
    done = threading.Event()

    def work() -> None:
        try:
            box["text"] = turn(message, conversation, user)
        finally:
            done.set()
            with _lock:
                RUNNING.discard(conversation)
                if "text" in box and not box.get("delivered"):
                    PENDING[conversation] = box["text"]

    threading.Thread(target=work, daemon=True).start()
    if done.wait(REPLY_BUDGET_S):
        with _lock:
            box["delivered"] = "1"
            PENDING.pop(conversation, None)
        return box.get("text", "")
    return "I'm on it. This needs more than a few seconds; message me again shortly for the answer."


# --- http ---------------------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    user: pwd.struct_passwd | None = None

    def _send(self, code: int, obj: object) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in ("/health", "/healthz"):
            return self._send(200, {"ok": True})
        if path == "/schedules":
            return self._send(200, schedules())
        if path == "/":
            return self._send(200, {"agent": "hermes", "shim": STATE, "uptime_s": int(time.time() - STATE["started"])})
        return self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/chat":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(min(n, 1_000_000)) if n else b""
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            return self._send(400, {"error": "invalid JSON"})
        message = str(body.get("message") or "").strip()
        if not message:
            return self._send(400, {"error": "message is required"})
        source = str(body.get("source") or "")
        conversation = str(body.get("conversation_id") or body.get("conversationId") or "default")
        conversation = "".join(ch for ch in conversation if ch.isalnum() or ch in "-_")[:64] or "default"
        if message.startswith(SCHEDULE_PROMPT):
            job_id = message[len(SCHEDULE_PROMPT):].strip().split()[0] if message[len(SCHEDULE_PROMPT):].strip() else ""
            known = {j.get("id") for j in read_jobs()}
            if job_id not in known:
                return self._send(200, {"response": f"No job {job_id!r} here."})
            threading.Thread(target=fire_job, args=(job_id, self.user), daemon=True).start()
            log(f"scheduled fire for job {job_id} (source={source})")
            return self._send(200, {"response": f"Running job {job_id}."})
        log(f"chat source={source} conversation={conversation} chars={len(message)}")
        return self._send(200, {"response": chat(message, conversation, self.user)})

    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        if "/health" not in (args[0] if args else ""):
            log("http " + (fmt % args))


def forwarded_ports(cmdlines: list[list[str]]) -> list[int]:
    """The ports Maritime's in-VM forwarder (`portfwd <from> <to>`) delivers to, from process command lines."""
    out: list[int] = []
    for argv in cmdlines:
        if len(argv) >= 3 and os.path.basename(argv[0]) == "portfwd" and argv[2].isdigit():
            port = int(argv[2])
            if port not in out:
                out.append(port)
    return out


def process_cmdlines() -> list[list[str]]:
    found: list[list[str]] = []
    try:
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                with open(f"/proc/{pid}/cmdline", "rb") as f:
                    argv = [a.decode(errors="replace") for a in f.read().split(b"\0") if a]
            except OSError:
                continue
            if argv:
                found.append(argv)
    except OSError:
        pass
    return found


def listen_ports() -> list[int]:
    """$PORT, plus any port Maritime forwards the VM's 8080 to that nobody serves: its readiness
    check follows the forwarder, which on an image whose base exposes another port (Hermes's
    dashboard, 9119) can point away from $PORT (seen 2026-11-11, a six-minute deploy wait)."""
    ports = [PORT]
    for port in forwarded_ports(process_cmdlines()):
        if port in ports:
            continue
        with socket.socket() as probe:
            probe.settimeout(0.2)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                continue  # something else serves it
        ports.append(port)
    return ports


def main() -> None:
    user = prep()
    Handler.user = user
    ports = listen_ports()
    log(f"up ports={ports} home={HOME} uid={os.geteuid()} hermes_user={'yes' if user else 'no'}")
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    threading.Thread(target=supervise, args=(user,), daemon=True).start()
    threading.Thread(target=watch_jobs, daemon=True).start()
    servers = [ThreadingHTTPServer(("0.0.0.0", port), Handler) for port in ports]
    for extra in servers[1:]:
        threading.Thread(target=extra.serve_forever, daemon=True).start()
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
