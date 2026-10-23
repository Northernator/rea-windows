#!/usr/bin/env python3
"""REA native UI helper for Windows - UI Automation observation and scenarios.

Mirrors the contract of the macOS helper (bridge/native/ReaNativeUI.swift):

  stdin/stdout JSON, fail-closed, evidence-preserving.

Input (JSON object):
  {
    "pid": 1234,                  # expected owning process
    "window_id": 567890,          # native window handle (HWND)
    "screenshot": true,           # capture the selected window as PNG
    "accessibility": true,        # read the accessibility (UIA) tree
    "max_nodes": 500,             # node budget per capture
    "steps": [ ... ],             # optional declarative actions
    "native_ui_deadline_ms": 180000
  }

Output (single JSON object on stdout):
  {"ok": true,  "result": <nativeUiSnapshotSchema | nativeUiResultSchema>}
  {"ok": false, "code": "...", "message": "..."}

Steps use integer node paths from the snapshot (depth-first sibling indices).
Supported step kinds: click, key-entry, scroll, wait.

Requires: pip install uiautomation pillow
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import struct
import sys
import time

try:
    import uiautomation as auto
except ImportError:
    print(
        json.dumps(
            {
                "ok": False,
                "code": "dependency_missing",
                "message": "uiautomation is not installed; run: pip install uiautomation pillow",
            }
        )
    )
    sys.exit(3)

MAX_WAIT_MS = 180_000
DEFAULT_DEADLINE_MS = 180_000


def fail(code: str, message: str) -> None:
    print(json.dumps({"ok": False, "code": code, "message": message}))
    sys.exit(0)


# --- node model ------------------------------------------------------------

PATTERN_ACTIONS = [
    ("Invoke", "invoke"),
    ("ExpandCollapse", "expandcollapse"),
    ("SelectionItem", "selectionitem"),
    ("Toggle", "toggle"),
    ("Value", "value"),
    ("Scroll", "scroll"),
    ("Text", "text"),
]


def control_actions(control) -> list[str]:
    actions = []
    for pattern_name, action in PATTERN_ACTIONS:
        try:
            if getattr(control, f"Get{pattern_name}Pattern", lambda: None)():
                actions.append(action)
        except Exception:
            continue
    return actions


def control_value(control) -> str | None:
    """Best-effort current value: ValuePattern first, TextPattern as fallback.

    Some hosts (Win11 Notepad's editor) expose a ValuePattern whose
    Value is null while the text is readable through TextPattern.
    """
    try:
        pattern = control.GetValuePattern()
        if pattern:
            value = pattern.Value
            if isinstance(value, str):
                return value
    except Exception:
        pass
    try:
        text_pattern = control.GetTextPattern()
        if text_pattern:
            text = text_pattern.DocumentRange.GetText(-1)
            if isinstance(text, str):
                return text
    except Exception:
        pass
    return None


def capture_tree(window, max_nodes: int, want_accessibility: bool):
    """Depth-first walk with integer sibling paths.

    Returns (nodes, truncated, gaps).
    """
    nodes: list[dict] = []
    truncated = False
    gaps: list[str] = []
    if not want_accessibility:
        return nodes, truncated, gaps

    def walk(control, prefix: list[int], depth: int) -> None:
        nonlocal truncated
        if len(nodes) >= max_nodes:
            truncated = True
            return
        if depth > 24:
            gaps.append("depth limit 24 reached; deeper nodes omitted")
            truncated = True
            return
        index = 0
        child = control.GetFirstChildControl()
        while child:
            if len(nodes) >= max_nodes:
                truncated = True
                return
            path = prefix + [index]
            role = None
            try:
                role = child.ControlTypeName
            except Exception:
                gaps.append("control type unreadable on one node")
            nodes.append(
                {
                    "path": path,
                    "role": role,
                    "title": child.Name or None,
                    "value": control_value(child),
                    "actions": control_actions(child),
                    "children_count": child.GetChildren() and len(child.GetChildren()) or 0,
                }
            )
            walk(child, path, depth + 1)
            index += 1
            child = child.GetNextSiblingControl()

    walk(window, [], 0)
    return nodes, truncated, gaps


def window_metadata(window) -> dict:
    pid = window.ProcessId
    return {
        "pid": pid,
        "window_id": window.NativeWindowHandle,
        "executable": _executable_path(pid),
        "launch_time": _launch_time(pid),
        "title": window.Name or "",
    }


def png_screenshot(window) -> dict | None:
    """Capture the window as canonical PNG bytes with digest and dimensions."""
    import os
    import tempfile

    handle, temp_path = tempfile.mkstemp(suffix=".png")
    os.close(handle)
    try:
        try:
            window.CaptureToImage(temp_path)
        except Exception:
            return None
        with open(temp_path, "rb") as fh:
            raw = fh.read()
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
    if len(raw) < 24 or raw[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width, height = struct.unpack(">II", raw[16:24])
    return {
        "mime_type": "image/png",
        "base64": base64.b64encode(raw).decode("ascii"),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "width": width,
        "height": height,
    }


def resolve_by_path(window, path: list[int]):
    """Walk an integer sibling path back to a live control."""
    control = window
    for index in path:
        child = control.GetFirstChildControl()
        steps = 0
        while child and steps < index:
            child = child.GetNextSiblingControl()
            steps += 1
        if not child:
            return None
        control = child
    return control


def run_step(window, step: dict, deadline: float | None = None) -> tuple[str, str | None]:
    """Execute one declarative step. Returns (outcome, reason)."""
    if deadline is not None and time.monotonic() >= deadline:
        return "cancelled", "operation deadline exceeded before action"
    if not isinstance(step, dict):
        return "failed", "step must be an object"
    kind = step.get("kind")
    if kind == "wait":
        ms = step.get("milliseconds", 0)
        if type(ms) is not int or ms < 0:
            return "failed", "wait milliseconds must be a nonnegative integer"
        if ms > MAX_WAIT_MS:
            return "failed", f"wait {ms}ms exceeds the {MAX_WAIT_MS}ms cap"
        if deadline is not None and time.monotonic() + ms / 1000.0 > deadline:
            return "cancelled", "wait would exceed the operation deadline"
        time.sleep(ms / 1000.0)
        return "completed", None

    path = step.get("path")
    if not isinstance(path, list) or any(type(index) is not int or index < 0 for index in path):
        return "failed", "step path must be an array of integers"
    control = resolve_by_path(window, path)
    if control is None:
        return "failed", "node not found for path"

    try:
        if kind == "click":
            pattern = control.GetInvokePattern()
            if pattern:
                pattern.Invoke()
                return "completed", None
            selection = control.GetSelectionItemPattern()
            if selection:
                selection.Select()
                return "completed", "used selectionitem (no invoke pattern)"
            return "failed", "node has no invoke or selectionitem pattern"
        if kind == "key-entry":
            text = step.get("text", "")
            if not isinstance(text, str):
                return "failed", "key-entry text must be a string"
            pattern = control.GetValuePattern()
            wrote = False
            if pattern:
                try:
                    pattern.SetValue(text)
                    wrote = control_value(control) == text
                except Exception:
                    wrote = False
            if wrote:
                return "completed", None
            # Match SetValue's replacement semantics, preserving literal braces.
            try:
                control.SetFocus()
                auto.SendKeys("{Ctrl}a")
                literal = "".join("{{}" if char == "{" else "{}}" if char == "}" else char for char in text)
                auto.SendKeys(literal if text else "{Delete}")
                typed = control_value(control)
                if typed == text:
                    return "completed", "used SendKeys (ValuePattern did not apply)"
                return "failed", "SendKeys read-back did not confirm the exact text"
            except Exception as exc:
                return "failed", f"{type(exc).__name__}: {exc}"
        if kind == "scroll":
            direction = step.get("direction", "increment")
            pattern = control.GetScrollPattern()
            if not pattern:
                return "failed", "node has no scroll pattern"
            if direction not in ("increment", "decrement"):
                return "failed", "scroll direction must be increment or decrement"
            amount = auto.ScrollAmount.SmallIncrement if direction == "increment" else auto.ScrollAmount.SmallDecrement
            pattern.Scroll(auto.ScrollAmount.NoAmount, amount)
            return "completed", None
    except Exception as exc:  # keep evidence; never crash the envelope
        return "failed", f"{type(exc).__name__}: {exc}"
    return "failed", f"unsupported step kind: {kind}"


def snapshot(window, params: dict) -> dict:
    nodes, truncated, gaps = capture_tree(
        window, int(params.get("max_nodes", 500)), bool(params.get("accessibility", True))
    )
    shot = png_screenshot(window) if params.get("screenshot", True) else None
    if params.get("screenshot", True) and shot is None:
        gaps.append("screenshot unavailable (window may be minimized or occluded)")
    return {
        "window": window_metadata(window),
        "nodes": nodes,
        "truncated": truncated,
        "screenshot": shot,
        "gaps": gaps,
    }


def validate_target(window, params: dict, initial: dict | None = None) -> dict:
    """Bind HWND to the caller's process and binary before any UI action."""
    metadata = window_metadata(window)
    if metadata["window_id"] != params["window_id"] or metadata["pid"] <= 0:
        fail("target_unavailable", "window handle is no longer valid")
    if not metadata["executable"] or metadata["launch_time"] <= 0:
        fail("target_unavailable", "cannot establish the window process identity")
    if params.get("pid") is not None and metadata["pid"] != params["pid"]:
        fail("target_mismatch", "window does not belong to the requested pid")
    expected = params.get("executable")
    if expected is not None and os.path.normcase(os.path.realpath(metadata["executable"])) != os.path.normcase(os.path.realpath(expected)):
        fail("target_mismatch", "window executable does not match the requested target")
    if initial is not None and any(metadata[key] != initial[key] for key in ("pid", "window_id", "executable", "launch_time")):
        fail("target_mismatch", "window process identity changed during capture")
    return metadata


def main() -> None:
    # Parameters arrive as a JSON file path (argv[1]) or on stdin.
    if len(sys.argv) > 1:
        try:
            with open(sys.argv[1], "r", encoding="utf-8") as fh:
                params = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            fail("invalid_input", f"cannot read parameters file: {exc}")
    else:
        try:
            params = json.load(sys.stdin)
        except json.JSONDecodeError as exc:
            fail("invalid_input", f"parameters are not valid JSON: {exc}")

    if not isinstance(params, dict):
        fail("invalid_input", "parameters must be an object")
    window_id = params.get("window_id")
    if type(window_id) is not int or window_id <= 0:
        fail("invalid_input", "window_id must be a positive integer native window handle")
    for key in ("pid", "max_nodes", "native_ui_deadline_ms"):
        if key in params and (type(params[key]) is not int or params[key] <= 0):
            fail("invalid_input", f"{key} must be a positive integer")
    for key in ("screenshot", "accessibility"):
        if key in params and type(params[key]) is not bool:
            fail("invalid_input", f"{key} must be a boolean")
    if not isinstance(params.get("steps", []), list) or any(not isinstance(step, dict) for step in params.get("steps", [])):
        fail("invalid_input", "steps must be an array of objects")
    if "executable" in params and not isinstance(params["executable"], str):
        fail("invalid_input", "executable must be a path string")
    deadline = time.monotonic() + (params.get("native_ui_deadline_ms", DEFAULT_DEADLINE_MS) / 1000.0)

    try:
        window = auto.ControlFromHandle(window_id)
    except Exception as exc:
        fail("target_unavailable", f"cannot resolve window handle {window_id}: {exc}")
    if window is None:
        fail("target_unavailable", f"no window for handle {window_id}")

    identity = validate_target(window, params)
    executable = identity["executable"]
    target_sha256 = ""
    if executable:
        try:
            with open(executable, "rb") as binary:
                target_sha256 = hashlib.file_digest(binary, "sha256").hexdigest() if hasattr(hashlib, "file_digest") else hashlib.sha256(binary.read()).hexdigest()
        except OSError as exc:
            fail("target_unavailable", f"cannot hash target executable: {exc}")
    if params.get("sha256") is not None and params["sha256"] != target_sha256:
        fail("target_mismatch", "window executable digest does not match the requested target")

    steps = params.get("steps") or []
    if not steps:
        if time.monotonic() > deadline:
            fail("deadline_exceeded", "deadline exceeded before observation")
        result = snapshot(window, params)
        validate_target(window, params, identity)
        if time.monotonic() >= deadline:
            fail("deadline_exceeded", "deadline exceeded during observation")
        print(json.dumps({"ok": True, "result": result}))
        return

    initial = snapshot(window, params)
    step_results = []
    for index, step in enumerate(steps):
        if time.monotonic() > deadline:
            step_results.append(
                {
                    "index": index,
                    "kind": str(step.get("kind", "unknown")),
                    "before": initial,
                    "after": None,
                    "outcome": "cancelled",
                    "reason": "operation deadline exceeded",
                }
            )
            break
        before = snapshot(window, params)
        validate_target(window, params, identity)
        outcome, reason = run_step(window, step, deadline)
        after = snapshot(window, params) if outcome == "completed" else None
        validate_target(window, params, identity)
        step_results.append(
            {
                "index": index,
                "kind": str(step.get("kind", "unknown")),
                "before": before,
                "after": after,
                "outcome": outcome,
                "reason": reason,
            }
        )
        if outcome == "cancelled":
            break
    result = {
        "target_sha256": target_sha256,
        "initial": initial,
        "steps": step_results,
        "restore": "leave-as-is",
        "limitations": [
            "Windows UIA exposes control patterns, not AX roles; action names are UIA pattern ids.",
            "Explicit scenario steps mutate application state and leave it as-is.",
        ],
    }
    print(json.dumps({"ok": True, "result": result}))


def _process_api():
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD))
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.GetProcessTimes.argtypes = (wintypes.HANDLE,) + (ctypes.POINTER(wintypes.FILETIME),) * 4
    kernel32.GetProcessTimes.restype = wintypes.BOOL
    return kernel32


def _executable_path(pid: int) -> str:
    try:
        import ctypes

        kernel32 = _process_api()
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = ctypes.c_ulong(1024)
            # QueryFullProcessImageNameW
            if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                return buf.value
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        pass
    return ""


def _launch_time(pid: int) -> float:
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = _process_api()
        handle = kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return 0
        try:
            creation = wintypes.FILETIME()
            exit_time = wintypes.FILETIME()
            kernel_time = wintypes.FILETIME()
            user_time = wintypes.FILETIME()
            if kernel32.GetProcessTimes(
                handle,
                ctypes.byref(creation),
                ctypes.byref(exit_time),
                ctypes.byref(kernel_time),
                ctypes.byref(user_time),
            ):
                return (creation.dwHighDateTime << 32) | creation.dwLowDateTime
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        fail("capture_failed", f"{type(exc).__name__}: {exc}")
