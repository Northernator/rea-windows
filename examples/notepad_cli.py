#!/usr/bin/env python3
"""Launch a disposable Notepad document and test it through the real REA CLI.

Requires a built REA checkout with rea-windows installed, uiautomation and Pillow.
Only this script's uniquely named document is selected; it is left open afterwards.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid


def load_helper():
    path = Path(__file__).resolve().parents[1] / "bridge" / "rea_native_ui_windows.py"
    spec = importlib.util.spec_from_file_location("rea_windows_helper", path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


def run_cli(checkout: Path, operation: str, executable: str, pid: int, hwnd: int, output: Path, steps=None):
    command = ["node", str(checkout / "scripts" / "rea.mjs"), operation, executable,
               "--pid", str(pid), "--window-id", str(hwnd), "--json"]
    if steps is not None:
        command += ["--steps", json.dumps(steps, ensure_ascii=False)]
    environment = {**os.environ, "REA_WINDOWS_PYTHON": sys.executable}
    completed = subprocess.run(command, cwd=checkout, env=environment, capture_output=True,
                               text=True, encoding="utf-8", timeout=180)
    output.write_text(completed.stdout, encoding="utf-8")
    output.with_suffix(".stderr.txt").write_text(completed.stderr, encoding="utf-8")
    if completed.returncode != 0:
        raise RuntimeError(f"REA exited {completed.returncode}; see {output} and its stderr file")
    envelope = json.loads(completed.stdout)
    if envelope.get("error") or "normalized_result" not in envelope:
        raise RuntimeError(f"REA did not return native UI evidence; see {output}")
    if envelope.get("provider", {}).get("id") != "native-windows":
        raise RuntimeError(f"unexpected provider; see {output}")
    return envelope, command


def save_screenshot(snapshot, destination: Path):
    screenshot = snapshot.get("screenshot")
    if screenshot is None:
        raise RuntimeError("Notepad screenshot unavailable")
    raw = base64.b64decode(screenshot["base64"], validate=True)
    if hashlib.sha256(raw).hexdigest() != screenshot["sha256"]:
        raise RuntimeError("Screenshot digest mismatch")
    destination.write_bytes(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rea-checkout", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--text", default="REA Windows: literal {Enter} + Unicode café ✓")
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("this live test requires Windows")
    if not args.text:
        parser.error("use nonempty --text for the live test")
    checkout = args.rea_checkout.resolve()
    if not (checkout / "scripts" / "rea.mjs").is_file():
        parser.error("--rea-checkout must contain scripts/rea.mjs")
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    document = output / f"REA-Windows-{uuid.uuid4().hex[:8]}.txt"
    document.write_text("", encoding="utf-8")
    helper = load_helper()
    subprocess.Popen(["notepad.exe", str(document)])
    deadline = time.monotonic() + 30
    window = None
    while time.monotonic() < deadline:
        for candidate in helper.auto.GetRootControl().GetChildren():
            if document.stem in candidate.Name:
                window = candidate
                break
        if window is not None:
            break
        time.sleep(0.25)
    if window is None:
        raise RuntimeError("Notepad did not expose the new document window within 30s")
    window.SetActive()
    # Allow the newly selected tab to finish loading before observing its tree.
    time.sleep(0.5)
    metadata = helper.window_metadata(window)
    if not metadata["executable"] or not metadata["launch_time"]:
        raise RuntimeError("cannot resolve the selected Notepad process identity")
    observed, observe_command = run_cli(checkout, "observe-native-ui", metadata["executable"],
                                       metadata["pid"], metadata["window_id"], output / "observe.json")
    initial = observed["normalized_result"]["initial"]
    editors = [node for node in initial["nodes"] if node["role"] in ("DocumentControl", "EditControl")
               and ("value" in node["actions"] or "text" in node["actions"])]
    if len(editors) != 1:
        raise RuntimeError(f"expected one Notepad editor, observed {len(editors)}; inspect observe.json")
    save_screenshot(initial, output / "before.png")
    steps = [{"kind": "key-entry", "path": editors[0]["path"], "text": args.text}]
    scenario, scenario_command = run_cli(checkout, "capture-native-ui-scenario", metadata["executable"],
                                        metadata["pid"], metadata["window_id"], output / "scenario.json", steps)
    result = scenario["normalized_result"]
    if len(result["steps"]) != 1 or result["steps"][0]["outcome"] != "completed":
        raise RuntimeError("key-entry failed; inspect scenario.json")
    after = result["steps"][0]["after"]
    values = [node["value"] for node in after["nodes"] if node["path"] == editors[0]["path"]]
    if values != [args.text]:
        raise RuntimeError(f"exact editor read-back mismatch: {values!r}")
    save_screenshot(after, output / "after.png")
    summary = {"status": "passed", "application": "Notepad", "provider": observed.get("provider"),
               "window": metadata, "node_count": len(initial["nodes"]), "editor_path": editors[0]["path"],
               "text": args.text, "read_back": values[0], "outcome": result["steps"][0]["outcome"],
               "reason": result["steps"][0]["reason"], "target_sha256": result["target_sha256"],
               "screenshot": {key: value for key, value in after["screenshot"].items() if key != "base64"},
               "commands": [observe_command, scenario_command], "document": str(document)}
    (output / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    # Escaped JSON also works when Windows redirects stdout using a legacy code page.
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f"notepad-cli: {exc}", file=sys.stderr)
        sys.exit(1)
