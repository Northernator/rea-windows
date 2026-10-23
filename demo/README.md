# REA Windows demo

An editable 30-second HyperFrames film at 1920×1080, 30 fps. It uses the real REA CLI validation against Windows Notepad: an observed native tree, a `key-entry` scenario, and an exact literal `{Enter}` plus Unicode read-back. No voiceover. A free licensed music bed and bundled click, transition, and confirmation sounds accompany the visible actions. Keep the attribution in `CREDITS.md` with published copies.

The rendered delivery is `REA-Windows-demo.mp4`. The MP4 and HyperFrames working caches are intentionally excluded from Git; the small editable source and evidence assets can be versioned.

From this directory, with Node 22+, a working FFmpeg on PATH, and HyperFrames' Chrome runtime:

```powershell
npm run check
npm run dev
npm run render -- --quality delivery --output REA-Windows-demo.mp4
```

The package scripts pin HyperFrames 0.8.186 through `npx`; the provider has no new runtime dependencies. The live preview is editable in the HyperFrames desktop app.

To replace the evidence with a new successful run from `../artifacts/notepad/`:

```powershell
node import-evidence.mjs
node build-scenes.mjs
npm run check
```

`import-evidence.mjs` rejects a failed result or a mismatched read-back. `evidence.json` records the exact test values and their source artifacts. On-screen command excerpts omit the machine-specific path to `scripts/rea.mjs`; the validation summary retains the complete command arrays. Screenshots are preserved as captured and cropped inside the video to enlarge the title, menus, and editor.

See `STORYLINES.md`, `SPEC.md`, `ASSETS.md`, and `REVIEW.md` for the creative decisions and verification evidence.
