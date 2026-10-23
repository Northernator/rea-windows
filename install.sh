#!/usr/bin/env bash
# Install the Windows native UI provider into a REA source checkout.
# Validate the complete plan first, preserve originals, and allow safe reruns.
# Does not install dependencies or build; run npm ci && npm run compile next.
set -euo pipefail

REA_DIR="${1:-}"
if [[ -z "$REA_DIR" ]]; then
  echo "usage: $0 /path/to/rea-checkout" >&2
  exit 1
fi
if [[ ! -d "$REA_DIR/src/native" ]]; then
  echo "error: $REA_DIR does not look like a REA checkout (no src/native)" >&2
  exit 1
fi
REA_DIR="$(cd "$REA_DIR" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${REA_WINDOWS_PYTHON:-python}"
PYTHON="${PYTHON//\\//}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "error: Python is required by this installer; set REA_WINDOWS_PYTHON or add python to PATH" >&2
  exit 1
fi

"$PYTHON" - "$REA_DIR" "$HERE" <<'PY'
import json
from pathlib import Path
import re
import sys

root, source = map(Path, sys.argv[1:])
plan = {}


def read(relative):
    path = root / relative
    if not path.is_file():
        raise ValueError(f"unsupported REA checkout (missing {relative})")
    return path.read_text(encoding="utf-8")


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise ValueError(f"unsupported REA layout: {label} was not found exactly once")
    return text.replace(old, new, 1)


def text_plan(relative, text):
    path = root / relative
    plan[relative] = path.read_bytes() if path.read_text(encoding="utf-8") == text else text.encode("utf-8")


