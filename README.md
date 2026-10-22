# rea-windows

![REA Windows: reading a window through UI Automation](docs/uia-hero.jpg)

**Windows native UI provider for [REA](https://github.com/morluto/rea)** — observes and drives already-running Windows application windows through UI Automation, emitting REA's existing evidence envelopes.

REA's native UI leg (`observe-native-ui`, `capture-native-ui-scenario`) is macOS-only, and its process capture is blocked on native Windows. Windows GUI apps therefore had no observation surface at all. This repo supplies one.

```
app window ──► UIA tree ──► nativeUiSnapshot envelope ──► REA evidence
                 (Python        (integer node paths,
                  helper)        pattern actions, PNG+sha256)
```

## What it does

- **Observe** a window: full accessibility tree with integer node paths, UIA pattern ids as available actions, node values, a PNG screenshot with sha256 digest, and window metadata resolved from the process (executable path, FILETIME launch time).
- **Drive** a window with declarative steps — `click`, `key-entry`, `scroll`, `wait` — each recording before/after snapshots so every action carries evidence.
- **Fail closed**: no Python interpreter with the dependencies importable means the operation fails with the probe reason. Nothing is ever claimed that wasn't observed.

## Install into a REA source checkout

```bash
# from a clone of github.com/morluto/rea
./install.sh /path/to/rea
```

The script copies the helper and provider sources into place and applies the three-line registration in `src/composition/auxiliaryAnalysisProviders.ts`. It refuses to double-apply.

Then, as usual:

```bash
npm install && npm run compile
```

## Requirements

- Windows
- Python 3.10+ with `uiautomation` and `Pillow`:
  ```bash
  pip install uiautomation pillow
  ```
- The interpreter is located via `REA_WINDOWS_PYTHON`, then `HARNESS_FORGE_PYTHON`, then `PYTHON`, then `python`/`python3`/`py` on PATH.

## Use

```bash
# find the window handle (HWND) of the target
export REA_WINDOWS_PYTHON=/path/to/python

node scripts/rea.mjs observe-native-ui "C:/Windows/System32/notepad.exe" \
    --pid 1234 --window-id 567890 --format json

node scripts/rea.mjs capture-native-ui-scenario "C:/Windows/System32/notepad.exe" \
    --pid 1234 --window-id 567890 \
    --steps '[{"kind":"key-entry","path":[0,0],"text":"hello"}]' --format json
```

Node paths come from a prior observation; `click` invokes the node (falling back to
`SelectionItem.Select` for tabs and list items), `key-entry` sets a Value pattern and
verifies the write through a read-back (falling back to focus + `SendKeys` for hosts
whose Value pattern ignores writes — Win11 Notepad's editor is one).

## Verified

Windows 11, Notepad (Store build 11.2607.14.0), through the real REA CLI:

| Check | Result |
| --- | --- |
| `observe-native-ui` | full evidence envelope, `provider.id = native-windows`, 51 nodes, 1920×1080 PNG with sha256, executable + launch time resolved |
| `capture-native-ui-scenario` (key-entry) | step `completed`, editor read-back returns the exact text |
| capability gate | with no importable Python, the operation fails with the probe reason — never claims support |
| off-Windows | declares nothing (`nativeWindowsCapabilities("linux")` is empty) |

## Tests

```bash
# Python helper (no UI needed — the uiautomation module is stubbed)
python -m unittest bridge/test_rea_native_ui_windows.py -v     # 16 tests

# TypeScript (vitest, from a REA checkout after install.sh)
npx vitest run src/native/NativeWindowsProvider.test.ts src/native/NativeUiObservationWindows.test.ts
```

## REA constraints worth knowing

Discovered while building this; they shape any future provider:

1. **Auxiliary providers must declare disjoint operations.** `SessionProviderRouter`
   asserts it over *declared* capabilities regardless of availability, so
   `nativeMacOSCapabilities` now returns an empty list off darwin. A provider that
   cannot run on a host must not claim its operations there.
2. **`execFileOutput` has no stdin.** Helper parameters travel as a temp file
   (argv), which also matches how REA passes scenario JSON elsewhere.
3. **`execFileOutput` resolves `{stdout: string}`**, not a Buffer.
4. **`uniqueBy` is missing on REA main.** `src/application/ReconstructionObligationCandidates.ts`
   calls it without defining it, so `npm run compile` fails with TS2304 on a clean
   checkout. The `fix-uniqueBy.patch` file in this repo restores it (dedupe
   preserving first occurrence) — apply it before compiling a fresh clone.
5. **REA never mutates a target.** This provider follows the same contract: it runs
   only the explicit steps it is given, records `restore: "leave-as-is"`, and the
   caller owns the decision to drive.

## Layout

```
bridge/rea_native_ui_windows.py       UIA helper (the workhorse)
bridge/test_rea_native_ui_windows.py  16 unit tests, uiautomation stubbed
src/native/NativeWindowsProviderMetadata.ts   identity + capabilities
src/native/NativeUiHelperRuntimeWindows.ts    interpreter probe + invocation
src/native/NativeUiObservationWindows.ts      envelope validation + target binding
src/native/NativeWindowsProvider.ts           provider + client
install.sh                           copy + register into a REA checkout
fix-uniqueBy.patch                   restores the missing helper on REA main
```

## Status

Working and verified on Windows 11. Offered upstream to `morluto/rea` as a
standalone contribution; the provider sources here are the source of truth.
Not yet reviewed by the REA maintainers — treat the provider contract as
provisional until then.

## License

MIT.
