"""Pi integration (pi-csb-buddy): only live claude-bridge sessions show the buddy."""
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

    def state(self, now=None):
        with patch.object(app, "_CLAUDE_CACHE", {"t": 0.0, "active": False, "keys": frozenset()}), \
                patch.object(app.time, "time", return_value=self.now if now is None else now), \
                patch.object(app, "_win_process_names_with_path", return_value=self.processes), \
                patch.object(app, "_win_list_windows_hwnd", return_value=[]):
            return app._pi_buddy_state()

    def test_activity_selects_existing_animation(self):
        expected = {"thinking": "work think", "active": "work coding",
                    "awaiting_approval": "allow", "waiting": "done",
                    "idle": "idle breathe", "error": "expression surprise",
                    "limit": "limit"}
        for state, animation in expected.items():
            with self.subTest(state=state):
                self.write(state=state, activity_at=99)
                detected = self.state()
                self.assertIsNotNone(detected)
                assert detected is not None
                self.assertEqual(app.BUDDY_STATE_MAP[detected], animation)
                self.assertIn(animation, app.BUDDY_ANIMS)

    def test_legacy_presence_only_extension_is_idle(self):
        self.write()
        self.assertEqual(self.state(), "idle")

    def test_invalid_activity_is_idle_and_does_not_hide_live_session(self):
        for state in ("unknown", [], None):
            with self.subTest(state=state):
                self.write(state=state)
                self.assertEqual(self.state(), "idle")

    def test_invalid_activity_timestamp_falls_back_to_heartbeat(self):
        for timestamp in (-1, 101, float("nan"), "old"):
            with self.subTest(timestamp=timestamp):
                self.write(state="waiting", activity_at=timestamp)
                self.assertEqual(self.state(), "waiting")

    def test_fresh_heartbeat_does_not_keep_finished_session_in_done_animation(self):
        for age, expected in ((0, "waiting"), (180, "recent"),
                              (300, "idle"), (900, "sleep")):
            with self.subTest(age=age):
                self.write(state="waiting", activity_at=100, updated_at=100 + age)
                self.assertEqual(self.state(now=100 + age), expected)

    def test_long_running_tool_does_not_become_idle_while_heartbeats_continue(self):
        self.write(state="active", activity_at=1, updated_at=2000)
        self.assertEqual(self.state(now=2000), "active")

    def test_stale_or_exited_pi_does_not_override_native_animation(self):
        self.write(state="active", updated_at=80)
        self.assertIsNone(self.state())
        self.write(state="active")
        self.processes = []
        self.assertIsNone(self.state())

    def test_multiple_sessions_prioritize_attention_then_work_then_idle(self):
        self.processes.append(("node.exe", "", 124))
        other_path = os.path.join(self.directory.name, "124.json")
        self.write(state="active", activity_at=99)
        with open(other_path, "w") as fh:
            json.dump(dict(version=1, pid=124, provider="claude-bridge",
                           updated_at=100, state="awaiting_approval", activity_at=90), fh)
        self.assertEqual(self.state(), "awaiting_approval")
        with open(other_path, "w") as fh:
            json.dump(dict(version=1, pid=124, provider="claude-bridge",
                           updated_at=100, state="waiting", activity_at=100), fh)
        self.assertEqual(self.state(), "active")

    def test_old_sleeping_session_does_not_mask_new_idle_session(self):
        self.processes.append(("node.exe", "", 124))
        self.write(state="waiting", activity_at=1, updated_at=1000)
        with open(os.path.join(self.directory.name, "124.json"), "w") as fh:
            json.dump(dict(version=1, pid=124, provider="claude-bridge",
                           updated_at=1000, state="idle", activity_at=999), fh)
        self.assertEqual(self.state(now=1000), "idle")


if __name__ == "__main__":
    unittest.main()
