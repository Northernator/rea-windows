# REA Windows demo

An editable 30-second HyperFrames film at 1920×1080, 30 fps. It uses the real REA CLI validation against Windows Notepad: an observed native tree, a `key-entry` scenario, and an exact literal `{Enter}` plus Unicode read-back. No voiceover. A free licensed music bed and bundled click, transition, and confirmation sounds accompany the visible actions. Keep the attribution in `CREDITS.md` with published copies.

The README preview is [REA-Windows-demo.gif](REA-Windows-demo.gif): the full 30-second demo, exported as a silent, looping 960×540 GIF at 12 fps (about 1.1 MB). The GIF is included in Git. The full 1920×1080 render with audio is `REA-Windows-demo.mp4`; that local MP4 and HyperFrames working caches remain excluded from Git.

From this directory, with Node 22+, a working FFmpeg on PATH, and HyperFrames' Chrome runtime:

```powershell
npm run check
npm run dev
npm run render -- --quality delivery --output REA-Windows-demo.mp4
```

The package scripts pin HyperFrames 0.8.186 through `npx`; the provider has no new runtime dependencies. The live preview is editable in the HyperFrames desktop app.

After rendering the MP4, export the README GIF with FFmpeg:

```powershell
ffmpeg -y -i REA-Windows-demo.mp4 -filter_complex "[0:v]fps=12,scale=960:-1:flags=lanczos,zscale=transferin=bt709:transfer=iec61966-2-1,format=gbrp,split[a][b];[a]palettegen=stats_mode=diff:max_colors=256[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" -an -loop 0 REA-Windows-demo.gif
```

To replace the evidence with a new successful run from `../artifacts/notepad/`:

```powershell
node import-evidence.mjs
node build-scenes.mjs
npm run check
```

`import-evidence.mjs` rejects a failed result or a mismatched read-back. `evidence.json` records the exact test values and their source artifacts. On-screen command excerpts omit the machine-specific path to `scripts/rea.mjs`; the validation summary retains the complete command arrays. Screenshots are preserved as captured and cropped inside the video to enlarge the title, menus, and editor.

See `STORYLINES.md`, `SPEC.md`, `ASSETS.md`, and `REVIEW.md` for the creative decisions and verification evidence.
