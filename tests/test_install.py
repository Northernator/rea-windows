"""Installer regressions against a minimal, unmodified REA source layout."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1]
COMPOSITION = '''import {
  NATIVE_MACOS_PROVIDER_IDENTITY,
  nativeMacOSCapabilities,
} from "../native/NativeMacOSProviderMetadata.js";
export const declarations = () => [
    {
      identity: MANAGED_STATIC_PROVIDER,
    },
];
'''
MACOS = '''export const nativeMacOSCapabilities = (
  platform: NodeJS.Platform = process.platform,
): readonly CapabilityDescriptor[] => {
  const available = platform === "darwin";
  return Object.freeze(
    [
      ...NATIVE_TOOL_CONTRACTS,
      { name: "inspect_native_dispatch_metadata" as const },
    ].map((contract): CapabilityDescriptor => {
      const availability = available
        ? ({ available: true, reason: null } as const)
        : ({ available: false, reason: "requires macOS" } as const);
      return { operation: contract.name, ...availability };
    }),
  );
};
'''


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="rea-installer-test-")
        self.addCleanup(self.temporary.cleanup)
        self.target = Path(self.temporary.name) / "REA checkout with spaces"
        for relative in ("bridge/native", "src/native", "src/composition", "src/application"):
            (self.target / relative).mkdir(parents=True, exist_ok=True)
        self.write("package.json", json.dumps({"files": ["bridge/native/rea_lldb_tracer.py"]}))
        self.write("src/composition/auxiliaryAnalysisProviders.ts", COMPOSITION)
        self.write("src/native/NativeMacOSProviderMetadata.ts", MACOS)
        self.write("src/application/ReconstructionObligationCandidates.ts", "export const unrelated = true;\n")
        self.environment = {**os.environ, "REA_WINDOWS_PYTHON": Path(sys.executable).as_posix()}
        git = shutil.which("git")
        candidate = Path(git).parents[1] / "bin/bash.exe" if git else Path("missing")
        self.bash = str(candidate) if candidate.is_file() else shutil.which("bash")
        if not self.bash:
            self.skipTest("Bash is required for installer integration tests")

    def write(self, relative, content):
        (self.target / relative).write_text(content, encoding="utf-8")

    def run_installer(self, native=False):
        if native:
            powershell = shutil.which("powershell.exe")
            if not powershell:
                self.skipTest("Native launcher requires Windows PowerShell")
            command = [powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                       str(SOURCE / "install.ps1"), str(self.target)]
        else:
            command = [self.bash, (SOURCE / "install.sh").as_posix(), self.target.as_posix()]
        return subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                              env=self.environment, timeout=30)

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("uniqueBy", result.stdout)

    def test_reinstallation_is_byte_stable_and_preserves_originals(self):
        original_package = (self.target / "package.json").read_bytes()
        self.assert_success(self.run_installer())
        before = {p.relative_to(self.target): p.read_bytes()
                  for p in self.target.rglob("*") if p.is_file()}
        self.assert_success(self.run_installer())
        after = {p.relative_to(self.target): p.read_bytes()
                 for p in self.target.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        composition = (self.target / "src/composition/auxiliaryAnalysisProviders.ts").read_text()
        self.assertEqual(composition.count("identity: NATIVE_WINDOWS_PROVIDER_IDENTITY"), 1)
        files = json.loads((self.target / "package.json").read_text())["files"]
        self.assertEqual(files.count("bridge/native/rea_native_ui_windows.py"), 1)
        self.assertEqual((self.target / ".rea-windows-backup/package.json").read_bytes(), original_package)
        self.assertEqual((self.target / "src/native/NativeWindowsProvider.ts").read_bytes(),
                         (SOURCE / "src/native/NativeWindowsProvider.ts").read_bytes())

    def test_preserves_unrelated_macos_capabilities_and_the_availability_binding(self):
        self.assert_success(self.run_installer())
        source = (self.target / "src/native/NativeMacOSProviderMetadata.ts").read_text()
        self.assertIn('const available = platform === "darwin";', source)
        self.assertIn('platform !== "win32"', source)
        self.assertIn('contract.name !== "observe_native_ui"', source)
        self.assertIn('contract.name !== "capture_native_ui_scenario"', source)
        self.assertIn('inspect_native_dispatch_metadata', source)
        self.assertNotIn('if (platform !== "darwin") return', source)

    def test_upgrades_the_earlier_blanket_macos_guard(self):
        self.write("src/native/NativeMacOSProviderMetadata.ts", MACOS.replace(
            '  const available = platform === "darwin";',
            '  // Declare nothing off macOS: old addon guard.\n'
            '  // Windows owns these operations.\n'
            '  if (platform !== "darwin") return Object.freeze([]);\n'
            '  const available = platform === "darwin";'))
        self.assert_success(self.run_installer())
        source = (self.target / "src/native/NativeMacOSProviderMetadata.ts").read_text()
        self.assertNotIn("Declare nothing", source)
        self.assertNotIn('if (platform !== "darwin") return', source)
        self.assertIn('platform !== "win32"', source)

    def test_native_powershell_launcher_accepts_paths_with_spaces(self):
        self.assert_success(self.run_installer(native=True))
        self.assertTrue((self.target / "bridge/native/rea_native_ui_windows.py").is_file())

    def test_invalid_layout_is_rejected_before_any_target_changes(self):
        for relative, invalid in (
            ("package.json", json.dumps({"files": []})),
            ("src/composition/auxiliaryAnalysisProviders.ts", COMPOSITION.replace("MANAGED_STATIC_PROVIDER", "UNKNOWN")),
            ("src/native/NativeMacOSProviderMetadata.ts", MACOS.replace("].map", "].flatMap")),
        ):
            with self.subTest(relative=relative):
                original = (self.target / relative).read_bytes()
                self.write(relative, invalid)
                before = {p.relative_to(self.target): p.read_bytes()
                          for p in self.target.rglob("*") if p.is_file()}
                result = self.run_installer()
                self.assertNotEqual(result.returncode, 0)
                after = {p.relative_to(self.target): p.read_bytes()
                         for p in self.target.rglob("*") if p.is_file()}
                self.assertEqual(before, after)
                (self.target / relative).write_bytes(original)

    def test_repairs_a_missing_import_without_duplicating_registration(self):
        self.assert_success(self.run_installer())
        relative = "src/composition/auxiliaryAnalysisProviders.ts"
        source = (self.target / relative).read_text()
        source = source.replace('import {\n  NATIVE_WINDOWS_PROVIDER_IDENTITY,\n  nativeWindowsCapabilities,\n} from "../native/NativeWindowsProviderMetadata.js";\n', '')
        self.write(relative, source)
        self.assert_success(self.run_installer())
        source = (self.target / relative).read_text()
        self.assertEqual(source.count("identity: NATIVE_WINDOWS_PROVIDER_IDENTITY"), 1)
        self.assertEqual(source.count('from "../native/NativeWindowsProviderMetadata.js"'), 1)

    def test_an_unrelated_win32_condition_does_not_skip_ownership_patch(self):
        self.write("src/native/NativeMacOSProviderMetadata.ts", MACOS + '\nconst unrelated = platform !== "win32";\n')
        self.assert_success(self.run_installer())
        source = (self.target / "src/native/NativeMacOSProviderMetadata.ts").read_text()
        self.assertIn('contract.name !== "observe_native_ui"', source)

    def test_incomplete_metadata_import_is_rejected_without_changes(self):
        self.assert_success(self.run_installer())
        relative = "src/composition/auxiliaryAnalysisProviders.ts"
        source = (self.target / relative).read_text().replace("  nativeWindowsCapabilities,\n", "")
        self.write(relative, source)
        before = {p.relative_to(self.target): p.read_bytes()
                  for p in self.target.rglob("*") if p.is_file()}
        self.assertNotEqual(self.run_installer().returncode, 0)
        after = {p.relative_to(self.target): p.read_bytes()
                 for p in self.target.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_metadata_whitespace_does_not_break_reinstallation(self):
        self.assert_success(self.run_installer())
        relative = "src/native/NativeMacOSProviderMetadata.ts"
        source = (self.target / relative).read_text()
        source = source.replace('contract.name !== "observe_native_ui" &&',
                                'contract.name !==\n              "observe_native_ui" &&')
        self.write(relative, source)
        before = (self.target / relative).read_bytes()
        self.assert_success(self.run_installer())
        self.assertEqual((self.target / relative).read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
