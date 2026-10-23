# Demo review

Selected **The proof is in the window**, a result-first demo following one literal string through a real Windows Notepad observation, an explicit REA CLI scenario, and an exact native UI read-back. The other storylines, **Follow the evidence** and **One window, one take**, remain in `STORYLINES.md`.

The native title, menus, and editor are genuine captured UI. Terminal shots are labelled recorded excerpts, with full source arguments kept in the validation summary. No interface, result, speed claim, or operating-system claim was invented. The music is the freely licensed “Cipher” by Kevin MacLeod, edited locally with attribution; three bundled sound effects punctuate visible actions. No narration, paid service, new provider dependency, or model download was used.

## Measured checks

- HyperFrames 0.8.186 final check: `ok: true`, zero errors, warnings, and information findings across lint, runtime, layout, contrast, and craft.
- Eight timeline samples: 0, 1, 6.5, 11, 16, 21, 25.5, 28.5 seconds. Contrast: 17/17 checks passed. Craft: 240 samples at 0.125-second intervals.
- Check report: `.hyperframes/artifacts/checks/3dc8877d-8239-43e2-9b7a-71935535f3cd.json`. The optional motion subsystem reports disabled; no claim of an automated motion audit is made.
- Intentional screenshot cropping is marked on the smallest image wrapper. Deliberate reading holds are marked on the window, observation, and read-back scenes. The final check retains no warnings.
- Preview opened at `http://127.0.0.1:3017/#project/demo` and HTTP 200 verified. It remains editable in the HyperFrames desktop app.

## Visual review

Reviewed every scene's early and middle frame, the phone sheet, all cut strips, and the final per-scene contact sheet. A stranger sees: a completed Notepad window; its native UI evidence; the provider's name and bridge; one explicit CLI action; the same value read back; the native result with evidence; the repository address.

The first review found the read-back too small for the payoff. It was increased from 46 to 68 px, split into two editorial lines without changing the text, and moved inside the title-safe area. The native screenshot remains intact under a crop that removes only blank editor space. The enlarged scene was captured again and checked.

Final contact sheet: `.hyperframes/artifacts/snapshots/926d5033-6ccb-472f-b046-4c70c3251c19/contact-sheet.jpg`. Full review sheets: `.hyperframes/artifacts/snapshots/5f5df4ab-adb7-4f74-a58d-7f4cc1d5649d/review-beats.jpg`, `review-phone.jpg`, and six `review-seam-*.jpg` files. No banned visual defaults remained in the hero shot: the CLI uses a full opaque terminal ground, native screens fill most of the frame, titles hold still, and the orange field is reserved for the provider reveal.

The weakest shot is the detailed terminal scenario on a phone. It supports a pause at full resolution; the 86-pixel heading and 68-pixel result carry the story at small sizes. A longer tutorial could allocate more time to the exact JSON arguments. This delivery favours a short proof demo.

Audio is measured and visually aligned with actions; it has not been auditioned by a human. Keep `CREDITS.md` with the delivered or published film.

## Delivery verification

Delivered `REA-Windows-demo.mp4`: 2,585,158 bytes; FFprobe reports exactly 30.000000 seconds, H.264 1920×1080 at 30/1 fps with 900 frames, plus stereo AAC at 48,000 Hz. HyperFrames completed the delivery-quality render in 46.2 seconds using two workers. Decoded PNG frames at 21.5 and 28.5 seconds were inspected: the enlarged Unicode read-back and end card match the checked composition; no missing native UI or black frame appeared in those samples.

`hyperframes audio REA-Windows-demo.mp4 --json` reports a music signal with no warnings or detected silence, integrated loudness -23 LUFS, true peak -9.1 dBTP, and zero clipped samples. Signal tail ends at 29.957 seconds. Sound was measured, not heard.

The render printed no Framey handoff or download line. The editable preview remains available; no additional app promotion was inferred. One concise HyperFrames feedback report was submitted under the skill workflow.

## README GIF export

The published README uses `REA-Windows-demo.gif`, exported from the verified MP4
with FFmpeg: 960×540, 360 frames at 12 fps, exactly 30 seconds, infinite looping,
and 1,113,896 bytes. The GIF is silent. Every frame decoded successfully; samples
at 0, 1, 6.5, 11, 16, 21.5, 25.5, and 28.5 seconds were inspected. The CLI excerpts,
literal/Unicode read-back, native screenshots, and final repository URL remain
legible. The GIF is versioned for direct rendering in GitHub's README.

## Windows tooling notes

The existing Scoop FFmpeg shim failed on this host. The installed WinGet FFmpeg 8.1.2 binary worked, so its bin directory was prepended for rendering. No package was installed. `CI=1` avoids HyperFrames' detached five-minute warm-check worker holding an agent shell open after a successful check. The preview intentionally remains running for editing.
