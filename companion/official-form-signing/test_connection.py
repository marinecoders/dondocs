import http.client
import json
import threading
import unittest
from http.server import HTTPServer
from unittest.mock import Mock, patch

from bridge import Handler
from connection import MAX_SESSION_SECONDS, SESSION_SECONDS, Sessions, approve_connection


class NativeApprovalTest(unittest.TestCase):
    @patch("connection.sys.platform", "darwin")
    @patch("connection.subprocess.run")
    def test_only_an_explicit_allow_grants_access(self, run):
        for output, error, status, expected in [
            (b"Allow\n", b"", 0, True), (b"", b"", 0, False),
            (b"", b"User canceled. (-128)", 1, False),
        ]:
            run.return_value = Mock(stdout=output, stderr=error, returncode=status)
            self.assertEqual(approve_connection("https://signing.example"), expected)
            self.assertIn("https://signing.example", run.call_args.args[0][-1])
        run.return_value = Mock(stdout=b"", stderr=b"Desktop unavailable", returncode=1)
        with self.assertRaises(OSError):
            approve_connection("https://signing.example")

    @patch("connection.sys.platform", "win32")
    @patch.dict("connection.os.environ", {"SystemRoot": "C:/Windows"})
    @patch("connection.subprocess.run")
    def test_windows_prompt_uses_the_configured_origin_as_data(self, run):
        run.return_value = Mock(stdout=b"Allow\r\n", returncode=0)
        self.assertTrue(approve_connection("https://signing.example"))
        self.assertNotIn("signing.example", run.call_args.args[0][-1])
        self.assertIn("https://signing.example", run.call_args.kwargs["env"]["DONDOCS_CONSENT_TEXT"])


class ConnectionTest(unittest.TestCase):
    def setUp(self):
        self.now = 100
        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.server.origin = "https://signing.example"
        self.server.sessions = Sessions(lambda: self.now)
        self.approve = self.enterContext(patch("bridge.approve_connection", return_value=True))
        worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(worker.join)
        self.addCleanup(self.server.shutdown)

    def post(self, path, token=None, **headers):
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            headers.setdefault("Origin", self.server.origin)
            if token:
                headers["Authorization"] = "Bearer " + token
            client.request("POST", path, headers=headers)
            response = client.getresponse()
            return response.status, json.load(response)
        finally:
            client.close()

    def connect(self):
        return self.post("/session", **{"X-DonDocs-Connect": "1"})

    def test_consent_precedes_access_and_disconnect_revokes(self):
        self.assertEqual(self.post("/session")[0], 400)
        self.assertEqual(self.post("/session", Origin="https://other.example", **{"X-DonDocs-Connect": "1"})[0], 403)
        self.assertEqual(self.post("/session", Host="other.example", **{"X-DonDocs-Connect": "1"})[0], 403)
        self.assertEqual(self.post("/identities")[0], 401)
        self.approve.assert_not_called()
        status, grant = self.connect()
        self.assertEqual(status, 200)
        self.approve.assert_called_once_with(self.server.origin)
        self.assertEqual(grant["expiresIn"], SESSION_SECONDS)
        self.assertEqual(self.post("/disconnect", grant["token"])[0], 200)
        self.assertEqual(self.post("/inspect", grant["token"])[0], 401)

    def test_activity_cannot_extend_approval_past_its_absolute_deadline(self):
        issued = self.now
        _, grant = self.connect()
        self.assertEqual(grant["maxAgeSeconds"], 4 * 60 * 60)
        token = grant["token"]
        self.server.helper = "unused"
        with patch("bridge.subprocess.run", return_value=Mock(stdout=b"[]")):
            for elapsed in range(600, MAX_SESSION_SECONDS, 600):
                self.now = issued + elapsed
                self.assertEqual(self.post("/identities", token)[0], 200)
            self.now = issued + MAX_SESSION_SECONDS - 1
            self.assertEqual(self.post("/identities", token)[0], 200)
            self.now += 1
            self.assertEqual(self.post("/sign", token)[0], 401)
            self.assertEqual(self.post("/disconnect", token)[0], 401)
            _, fresh = self.connect()
            self.assertNotEqual(fresh["token"], token)
            self.assertEqual(self.post("/identities", fresh["token"])[0], 200)
        self.assertEqual(self.approve.call_count, 2)

    def test_denial_expiry_and_independent_sessions(self):
        self.approve.return_value = False
        self.assertEqual(self.connect()[0], 403)
        self.assertEqual(self.connect()[0], 429)
        self.now += 3
        self.approve.return_value = True
        first = self.connect()[1]["token"]
        self.now += 3
        second = self.connect()[1]["token"]
        self.assertNotEqual(first, second)
        self.assertEqual(self.post("/disconnect", first)[0], 200)
        self.now += SESSION_SECONDS - 1
        self.server.helper = "unused"
        with patch("bridge.subprocess.run", return_value=Mock(stdout=b"[]")):
            self.assertEqual(self.post("/identities", second), (200, []))
        self.now += SESSION_SECONDS
        self.assertEqual(self.post("/sign", second)[0], 401)


if __name__ == "__main__":
    unittest.main()
