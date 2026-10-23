# Windows validation — 23 October 2026

This review started from `Northernator/rea-windows` commit
`45d55c76f9d7b06b3921ce823b387e27076dcc82`. Integration uses a separate
`morluto/rea` checkout at
`b7f8bbb49fbb675c392e346c9c0c1b56670ab680`. These results apply to that
combination and the local changes made during this review.

## Environment

| Component | Version |
| --- | --- |
| OS | Microsoft Windows 10 Home, 10.0.19045, 64-bit |
| Python | 3.11.9, isolated virtual environment |
| `uiautomation` | 2.0.29 |
| Pillow | 13.0.0 |
| Executed Node.js / npm | 24.14.0 / 11.9.0 |
| REA pinned toolchain | Node.js 24.18.0, npm 11.16.0 |

The executed Node.js version satisfies REA's declared engine range, but the
installed toolchain is older than its pinned versions. These results do not claim
validation with the exact pinned toolchain.

The selected application is Notepad, using a newly created disposable document.
The example leaves this document open with unsaved UI edits. It does not save or
close a user's existing document.

## Executed checks

| Check | Observed result |
| --- | --- |
| `npm ci` in the REA checkout | Passed; installed 543 packages from its lockfile. |
| `npm run compile` in the REA checkout | Passed with the installed Windows provider. |
| `npm run build:cached` | Passed: 3 tasks after restoring the matching upstream Windows native-addon artifacts described below. |
| Python helper unit tests | Passed: 29 tests. |
| Focused Windows TypeScript tests | Passed: 32 tests across provider (15), observation (13), and helper-runtime (4) files. |
| Expanded TypeScript regression suite | Passed: 44 tests across 6 files, including those 32 Windows tests; no skips. |
| Auxiliary declaration boundary test | Passed: 1 test, no skips. |
| Installer integration tests | Passed: 9 tests, including repeated byte-stable installation after metadata formatting/CRLF, preserved originals, paths with spaces, partial-registration repair, and rejected-layout validation before target writes. Final reinstall reported 0 files updated. |
| Installer syntax and registration patch | `bash -n`, whitespace checks, and a reverse dry-run of `registration.patch` against the installed REA checkout passed. |
| Windows native-addon artifact verification | Passed after restoring the exact matching published artifact; manifest version, SHA-256, and PE architecture checks succeeded. |
| HyperFrames demo check | Passed: 0 errors, 0 warnings, 0 infos; all 17 contrast checks passed. |
| README GIF export | Verified: 960 × 540, 360 frames, exactly 30 seconds, infinite loop, 1,113,896 bytes. All frames decoded; selected frames and literal/Unicode read-back were visually reviewed. |
| HyperFrames delivery render | Verified `demo/REA-Windows-demo.mp4`: 30 seconds, 1920 × 1080, 30 fps, 900 H.264 frames, AAC stereo at 48 kHz, 2,585,158 bytes. Decoded frames were reviewed; audio measured −23 LUFS with no clipping. |
| Direct helper against Notepad | Observed 26 nodes, editor path `[0]`, and 1955 × 1486 PNGs; key-entry read-back exactly matched `REA Windows: literal {Enter} + Unicode café ✓`. |
| `examples/notepad_cli.py` through the real REA CLI | Passed with exit code 0: `observe-native-ui` and `capture-native-ui-scenario` both selected `provider.id = native-windows`; exact literal/Unicode text read-back and PNG digests were verified. |
| Live mismatched-PID scenario | Rejected with CLI exit code 1 and `target_mismatch`. The requested sentinel text was not entered; the original editor value remained unchanged. |

The direct-helper evidence was saved locally under
`%TEMP%\rea-windows-validation\helper-evidence`. Its after-screenshot SHA-256 is
`51d510b95715a5563380609d3b52f9869ab937a1d440938760911af05ee6d1ea`.

Reproduce the integrated check from the provider checkout after the README setup:

```powershell
& $env:REA_WINDOWS_PYTHON .\examples\notepad_cli.py --rea-checkout ..\rea --output-dir .\artifacts\notepad
```

The integrated run saved JSON envelopes, PNGs, stderr logs, and a compact summary
in `artifacts/notepad` (ignored local outputs). It observed 26 nodes, selected
editor path `[0]`, and captured 1955 × 1486 screenshots. The executable digest was
`da5807bb0997cc6b5132950ec87eda2b33b1ac4533cf1f7a22a6f3b576ed7c5b`;
the after-screenshot digest was
`194cec9cdba5e41060849eed24e2529677fd2144ef533018ef1876d57153164e`.
The mismatched-PID error envelope is retained locally as
`artifacts/notepad/wrong-pid.json`.

After the final build and fixes, both live checks were repeated successfully.
The final run is retained in `artifacts/notepad-final`; its after-screenshot
SHA-256 is `d2f1c263e5cddb0aeb7d20ec10ae30b68e7b7298dd08275e6023d6605565d745`.
It again reported exact text read-back, and rejected the mismatched PID without
changing the editor.

The expanded TypeScript commands ran from the installed REA checkout:

```powershell
npm run test:local -- src/native/NativeWindowsProvider.test.ts src/native/NativeUiObservationWindows.test.ts src/native/NativeUiHelperRuntimeWindows.test.ts src/native/NativeMacOSProviderInput.test.ts src/application/binary/BinarySessionStatus.test.ts tests/composition/analysis-sessions/compositeProvider.test.ts
node node_modules/vitest/vitest.mjs run tests/boundary/providers/auxiliaryDeclarations.test.ts
```

Python checks ran from the provider checkout with the selected interpreter:

```powershell
& $env:REA_WINDOWS_PYTHON -m unittest discover -s bridge -p test_rea_native_ui_windows.py -v
& $env:REA_WINDOWS_PYTHON -m unittest discover -s tests -p test_install.py -v
```

