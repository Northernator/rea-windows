"""Source-owned tests for the Windows native UI helper.

The helper imports uiautomation at module load, so these tests stub the
module before import and exercise the pure logic: node walking, path
resolution, step outcomes, and envelope shape.
"""

import importlib.util
import json
import os
import sys
import types
import unittest
from unittest.mock import patch


def _install_fake_uiautomation():
    """Install a minimal uiautomation stand-in before the helper imports it."""
    module = types.ModuleType("uiautomation")

    class Pattern:
        def __init__(self, name):
            self.name = name

    class PatternId:
        InvokePattern = Pattern("Invoke")
        ValuePattern = Pattern("Value")
        ExpandCollapsePattern = Pattern("ExpandCollapse")
        SelectionItemPattern = Pattern("SelectionItem")
        TogglePattern = Pattern("Toggle")
        ScrollPattern = Pattern("Scroll")
        TextPattern = Pattern("Text")

    module.PatternId = PatternId
    module.SendKey = lambda text: None
    module.SendKeys = lambda text: None
    module.ScrollAmount = types.SimpleNamespace(NoAmount=2, SmallIncrement=4, SmallDecrement=1)
    module.GetRootControl = lambda: None
    sys.modules["uiautomation"] = module
    return module


_install_fake_uiautomation()

spec = importlib.util.spec_from_file_location(
    "rea_native_ui_windows",
    os.path.join(os.path.dirname(__file__), "rea_native_ui_windows.py"),
)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class FakePattern:
    def __init__(self, kind, value=None):
        self.kind = kind
        self._value = value
        self.invoked = False
        self.selected = False
        self.set_value = None
        self.scrolled = None

    def Invoke(self):
        self.invoked = True

    def Select(self):
        self.selected = True

    def SetValue(self, text):
        self.set_value = text
        self._value = text

    def Scroll(self, horizontal, vertical):
        self.scrolled = (horizontal, vertical)

    @property
    def Value(self):
        return self._value

    @property
    def IsReadOnly(self):
        return False

    @property
    def DocumentRange(self):
        outer = self

        class _Range:
            def GetText(self, length):
                return outer._value or ""

        return _Range()


class FakeControl:
    """Tree node with a fixed pattern set and auto-wired sibling chain."""

    def __init__(self, name, control_type, patterns=None, children=None, value=None):
        self.Name = name
        self.ControlTypeName = control_type
        self._patterns = {p.kind: p for p in (patterns or [])}
        self._children = list(children or [])
        self._value = value
        # wire the sibling chain exactly as UIA exposes it
        for index, child in enumerate(self._children):
            following = self._children[index + 1] if index + 1 < len(self._children) else None
            child.GetNextSiblingControl = (
                lambda f=following: f
            )

    def GetFirstChildControl(self):
        return self._children[0] if self._children else None

    def GetNextSiblingControl(self):
        return None

    def GetChildren(self):
        return list(self._children)

    def SetFocus(self):
        return None

    def GetInvokePattern(self):
        return self._patterns.get("Invoke")

    def GetValuePattern(self):
        return self._patterns.get("Value")

    def GetSelectionItemPattern(self):
        return self._patterns.get("SelectionItem")

    def GetExpandCollapsePattern(self):
        return self._patterns.get("ExpandCollapse")

    def GetTogglePattern(self):
        return self._patterns.get("Toggle")

    def GetScrollPattern(self):
        return self._patterns.get("Scroll")

    def GetTextPattern(self):
        return self._patterns.get("Text")


def _sibling_chain(*controls):
    """Wire controls as siblings of one parent."""
    for index, control in enumerate(controls):
        control._next = controls[index + 1] if index + 1 < len(controls) else None
    return controls


class NodeWalkTests(unittest.TestCase):
    def test_capture_tree_assigns_depth_first_paths(self):
        leaf_a = FakeControl("A", "ButtonControl", [FakePattern("Invoke")])
        leaf_b = FakeControl("B", "EditControl", [FakePattern("Value", value="hi")])
        group = FakeControl("Group", "PaneControl", children=[leaf_a, leaf_b])
        window = FakeControl("Window", "WindowControl", children=[group])
        nodes, truncated, gaps = helper.capture_tree(window, 100, True)
        paths = [tuple(node["path"]) for node in nodes]
        self.assertEqual(paths, [(0,), (0, 0), (0, 1)])
        self.assertEqual(nodes[1]["actions"], ["invoke"])
        self.assertEqual(nodes[2]["value"], "hi")
        self.assertFalse(truncated)
        self.assertEqual(gaps, [])

    def test_capture_tree_truncates_at_max_nodes(self):
        children = [
            FakeControl(f"C{index}", "ButtonControl", [FakePattern("Invoke")])
            for index in range(5)
        ]
        window = FakeControl("Window", "WindowControl", children=children)
        nodes, truncated, _ = helper.capture_tree(window, 3, True)
        self.assertEqual(len(nodes), 3)
        self.assertTrue(truncated)


