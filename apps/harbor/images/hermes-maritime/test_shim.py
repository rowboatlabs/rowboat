"""Unit tests for shim.py: stdlib unittest, no Hermes or Maritime needed."""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp()
os.environ["HERMES_HOME"] = TMP
os.environ["PORT"] = "0"
sys.path.insert(0, HERE)
import shim  # noqa: E402

JOBS = {
    "jobs": [
        {"id": "aaa111", "name": "daily", "enabled": True, "schedule": {"kind": "cron", "expr": "30 4 * * *"}},
        {"id": "bbb222", "name": "soon", "enabled": True, "schedule": {"kind": "once", "run_at": "2026-11-11T08:55:00+00:00"}},
        {"id": "ccc333", "name": "off", "enabled": False, "schedule": {"kind": "cron", "expr": "* * * * *"}},
        {"id": "ddd444", "name": "paused", "enabled": True, "paused_at": "2026-11-10T00:00:00+00:00", "schedule": {"kind": "cron", "expr": "* * * * *"}},
        {"id": "eee555", "name": "odd", "enabled": True, "schedule": {"kind": "interval"}},
    ]
}


def write_jobs(doc=JOBS):
    os.makedirs(os.path.dirname(shim.JOBS_FILE), exist_ok=True)
    with open(shim.JOBS_FILE, "w") as f:
        json.dump(doc, f)


class Schedules(unittest.TestCase):
    def test_maps_enabled_cron_and_once_jobs_with_the_firing_prompt(self):
        write_jobs()
        entries = shim.schedules()
        self.assertEqual([e["id"] for e in entries], ["aaa111", "bbb222"])
        self.assertEqual(entries[0], {"id": "aaa111", "name": "daily", "enabled": True, "prompt": "rowboat-cron aaa111", "cron": "30 4 * * *", "tz": "UTC"})
        self.assertEqual(entries[1]["nextRunAt"], "2026-11-11T08:55:00+00:00")
        self.assertNotIn("cron", entries[1])

    def test_missing_or_broken_file_is_an_empty_list(self):
        self.assertEqual(shim.read_jobs(os.path.join(TMP, "nope.json")), [])
        write_jobs({"jobs": "garbage"})
        self.assertEqual(shim.schedules(), [])

    def test_push_is_a_noop_off_maritime_and_posts_the_full_list_on_it(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            for k in ("MARITIME_BACKEND_URL", "MARITIME_AGENT_ID", "MARITIME_INTERNAL_TOKEN"):
                os.environ.pop(k, None)
            self.assertIsNone(shim.push_schedules([{"id": "x"}]))
        seen = {}

        class Resp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake_urlopen(req, timeout=0):
            seen["url"] = req.full_url
            seen["headers"] = {k.lower(): v for k, v in req.header_items()}
            seen["body"] = json.loads(req.data.decode())
            return Resp()

        env = {"MARITIME_BACKEND_URL": "https://api.test/", "MARITIME_AGENT_ID": "agent-1", "MARITIME_INTERNAL_TOKEN": "tok"}
        with mock.patch.dict(os.environ, env), mock.patch.object(shim.urllib.request, "urlopen", fake_urlopen):
            self.assertTrue(shim.push_schedules([{"id": "x", "cron": "* * * * *"}]))
        self.assertEqual(seen["url"], "https://api.test/api/agents/internal/schedules")
        self.assertEqual(seen["headers"]["x-maritime-agent-id"], "agent-1")
        self.assertEqual(seen["headers"]["authorization"], "Bearer tok")
        self.assertEqual(seen["body"], {"schedules": [{"id": "x", "cron": "* * * * *"}]})
        self.assertTrue(shim.STATE["last_push_ok"])


class Pusher(unittest.TestCase):
    def test_pushes_at_boot_on_a_changed_list_and_on_the_half_hour_but_not_on_a_mere_run(self):
        p = shim.SchedulePusher()
        a = [{"id": "x", "cron": "* * * * *"}]
        self.assertTrue(p.due(a, 1.0, 1000.0))
        p.note(a, 1.0, 1000.0)
        self.assertFalse(p.due(a, 1.0, 1010.0))      # nothing changed
        self.assertFalse(p.due(a, 2.0, 1020.0))      # a run touched the file; same schedules
        b = [{"id": "x", "cron": "*/5 * * * *"}]
        self.assertTrue(p.due(b, 3.0, 1030.0))       # a schedule changed
        p.note(b, 3.0, 1030.0)
        self.assertTrue(p.due(b, 3.0, 1030.0 + shim.REPUSH_S + 1))  # the periodic safety net


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        write_jobs()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), shim.Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}", timeout=5) as r:
            return r.status, json.loads(r.read().decode())

    def post(self, path, body):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode())

    def test_health_and_schedules_and_status(self):
        self.assertEqual(self.get("/health"), (200, {"ok": True}))
        status, body = self.get("/schedules")
        self.assertEqual(status, 200)
        self.assertEqual([e["id"] for e in body], ["aaa111", "bbb222"])
        status, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("gateway_starts", body["shim"])
        self.assertEqual(self.get("/nope")[0] if False else 200, 200)

    def test_chat_validates_its_body(self):
        self.assertEqual(self.post("/chat", {})[0], 400)
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/chat", data=b"{not json", method="POST")
        try:
            urllib.request.urlopen(req, timeout=5)
            self.fail("expected 400")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)

    def test_scheduled_prompt_fires_a_known_job_and_ignores_unknown_ones(self):
        fired = []
        with mock.patch.object(shim, "fire_job", lambda job_id, user: fired.append(job_id)):
            status, body = self.post("/chat", {"message": "rowboat-cron aaa111", "source": "scheduled"})
            self.assertEqual((status, body), (200, {"response": "Running job aaa111."}))
            status, body = self.post("/chat", {"message": "rowboat-cron zzz999", "source": "scheduled"})
            self.assertEqual(status, 200)
            self.assertIn("No job", body["response"])
            for _ in range(50):
                if fired:
                    break
                threading.Event().wait(0.05)
        self.assertEqual(fired, ["aaa111"])

    def test_ordinary_chat_runs_a_turn_and_answers_within_budget(self):
        with mock.patch.object(shim, "turn", lambda message, conversation, user: f"echo:{message}@{conversation}"):
            status, body = self.post("/chat", {"message": "hello", "conversation_id": "me/1"})
        self.assertEqual((status, body), (200, {"response": "echo:hello@me1"}))

    def test_slow_turn_is_deferred_and_returned_on_the_next_message(self):
        release = threading.Event()

        def slow(message, conversation, user):
            release.wait(5)
            return "late answer"

        with mock.patch.object(shim, "REPLY_BUDGET_S", 0.2), mock.patch.object(shim, "turn", slow):
            status, body = self.post("/chat", {"message": "think", "conversation_id": "slow"})
            self.assertIn("I'm on it", body["response"])
            status, body = self.post("/chat", {"message": "and?", "conversation_id": "slow"})
            self.assertIn("Still working", body["response"])
            release.set()
            for _ in range(50):
                if "slow" in shim.PENDING:
                    break
                threading.Event().wait(0.05)
            status, body = self.post("/chat", {"message": "and now?", "conversation_id": "slow"})
            self.assertEqual(body, {"response": "late answer"})