## REA source-checkout build prerequisite

`npm run compile` and the live Python UI provider worked before an upstream
Windows native addon was present. The broader `npm run build:cached` pipeline
initially failed its artifact preflight because Git omits
`native/windows/build/manifest.json` and `rea-windows-x64.node`.

Following REA's
[documented recovery procedure](https://github.com/morluto/rea/blob/b7f8bbb49fbb675c392e346c9c0c1b56670ab680/native/windows/README.md#restore-the-artifact-in-a-source-checkout),
the exact matching `rea-agents@6.7.0` package was downloaded with
`npm pack rea-agents@6.7.0 --ignore-scripts`. Only those two artifact files were
restored. The 881,284-byte addon and its manifest passed
`node scripts/verify-windows-native-artifact.mjs` with exit code 0. No compiler or
new runtime was installed. Building that addon from source uses REA's separate
Linux/MinGW lane. Retrying `npm run build:cached` then passed all 3 tasks.

## Findings addressed

These findings came from source review and regression testing. Live reproduction
is identified where it occurred; the current application coverage is described
under scope limits below.

| Finding | Change |
| --- | --- |
| The helper read `ValuePattern.CurrentValue`, while the installed UIA library exposes `.Value`; the old unit stub concealed this API mismatch. | Read the actual library property and update the stub to match it. This was reproduced during the live Notepad test. |
| Key entry could report `completed` when read-back did not confirm the text, and SendKeys interpreted strings such as `{Enter}` as commands. | Require exact read-back, replace the selected field contents, and escape SendKeys syntax for literal text. |
| UIA Invoke, Select, Scroll, or SetFocus could return `False` without raising an exception, yet the helper treated the request as successful. | Treat rejected calls as failed steps; rejected focus never proceeds to global keyboard input. |
| Scroll used invalid/incorrect numeric amounts, potentially requesting horizontal movement. | Use the UIA enum values for vertical increment/decrement with no horizontal movement. |
| The supplied PID was ignored, process handles lacked 64-bit ctypes signatures, and unknown/reused process identity could pass through. | Validate the selected process/window identity, declare Win32 signatures, and reject mismatches or unknown identity before actions. |
| Deadline handling could start after target binding or allow an expired step to act. | Start the deadline before binding/hash work, reject expired actions, and bound waits by the remaining deadline. |
| Result `target_sha256` held an executable path or a path/window hash, and helper output was not bound to the active REA target. | Use the active executable digest and validate the returned executable, PID, HWND, launch time, and scenario evidence. |
| Provider routing claimed Windows operations off Windows, and the old macOS registration patch could fail compilation. | Declare Windows capabilities only on Windows and filter only its two UI operations from macOS declarations there. |
| Closing one target client closed the shared provider, interpreter probing ignored cancellation, and subprocesses did not consistently receive the caller's environment. | Give clients independent close/cancellation, bound probing by the operation deadline, retain the selected environment, and clean temporary parameter files on success or failure. |
| A cancellation or timeout arriving after a valid helper response could discard captured evidence. | Retain the validated report in the interruption error's `partialObservation`. |
| Repeat installation could insert duplicate registration, replaced files had no saved originals, and unsupported layouts could fail after partial edits. | Validate all source transformations before writes, repair partial registration, preserve originals once, and add a PowerShell entry point for Git Bash. |
| Unicode example output could fail on a redirected legacy Windows console encoding after writing its evidence files. | Emit ASCII-escaped JSON to stdout while preserving Unicode in the UTF-8 evidence files. |

## Remaining dependency issue

The separate upstream REA checkout's npm audit reported one high-severity
development dependency advisory in its transitive Vite 8.3.2 dependency, with a
fix available. No upstream dependency versions were changed as part of this
provider overlay.

## Documentation corrections

- Clarified that this repository is a provider overlay; REA is a separate source
  checkout with its own build and toolchain.
- Replaced Bash-only setup with a PowerShell quickstart and the Git Bash
  prerequisite. Python packages are installed with the same interpreter selected
  for the provider.
- Corrected installer working directory, repeat-install behavior, backups, and
  capability registration scope.
- Removed the claim that current REA main requires `fix-uniqueBy.patch`: the
  tested revision no longer references that helper. The conditional patch remains
  available for compatible older revisions.
- Replaced stale CLI `--format json` examples with `--json`, and added the
  reproducible Notepad CLI example instead of assuming a fixed editor path.
- Replaced "full tree" and "never mutates a target" claims with bounded UIA
  coverage, screenshot gaps, and explicit scenario side effects.
- Removed the earlier Windows 11/Store Notepad numbers from the current
  verification claim. They were not reproduced by this Windows 10 run.

## Scope limits

Unit tests use simulated UIA controls. A successful Notepad run establishes the
tested observation and ValuePattern key-entry paths for that application on this
host. The SendKeys fallback, click, and scroll have unit coverage, without live
verification in this run. It does not establish behavior for every application, elevated
windows, restricted desktops, or Windows 11 Store Notepad.

The SendKeys fallback uses the active desktop keyboard after requesting focus.
Avoid concurrent keyboard or mouse use during a scenario. Exact read-back can
detect misdelivery; it cannot undo input delivered after another application
takes focus.

UIA can omit custom controls, node paths can change, and screenshots can be
unavailable or obscured. Review `truncated`, `gaps`, step outcomes, and captured
images. Windows process launch time follows the existing numeric envelope
contract; JavaScript does not retain every low-order FILETIME tick.

The full upstream REA test suite and other deep-analysis providers were not run
as part of this local provider validation.

The demo's visual and media checks are recorded in
[its review notes](../demo/REVIEW.md). Include
[the music credits](../demo/CREDITS.md) when publishing the film.