class PathResolutionTests(unittest.TestCase):
    def test_resolve_by_path_walks_sibling_indices(self):
        leaf = FakeControl("Target", "ButtonControl", [FakePattern("Invoke")])
        other = FakeControl("Other", "ButtonControl")
        window = FakeControl("Window", "WindowControl", children=[other, leaf])
        resolved = helper.resolve_by_path(window, [1])
        self.assertIs(resolved, leaf)

    def test_resolve_by_path_returns_none_when_missing(self):
        window = FakeControl("Window", "WindowControl", children=[])
        self.assertIsNone(helper.resolve_by_path(window, [3]))


class StepTests(unittest.TestCase):
    def _window_with(self, control):
        return FakeControl("Window", "WindowControl", children=[control])

    def test_click_uses_invoke_pattern(self):
        pattern = FakePattern("Invoke")
        control = FakeControl("OK", "ButtonControl", [pattern])
        outcome, reason = helper.run_step(self._window_with(control), {"kind": "click", "path": [0]})
        self.assertEqual(outcome, "completed")
        self.assertIsNone(reason)
        self.assertTrue(pattern.invoked)

    def test_click_falls_back_to_selection_item(self):
        pattern = FakePattern("SelectionItem")
        control = FakeControl("Tab", "TabItemControl", [pattern])
        outcome, reason = helper.run_step(self._window_with(control), {"kind": "click", "path": [0]})
        self.assertEqual(outcome, "completed")
        self.assertTrue(pattern.selected)
        self.assertIn("selectionitem", reason)

    def test_click_without_patterns_fails(self):
        control = FakeControl("Label", "TextControl")
        outcome, reason = helper.run_step(self._window_with(control), {"kind": "click", "path": [0]})
        self.assertEqual(outcome, "failed")
        self.assertIn("no invoke", reason)

    def test_key_entry_sets_value_pattern(self):
        pattern = FakePattern("Value", value="")
        control = FakeControl("Editor", "DocumentControl", [pattern])
        outcome, _ = helper.run_step(
            self._window_with(control), {"kind": "key-entry", "path": [0], "text": "hello"}
        )
        self.assertEqual(outcome, "completed")
        self.assertEqual(pattern.set_value, "hello")

    def test_key_entry_falls_back_to_send_keys(self):
        # A value pattern that ignores SetValue must not report success.
        class Ignoring(FakePattern):
            def SetValue(self, text):
                self.set_value = text  # accepted but never applied

        pattern = Ignoring("Value", value=None)
        control = FakeControl("Editor", "DocumentControl", [pattern])
        reads = iter([None, "hello"])  # write ignored, typing landed
        with patch.object(helper, "control_value", side_effect=lambda _c: next(reads)):
            outcome, reason = helper.run_step(
                self._window_with(control), {"kind": "key-entry", "path": [0], "text": "hello"}
            )
        self.assertEqual(outcome, "completed")
        self.assertIn("SendKeys", reason)

    def test_scroll_uses_scroll_pattern(self):
        pattern = FakePattern("Scroll")
        control = FakeControl("List", "ListControl", [pattern])
        outcome, _ = helper.run_step(
            self._window_with(control),
            {"kind": "scroll", "path": [0], "direction": "decrement"},
        )
        self.assertEqual(outcome, "completed")
        self.assertEqual(pattern.scrolled, (2, 1))

    def test_scroll_increment_does_not_scroll_horizontally(self):
        pattern = FakePattern("Scroll")
        control = FakeControl("List", "ListControl", [pattern])
        self.assertEqual(helper.run_step(self._window_with(control), {"kind": "scroll", "path": [0], "direction": "increment"})[0], "completed")
        self.assertEqual(pattern.scrolled, (2, 4))

    def test_negative_or_boolean_paths_fail(self):
        for path in ([-1], [True], ["0"]):
            self.assertEqual(helper.run_step(None, {"kind": "click", "path": path})[0], "failed")

    def test_wait_rejects_negative_and_respects_deadline(self):
        self.assertEqual(helper.run_step(None, {"kind": "wait", "milliseconds": -1})[0], "failed")
        with patch.object(helper.time, "sleep") as sleep, patch.object(helper.time, "monotonic", return_value=10):
            self.assertEqual(helper.run_step(None, {"kind": "wait", "milliseconds": 1000}, deadline=10.1)[0], "cancelled")
            sleep.assert_not_called()

    def test_key_entry_requires_exact_read_back(self):
        control = FakeControl("Editor", "DocumentControl")
        with patch.object(helper, "control_value", return_value="old hello"), patch.object(helper.auto, "SendKeys"):
            outcome, reason = helper.run_step(self._window_with(control), {"kind": "key-entry", "path": [0], "text": "hello"})
        self.assertEqual(outcome, "failed")
        self.assertIn("exact text", reason)

    def test_key_entry_escapes_sendkeys_syntax_and_replaces(self):
        control = FakeControl("Editor", "DocumentControl")
        with patch.object(helper, "control_value", return_value="{Enter}"), patch.object(helper.auto, "SendKeys") as send:
            outcome, _ = helper.run_step(self._window_with(control), {"kind": "key-entry", "path": [0], "text": "{Enter}"})
        self.assertEqual(outcome, "completed")
        self.assertEqual(send.call_args_list[0].args, ("{Ctrl}a",))
        self.assertEqual(send.call_args_list[1].args, ("{{}Enter{}}",))

    def test_wait_is_capped(self):
        outcome, reason = helper.run_step(None, {"kind": "wait", "milliseconds": 10})
        self.assertEqual(outcome, "completed")
        outcome, reason = helper.run_step(
            None, {"kind": "wait", "milliseconds": helper.MAX_WAIT_MS + 1}
        )
        self.assertEqual(outcome, "failed")
        self.assertIn("exceeds", reason)

    def test_unknown_kind_fails(self):
        control = FakeControl("X", "ButtonControl", [FakePattern("Invoke")])
        outcome, reason = helper.run_step(self._window_with(control), {"kind": "teleport", "path": [0]})
        self.assertEqual(outcome, "failed")
        self.assertIn("unsupported step kind", reason)

    def test_missing_path_fails(self):
        window = FakeControl("Window", "WindowControl", children=[])
        window.GetNextSiblingControl = lambda: None
        outcome, reason = helper.run_step(window, {"kind": "click", "path": [7]})
        self.assertEqual(outcome, "failed")
        self.assertIn("node not found", reason)


