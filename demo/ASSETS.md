# Asset and claim ledger

All product screenshots and test results come from the local validation of this public REA Windows checkout against Windows Notepad, through the real REA CLI. The source artifacts are `../artifacts/notepad/{summary.json,observe.json,scenario.json,before.png,after.png}`. The imported ledger is `evidence.json`; `import-evidence.mjs` asserts a passed validation, a completed action, an exact read-back, and a matching scenario text. Screenshots are ungraded crops of captured native UI. Terminal typography is an editorial presentation of real command/output text, not a new product interface.

Verified on-screen facts: provider `native-windows`; 26 observed nodes; editor path `[0]`; `EditControl`; `key-entry` with the literal text `REA Windows: literal {Enter} + Unicode café ✓`; completed outcome; `leave-as-is` restore; 1955×1486 PNG; captured screenshot SHA-256; REA `observed` confidence. The local test ran on Windows 10 build 19045. No claim is made that this run used Windows 11.

On-screen command excerpts keep the actual operation, executable, PID, HWND, JSON flag and scenario arguments. They omit the machine-specific full path to the REA script. Full exact arrays remain in the validation summary. Source bytes are read as UTF-8.

HyperFrames registry components `code-terminal-run` and `ui-focus-zoom` were searched, installed, and reviewed as motion implementation references. The final scenes use smaller adapted motion patterns; the unused component source files were removed. HyperFrames CLI is pinned at 0.8.186 and confined to the editable demo project; the REA provider has no new runtime dependencies.

Bundled free SFX resolved through HyperFrames local-only media resolution; any supplied credits are retained beside the assets.

Music bed: `assets/audio/cipher-bed.m4a`, a local 30-second edit (source 00:12–00:42) of “Cipher” by Kevin MacLeod, downloaded from https://incompetech.com/music/royalty-free/mp3-royaltyfree/Cipher2.mp3. The creator's track page grants CC BY 4.0: https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100844. The edit uses loudness normalisation to -21 LUFS, 0.3-second opening fade, 1.3-second closing fade, and 0.75 composition gain. No model, paid API, or new dependency was used. The track was ingested through HyperFrames media-use and its credit is on the end card and in `CREDITS.md`.

No paid services, generated product UI, voiceover, or speed claims.