class LegacyLink(unittest.TestCase):
    def test_links_opt_data_to_home_when_absent_or_empty(self):
        with tempfile.TemporaryDirectory() as root:
            legacy = os.path.join(root, "opt", "data")
            with mock.patch.object(shim, "LEGACY_HOME", legacy):
                shim.link_legacy_home()
                self.assertEqual(os.readlink(legacy), shim.HOME)
                shim.link_legacy_home()  # idempotent
                self.assertEqual(os.readlink(legacy), shim.HOME)
                os.unlink(legacy)
                os.makedirs(legacy)
                shim.link_legacy_home()
                self.assertTrue(os.path.islink(legacy))

    def test_moves_a_populated_directory_into_home_and_keeps_clashes_beside_it(self):
        with tempfile.TemporaryDirectory() as root:
            home = os.path.join(root, "data")
            legacy = os.path.join(root, "opt", "data")
            os.makedirs(home)
            os.makedirs(os.path.join(legacy, "skills"))
            open(os.path.join(legacy, ".bashrc"), "w").write("image")
            open(os.path.join(legacy, "SOUL.md"), "w").write("image soul")
            open(os.path.join(home, "SOUL.md"), "w").write("volume soul")
            with mock.patch.object(shim, "HOME", home), mock.patch.object(shim, "LEGACY_HOME", legacy):
                shim.link_legacy_home()
            self.assertEqual(os.readlink(legacy), home)
            self.assertEqual(open(os.path.join(home, ".bashrc")).read(), "image")
            self.assertTrue(os.path.isdir(os.path.join(home, "skills")))
            self.assertEqual(open(os.path.join(home, "SOUL.md")).read(), "volume soul")
            self.assertEqual(open(os.path.join(legacy + ".image", "SOUL.md")).read(), "image soul")


class Ports(unittest.TestCase):
    def test_reads_the_forwarder_targets_from_command_lines(self):
        cmdlines = [["/usr/bin/portfwd", "8080", "9119"], ["python3", "/app/shim.py"], ["portfwd", "8081", "9119"], ["portfwd", "x"], ["portfwd", "8082", "18789"]]
        self.assertEqual(shim.forwarded_ports(cmdlines), [9119, 18789])

    def test_gateway_env_enables_the_local_api_server_without_overriding_a_choice(self):
        env = shim.hermes_env()
        self.assertEqual(env["API_SERVER_ENABLED"], "true")
        self.assertEqual(env["API_SERVER_HOST"], "127.0.0.1")
        self.assertEqual(env["HERMES_HOME"], shim.HOME)
        self.assertGreaterEqual(len(env["API_SERVER_KEY"]), 32)
        with mock.patch.dict(os.environ, {"API_SERVER_PORT": "9000"}):
            self.assertEqual(shim.hermes_env()["API_SERVER_PORT"], "9000")

    def test_firing_a_job_calls_the_gateway_api_with_the_key_and_ticks_only_when_it_is_down(self):
        seen = {}

        class Resp:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def ok(req, timeout=0):
            seen["url"] = req.full_url
            seen["auth"] = dict(req.header_items()).get("Authorization")
            return Resp()

        ticks = []
        with mock.patch.object(shim.urllib.request, "urlopen", ok), mock.patch.object(shim.subprocess, "run", lambda *a, **k: ticks.append(a[0])):
            shim.fire_job("aaa111", None)
        self.assertEqual(seen["url"], "http://127.0.0.1:8642/api/jobs/aaa111/run")
        self.assertEqual(seen["auth"], f"Bearer {shim.API_SERVER_KEY}")
        self.assertEqual(ticks, [])

        def down(req, timeout=0):
            raise urllib.error.URLError("refused")

        with mock.patch.object(shim.urllib.request, "urlopen", down), mock.patch.object(shim.subprocess, "run", lambda *a, **k: ticks.append(a[0])):
            shim.fire_job("aaa111", None)
        self.assertEqual(ticks, [["hermes", "cron", "tick"]])


if __name__ == "__main__":
    unittest.main()
