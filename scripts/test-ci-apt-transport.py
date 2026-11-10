"""Exercise CI's actual APT setup against isolated source-file fixtures."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("ci-use-ubuntu-archive.sh")


class AptTransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "apt"
        self.root.mkdir()
        tools = Path(self.temp.name) / "bin"
        tools.mkdir()
        sudo = tools / "sudo"
        sudo.write_text('#!/bin/sh\nexec "$@"\n')
        sudo.chmod(0o755)
        self.env = {**os.environ, "PATH": str(tools) + os.pathsep + os.environ["PATH"]}

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def configure(self, root=None):
        return subprocess.run(
            ["bash", str(SCRIPT), str(root or self.root)],
            env=self.env, capture_output=True, text=True,
        )

    def test_mirror_priorities_use_https_without_http_fallbacks(self):
        path = self.write("apt-mirrors.txt", "# Ubuntu mirrors\nhttp://azure.archive.ubuntu.com/ubuntu priority:1\nhttps://archive.ubuntu.com/ubuntu priority:2\n")
        result = self.configure()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(path.read_text(), "# Ubuntu mirrors\nhttps://archive.ubuntu.com/ubuntu priority:1\nhttps://archive.ubuntu.com/ubuntu priority:2\n")

    def test_security_ports_and_country_mirrors_keep_their_paths(self):
        path = self.write("apt-mirrors-security.txt", "http://security.ubuntu.com/ubuntu priority:1\nhttp://ports.ubuntu.com/ubuntu-ports priority:2\nhttp://us.archive.ubuntu.com/ubuntu priority:3\n")
        result = self.configure()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(path.read_text(), "https://security.ubuntu.com/ubuntu priority:1\nhttps://ports.ubuntu.com/ubuntu-ports priority:2\nhttps://us.archive.ubuntu.com/ubuntu priority:3\n")

    def test_deb822_and_legacy_sources_preserve_repository_settings(self):
        deb822 = self.write("sources.list.d/ubuntu.sources", "Types: deb\nURIs: http://archive.ubuntu.com/ubuntu\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n")
        legacy = self.write("sources.list", "deb [signed-by=/keyring.gpg] http://azure.archive.ubuntu.com/ubuntu noble main\n")
        third_party = self.write("sources.list.d/vendor.list", "deb https://packages.example.com/ubuntu noble main\ndeb http://archive.ubuntu.com.example.org/ubuntu noble main\n")
        before = third_party.read_text()
        result = self.configure()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("URIs: https://archive.ubuntu.com/ubuntu", deb822.read_text())
        self.assertIn("Suites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg", deb822.read_text())
        self.assertEqual(legacy.read_text(), "deb [signed-by=/keyring.gpg] https://archive.ubuntu.com/ubuntu noble main\n")
        self.assertEqual(third_party.read_text(), before)

    def test_repeat_runs_are_idempotent_and_bound_network_retries(self):
        path = self.write("apt-mirrors.txt", "https://archive.ubuntu.com/ubuntu priority:1\n")
        self.assertEqual(self.configure().returncode, 0)
        first = path.read_bytes()
        config = self.root / "apt.conf.d/80-dondocs-ci-transport"
        self.assertEqual(config.read_text(), 'Acquire::Retries "2";\nAcquire::http::Timeout "20";\nAcquire::https::Timeout "20";\n')
        self.assertEqual(self.configure().returncode, 0)
        self.assertEqual(path.read_bytes(), first)

    def test_missing_apt_directory_fails_before_writing(self):
        missing = Path(self.temp.name) / "missing"
        result = self.configure(missing)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("APT directory does not exist", result.stderr)
        self.assertFalse(missing.exists())


if __name__ == "__main__":
    unittest.main()
