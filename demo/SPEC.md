# REA Windows demo specification

GOAL: A developer understands that REA Windows observes and drives a real Windows application with an evidence record for each explicit action.

OUTPUT: HyperFrames, 1920×1080, 30 fps, MP4 H.264 + AAC.

TIME: 30 seconds × 30 fps = 900 frames. No voiceover. “Cipher” by Kevin MacLeod (source metadata 150 BPM; 12 frames/beat), local 30-second excerpt plus action-synchronised bundled sound effects; no paid assets or music model installation. Music and detailed attribution in CREDITS.md.

LOOK: Ground #e9ecef, ink #151719, accent #f15a24. Native UI screenshots remain ungraded and opaque. CLI surface #171a1d with #f7f8f9 text. Display Inter 700, 82–104 px, tracking -0.04em; body Inter 500, 34–40 px; source excerpts JetBrains Mono 400, 32–36 px. Margins 120 px; main headlines stay within x=192..1728, y=108..972. One orange item per beat. No texture, vignette, grain, glow or 3D perspective. Screen occupies 1100–1700 px of the width and 550–780 px of height. Screenshot crop may bleed to show the relevant native control at a useful size.

OBJECTS: The actual tested Windows application screenshot; actual command text; source-backed JSON evidence excerpts; an orange evidence locator whose line or rectangle identifies the read-back; the repository name and verified public URL.

MOTION: Camera move power3.inOut, 18 frames. Reveal power3.out, 12–15 frames. Terminal output lines 5-frame stagger, then hold. Hard cuts on actual command/result state changes. No text motion after its read starts. Finite seek-safe paused GSAP timelines. Repeated effects limited to transition sounds; each shot has one move.

SHOTS:

- f0–119: Actual result crop establishes immediately; “A real Windows window” holds f0–89; 18-frame pull out establishes the tested native app. Soft click at f0.
- f120–269: Native UI gives way to the real observation evidence, preserving the app's name and observed value. “Observe its native UI” holds at least 90 frames. Short whoosh at f120.
- f270–389: Orange typography names “REA Windows” and establishes the provider/CLI as a native Windows bridge. Title settles by f282 and holds. Soft impact.
- f390–569: Exact command for the tested explicit action reveals, then its result. “Drive one explicit action” holds at least 105 frames. Click at execute.
- f570–719: Read-back excerpt and the matching actual app result share a single cause/effect composition; “Read back the result” holds at least 105 frames. Chime on verified value.
- f720–809: Return to the completed native application result; “Every step leaves evidence” holds 90 frames. Short whoosh.
- f810–899: REA Windows wordmark and the verified public repository address land with a horizontal wipe over 12 frames; hold 78 frames. Light click.

BANNED: Dark void with small floating panels; neon/glow/particles; gradients; glass; serif-paper aesthetic; all-centred layouts; drifting readable text; three-card feature rows; docked logos; title over a dimmed screenshot; invented UI, invented commands, invented results; unmeasured speed claims; decorative HUDs; every scene sliding up.

QA: Check initial f0, every scene midpoint, every cut ±6 frames, 360-pixel contact sheet, command readability, screenshot crop, all claims against evidence ledger, final duration and audio stream. Measure sound; do not claim it was heard.