try:
    if not (root / "bridge/native").is_dir():
        raise ValueError("unsupported REA checkout (missing bridge/native)")
    for name in ("rea_native_ui_windows.py", "test_rea_native_ui_windows.py"):
        plan[f"bridge/native/{name}"] = (source / "bridge" / name).read_bytes()
    for path in (source / "src/native").glob("*.ts"):
        plan[f"src/native/{path.name}"] = path.read_bytes()

    package = json.loads(read("package.json"))
    if not isinstance(package, dict):
        raise ValueError("package.json must contain an object")
    files = package.get("files")
    if not isinstance(files, list):
        raise ValueError("package.json files must be an array")
    anchor = "bridge/native/rea_lldb_tracer.py"
    missing = [name for name in ("bridge/native/test_rea_native_ui_windows.py",
                               "bridge/native/rea_native_ui_windows.py") if name not in files]
    if missing:
        if anchor not in files:
            raise ValueError(f"unsupported package.json files layout: missing {anchor}")
        for name in missing:
            files.insert(files.index(anchor) + 1, name)
        text_plan("package.json", json.dumps(package, indent=2) + "\n")

    relative = "src/composition/auxiliaryAnalysisProviders.ts"
    composition = read(relative)
    import_block = '''import {
  NATIVE_WINDOWS_PROVIDER_IDENTITY,
  nativeWindowsCapabilities,
} from "../native/NativeWindowsProviderMetadata.js";
'''
    if 'from "../native/NativeWindowsProviderMetadata.js"' not in composition:
        anchor = '''import {
  NATIVE_MACOS_PROVIDER_IDENTITY,
  nativeMacOSCapabilities,
} from "../native/NativeMacOSProviderMetadata.js";
'''
        composition = replace_once(composition, anchor, anchor + import_block, "macOS provider import")
    imported = re.search(r'import\s*\{([^}]+)\}\s*from "../native/NativeWindowsProviderMetadata.js";', composition)
    if imported is None or not {"NATIVE_WINDOWS_PROVIDER_IDENTITY", "nativeWindowsCapabilities"}.issubset(set(re.findall(r"\w+", imported.group(1)))):
        raise ValueError("incomplete Windows provider metadata import")
    identity = "identity: NATIVE_WINDOWS_PROVIDER_IDENTITY"
    if identity not in composition:
        declaration = '''    {
      identity: NATIVE_WINDOWS_PROVIDER_IDENTITY,
      capabilities: nativeWindowsCapabilities(platform),
      load: async () => {
        const { NativeWindowsProvider } =
          await import("../native/NativeWindowsProvider.js");
        return new NativeWindowsProvider(environment);
      },
    },
'''
        anchor = '''    {
      identity: MANAGED_STATIC_PROVIDER,'''
        composition = replace_once(composition, anchor, declaration + anchor, "managed static provider")
    elif composition.count(identity) != 1 or 'await import("../native/NativeWindowsProvider.js")' not in composition or 'capabilities: nativeWindowsCapabilities(platform)' not in composition:
        raise ValueError("incomplete or duplicate Windows provider registration; restore the original composition file")
    composition = composition.replace("Wire the three existing auxiliary AnalysisProvider implementations lazily.",
                                      "Wire the auxiliary AnalysisProvider implementations lazily.")
    text_plan(relative, composition)

    relative = "src/native/NativeMacOSProviderMetadata.ts"
    metadata = read(relative)
    ownership = re.compile(r'contract\.name\s*!==\s*"observe_native_ui"\s*&&\s*contract\.name\s*!==\s*"capture_native_ui_scenario"')
    if ownership.search(metadata) is None:
        # Upgrade older addon guards while retaining unrelated macOS coverage.
        metadata = re.sub(r'  // Declare nothing off macOS:[^\n]*\n(?:  //[^\n]*\n)*', '', metadata)
        metadata = metadata.replace('  if (platform !== "darwin") return Object.freeze([]);\n', '')
        if '  const available = platform === "darwin";' not in metadata:
            metadata = replace_once(metadata, '): readonly CapabilityDescriptor[] => {\n',
                '): readonly CapabilityDescriptor[] => {\n  const available = platform === "darwin";\n', "macOS capabilities function")
            metadata = metadata.replace('const availability = { available: true, reason: null } as const;',
                '''const availability = available
        ? ({ available: true, reason: null } as const)
        : ({ available: false, availabilityCode: "unsupported_host",
             reason: "Native macOS utilities require macOS." } as const);''')
        old = '    ].map((contract): CapabilityDescriptor => {'
        new = '''    ]
      .filter(
        (contract) =>
          platform !== "win32" ||
          (contract.name !== "observe_native_ui" &&
            contract.name !== "capture_native_ui_scenario"),
      )
      .map((contract): CapabilityDescriptor => {'''
        if metadata.count(old) != 1:
            raise ValueError("unsupported REA layout: macOS capability contracts was not found exactly once")
        before, after = metadata.split(old, 1)
        lines = after.splitlines(keepends=True)
        end = next((i for i, line in enumerate(lines) if line.rstrip("\r\n") == "    }),"), None)
        if end is None:
            raise ValueError("unsupported REA layout: macOS capability map terminator was not found")
        metadata = before + new + ''.join('  ' + line if line.strip() else line for line in lines[:end + 1]) + ''.join(lines[end + 1:])
    text_plan(relative, metadata)

    # This optional historical fix is needed only by older REA revisions.
    relative = "src/application/ReconstructionObligationCandidates.ts"
    candidates = read(relative)
    if "uniqueBy(" in candidates and not re.search(r"^(?:const|function) uniqueBy", candidates, re.M):
        anchor = "export const deriveReconstructionObligationCandidates = ("
        helper = '''const uniqueBy = <T>(items: readonly T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

'''
        text_plan(relative, replace_once(candidates, anchor, helper + anchor, "historical uniqueBy repair"))
except (OSError, ValueError, json.JSONDecodeError) as error:
    raise SystemExit(f"error: {error}")

# Every layout-dependent transformation above has succeeded before any writes.
changed = 0
for relative, content in plan.items():
    destination = root / relative
    previous = destination.read_bytes() if destination.exists() else None
    if previous == content:
        continue
    backup = root / ".rea-windows-backup" / relative
    if previous is not None and not backup.exists():
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_bytes(previous)
    destination.write_bytes(content)
    changed += 1
print(f"installed Windows provider: {changed} files updated")
print(f"originals retained under {root / '.rea-windows-backup'}")
PY

echo "next: cd $REA_DIR && npm ci && npm run compile"