class ValueReadingTests(unittest.TestCase):
    def test_empty_value_is_observable(self):
        control = FakeControl("Editor", "EditControl", [FakePattern("Value", value="")])
        self.assertEqual(helper.control_value(control), "")
    def test_value_pattern_wins(self):
        control = FakeControl(
            "Editor",
            "DocumentControl",
            [FakePattern("Value", value="from-value"), FakePattern("Text", value="from-text")],
        )
        self.assertEqual(helper.control_value(control), "from-value")

    def test_text_pattern_is_the_fallback(self):
        # Some editors expose a ValuePattern whose Value is null.
        control = FakeControl(
            "Editor",
            "DocumentControl",
            [FakePattern("Value", value=None), FakePattern("Text", value="from-text")],
        )
        self.assertEqual(helper.control_value(control), "from-text")


class EnvelopeTests(unittest.TestCase):
    def test_target_pid_mismatch_fails_before_action(self):
        metadata = {"pid": 10, "window_id": 20, "executable": "test.exe", "launch_time": 1}
        with patch.object(helper, "window_metadata", return_value=metadata), patch("builtins.print") as printed:
            with self.assertRaises(SystemExit):
                helper.validate_target(None, {"pid": 11, "window_id": 20})
        self.assertEqual(json.loads(printed.call_args.args[0])["code"], "target_mismatch")

    def test_target_process_reuse_fails(self):
        initial = {"pid": 10, "window_id": 20, "executable": "test.exe", "launch_time": 1}
        with patch.object(helper, "window_metadata", return_value={**initial, "launch_time": 2}), patch("builtins.print"):
            with self.assertRaises(SystemExit):
                helper.validate_target(None, {"pid": 10, "window_id": 20}, initial)

    def test_nonobject_parameters_emit_invalid_input(self):
        import io
        with patch.object(helper.sys, "argv", ["helper"]), patch.object(helper.sys, "stdin", io.StringIO("[]")), patch("builtins.print") as printed:
            with self.assertRaises(SystemExit):
                helper.main()
        self.assertEqual(json.loads(printed.call_args.args[0])["code"], "invalid_input")

    def test_fail_emits_the_helper_contract(self):
        with patch("builtins.print") as printed:
            with self.assertRaises(SystemExit):
                helper.fail("target_unavailable", "no window")
        payload = json.loads(printed.call_args[0][0])
        self.assertEqual(payload, {
            "ok": False,
            "code": "target_unavailable",
            "message": "no window",
        })


if __name__ == "__main__":
    unittest.main()
