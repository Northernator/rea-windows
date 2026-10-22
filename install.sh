#!/usr/bin/env bash
# Install the Windows native UI provider into a REA source checkout.
#
#   ./install.sh /path/to/rea
#
# Copies the helper and provider sources into place and applies the provider
# registration. Refuses to double-apply. Does not build; run npm install &&
# npm run compile in the checkout afterwards.

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

MARKER="native-windows"

# --- 1. helper + provider sources -----------------------------------------
cp "$HERE/bridge/rea_native_ui_windows.py" "$REA_DIR/bridge/native/"
cp "$HERE/bridge/test_rea_native_ui_windows.py" "$REA_DIR/bridge/native/"
for f in NativeWindowsProvider.ts NativeWindowsProvider.test.ts \
         NativeWindowsProviderMetadata.ts NativeUiObservationWindows.ts \
         NativeUiObservationWindows.test.ts NativeUiHelperRuntimeWindows.ts; do
  cp "$HERE/src/native/$f" "$REA_DIR/src/native/"
done
echo "copied helper + provider sources"

# --- 1b. REA main is missing uniqueBy (TS2304); restore it ----------------
if ! grep -q "^const uniqueBy" "$REA_DIR/src/application/ReconstructionObligationCandidates.ts"; then
  if (cd "$REA_DIR" && git apply --check "$HERE/fix-uniqueBy.patch" 2>/dev/null); then
    (cd "$REA_DIR" && git apply "$HERE/fix-uniqueBy.patch")
    echo "applied fix-uniqueBy.patch (main does not compile without it)"
  else
    echo "WARNING: REA main is missing the uniqueBy helper; apply fix-uniqueBy.patch"
    echo "         manually or npm run compile will fail with TS2304."
  fi
fi

# --- 2. package.json: ship the helper in the npm tarball -------------------
if ! grep -q "rea_native_ui_windows.py" "$REA_DIR/package.json"; then
  python - "$REA_DIR/package.json" <<'PY'
import json, sys
from pathlib import Path

p = Path(sys.argv[1])
pkg = json.loads(p.read_text(encoding="utf-8"))
files = pkg["files"]
anchor = "bridge/native/rea_lldb_tracer.py"
for entry in ("bridge/native/test_rea_native_ui_windows.py",
              "bridge/native/rea_native_ui_windows.py"):
    if entry not in files:
        files.insert(files.index(anchor) + 1, entry)
p.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
print("package.json files updated")
PY
fi

# --- 3. register the provider ----------------------------------------------
COMP="$REA_DIR/src/composition/auxiliaryAnalysisProviders.ts"
if grep -q "$MARKER" "$COMP"; then
  echo "already registered in auxiliaryAnalysisProviders.ts - skipping"
else
  python - "$COMP" <<'PY'
import sys
from pathlib import Path

p = Path(sys.argv[1])
src = p.read_text(encoding="utf-8")

import_block = '''import {
  NATIVE_WINDOWS_PROVIDER_IDENTITY,
  nativeWindowsCapabilities,
} from "../native/NativeWindowsProviderMetadata.js";
'''
anchor = 'import {\n  NATIVE_MACOS_PROVIDER_IDENTITY,\n  nativeMacOSCapabilities,\n} from "../native/NativeMacOSProviderMetadata.js";\n'
if anchor not in src:
    raise SystemExit("error: macOS provider import block not found - REA layout changed?")
src = src.replace(anchor, anchor + import_block, 1)

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
managed = '''    {
      identity: MANAGED_STATIC_PROVIDER,'''
if managed not in src:
    raise SystemExit("error: managed static provider block not found - REA layout changed?")
src = src.replace(managed, declaration + managed, 1)
p.write_text(src, encoding="utf-8")
print("provider registered")
PY
fi

# --- 4. the disjointness requirement ---------------------------------------
META="$REA_DIR/src/native/NativeMacOSProviderMetadata.ts"
if grep -q 'if (platform !== "darwin") return Object.freeze(\[\]);' "$META"; then
  echo "macOS capability guard already present"
else
  python - "$META" <<'PY'
import sys
from pathlib import Path

p = Path(sys.argv[1])
src = p.read_text(encoding="utf-8")
old = """): readonly CapabilityDescriptor[] => {
  const available = platform === "darwin";
  return Object.freeze("""
new = """): readonly CapabilityDescriptor[] => {
  // Declare nothing off macOS: auxiliary providers must declare disjoint
  // operations, so a provider that cannot run on a host must not claim its
  // operations (the Windows UI provider owns them there).
  if (platform !== "darwin") return Object.freeze([]);
  return Object.freeze("""
if old not in src:
    raise SystemExit(
        "error: could not find the nativeMacOSCapabilities prologue - REA layout changed?"
    )
src = src.replace(old, new, 1)
p.write_text(src, encoding="utf-8")
print("macOS capability guard applied")
PY
fi

echo
echo "done. next: cd $REA_DIR && npm install && npm run compile"
