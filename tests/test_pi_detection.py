"""Private Pi integration: only live claude-bridge sessions show the buddy."""
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import claude_sessions as app


class PiDetectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.directory_patch = patch.object(app, "PI_BUDDY_DIR", self.directory.name)
        self.directory_patch.start()
        self.addCleanup(self.directory_patch.stop)
        self.now = 100.0
        self.processes = [("node.exe", "", 123)]

    def write(self, **changes):
        data = dict(version=1, pid=123, provider="claude-bridge", updated_at=self.now)
        data.update(changes)
        with open(os.path.join(self.directory.name, "123.json"), "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def test_live_bridge_session(self):
        self.write()
        self.assertEqual(app._pi_claude_bridge_keys(self.processes, self.now), {("pi", 123)})

    def test_idle_session_heartbeat_stays_visible(self):
        self.write(updated_at=95.0)
        self.assertTrue(app._pi_claude_bridge_keys(self.processes, self.now))

    def test_crashed_session_is_hidden_even_with_fresh_file(self):
        self.write()
        self.assertFalse(app._pi_claude_bridge_keys([], self.now))

    def test_background_node_process_without_signal_is_hidden(self):
        self.assertFalse(app._pi_claude_bridge_keys(self.processes, self.now))

    def test_invalid_stale_or_other_provider_signal_is_hidden(self):
        for changes in ({"updated_at": 84}, {"updated_at": 101},
                        {"updated_at": "100"}, {"updated_at": float("nan")},
                        {"provider": "anthropic"}, {"pid": 124}, {"pid": True},
                        {"version": 2}):
            with self.subTest(changes=changes):
                self.write(**changes)
                self.assertFalse(app._pi_claude_bridge_keys(self.processes, self.now))

    def test_pid_reused_by_desktop_does_not_activate(self):
        self.write()
        self.assertFalse(app._pi_claude_bridge_keys([("claude.exe", "", 123)], self.now))

    def test_partial_or_oversized_file_is_ignored(self):
        for raw in ("{", "[]", "x" * 4097):
            with self.subTest(raw=raw[:10]):
                with open(os.path.join(self.directory.name, "123.json"), "w") as fh:
                    fh.write(raw)
                self.assertFalse(app._pi_claude_bridge_keys(self.processes, self.now))

    def test_deleted_heartbeat_hides_buddy(self):
        self.write()
        os.remove(os.path.join(self.directory.name, "123.json"))
        self.assertFalse(app._pi_claude_bridge_keys(self.processes, self.now))

    def test_pi_activates_same_context_used_by_visibility_and_snooze(self):
        self.write()
        with patch.object(app, "_CLAUDE_CACHE", {"t": 0.0, "active": False, "keys": frozenset()}), \
                patch.object(app.time, "time", return_value=self.now), \
                patch.object(app, "_win_process_names_with_path", return_value=self.processes), \
                patch.object(app, "_win_list_windows_hwnd", return_value=[]):
            self.assertTrue(app._claude_context_active())
            self.assertEqual(app._claude_context_keys(), frozenset({("pi", 123)}))


if __name__ == "__main__":
    unittest.main()
