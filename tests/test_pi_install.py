"""Pi integration: installing pi-csb-buddy through pi's package manager."""
import json
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import claude_sessions as app


class PiBuddySourceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        env = patch.dict(os.environ, {"PI_CODING_AGENT_DIR": self.directory.name})
        env.start()
        self.addCleanup(env.stop)

    def write(self, data):
        with open(os.path.join(self.directory.name, "settings.json"), "w",
                  encoding="utf-8") as fh:
            fh.write(data if isinstance(data, str) else json.dumps(data))

    def test_missing_or_broken_settings_mean_not_installed(self):
        self.assertEqual(app.pi_buddy_quelle(), "")
        for raw in ("{", "[]", json.dumps({"packages": "npm:pi-csb-buddy"})):
            with self.subTest(raw=raw):
                self.write(raw)
                self.assertEqual(app.pi_buddy_quelle(), "")

    def test_finds_npm_git_and_object_sources(self):
        for source in ("npm:pi-csb-buddy", "npm:pi-csb-buddy@0.1.1",
                       "git:github.com/icepuente/pi-csb-buddy",
                       "https://github.com/icepuente/pi-csb-buddy.git",
                       "git:github.com/icepuente/pi-csb-buddy#v0.1.1"):
            with self.subTest(source=source):
                self.write({"packages": ["npm:pi-lens", source]})
                self.assertEqual(app.pi_buddy_quelle(), source)
        self.write({"packages": [{"source": "npm:pi-csb-buddy@0.1.1"}]})
        self.assertEqual(app.pi_buddy_quelle(), "npm:pi-csb-buddy@0.1.1")

    def test_similar_names_do_not_count(self):
        self.write({"packages": ["npm:pi-csb-buddy-extra", "npm:my-pi-csb-buddy",
                                 "git:github.com/x/pi-csb-buddyfork"]})
        self.assertEqual(app.pi_buddy_quelle(), "")


class PiBuddyInstallTests(unittest.TestCase):
    def run_pi(self, on, source="", returncode=0, stderr=""):
        done = subprocess.CompletedProcess([], returncode, "", stderr)
        with patch.object(app.shutil, "which", return_value="C:/pi/pi.cmd"), \
                patch.object(app, "pi_buddy_quelle", return_value=source), \
                patch.object(app.subprocess, "run", return_value=done) as run:
            return app.pi_buddy_einrichten(on), run

    def test_install_uses_pinned_package(self):
        error, run = self.run_pi(True)
        self.assertEqual(error, "")
        self.assertEqual(run.call_args.args[0],
                         ["C:/pi/pi.cmd", "install", app.PI_BUDDY_PACKAGE])
        self.assertRegex(app.PI_BUDDY_PACKAGE, r"^npm:pi-csb-buddy@\d+\.\d+\.\d+$")

    def test_remove_uses_the_installed_source(self):
        source = "git:github.com/icepuente/pi-csb-buddy"
        error, run = self.run_pi(False, source=source)
        self.assertEqual(error, "")
        self.assertEqual(run.call_args.args[0], ["C:/pi/pi.cmd", "remove", source])

    def test_remove_when_not_installed_does_nothing(self):
        error, run = self.run_pi(False)
        self.assertEqual(error, "")
        run.assert_not_called()

    def test_failure_reports_last_line(self):
        error, _run = self.run_pi(True, returncode=1,
                                  stderr="npm ERR! one\nnpm ERR! 404 Not Found\n")
        self.assertEqual(error, "npm ERR! 404 Not Found")

    def test_without_pi(self):
        with patch.object(app.shutil, "which", return_value=None), \
                patch.object(app.subprocess, "run") as run:
            self.assertEqual(app.pi_buddy_einrichten(True), "no_pi")
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
