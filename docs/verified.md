# Verified vs assumed

Each entry: status, date, how. **Verified** means tested against the real thing. **From source**
means read in SDK/library code but not run on the hardware or sim. **Assumed** means neither.

## Section 7 questions

| # | Question | Status | Finding |
|---|---|---|---|
| 1 | Which keys are LCD, grid, key resolution | Verified (2026-10-27) | 15 LCD keys in 5 columns x 3 rows, row 0 at the bottom. 3 plain buttons below, reported as column 5. Images scale to the key without cropping. Native LCD resolution still unknown (not needed so far). Details and slot map in `hardware.md`. |
| 2 | SDK calls: setImage, setTitle, setState, profile/page switching | Partly verified (2026-10-27) | setImage (PNG/JPG/GIF base64, SVG), setTitle, setState documented. `switchToProfile` not documented, so the plugin redraws keys itself for pages. Key icon size per docs: 128x128. On the M18: SVG and base64 PNG setImage both display correctly. setTitle and the SVG readout ran without errors; whether they looked right is awaiting the user. |
| 3 | Does Stream Dock load Elgato plugins | Open | Protocol is Elgato-compatible (Qt SDK even names `connectElgatoStreamDeckSocket`), which makes it likely for simple JS plugins. Not tested. Not required. |
| 4 | SimConnect library for MSFS 2024 | From source (2026-10-25) | `node-simconnect` 4.2.1 (2026-10-03): pure TypeScript over TCP, no native DLL, README lists MSFS 2024 and a `SunRise` (2024) protocol, includes input event APIs (useful for Phase 5). **Conflict:** 4.2.x declares Node >= 20.17; Stream Dock bundles 20.8.1. 4.1.0 declares Node >= 18. See open decision below. |
| 5 | C172 variables and events | Open | Phase 1. |
| 6 | Detecting aircraft change | Open | Phase 1. |

## Log

- 2026-10-25, from source: plugin registration and event names, read from the SDK templates.
- 2026-10-27, hardware: Phase 0 diagnostic on the user's M18 under VSD Craft 3.10.188.226.
  Plugin loads on the built-in Node, all 18 keys and buttons register and send presses,
  PNG test card shows all four edges and square quadrants. See `hardware.md`.
- 2026-10-27, icon library: 1,803 PNGs, all 512x512, 394 bases, all match the naming scheme
  (`icon-index.md`).
- 2026-10-27, docs: sdk.key123.vip reachable; SDK notes checked against it, corrections in `sdk-notes.md`.
- 2026-10-27, from screenshot: icon library naming `<base>[_<state>]_<theme>.png`, see `icons.md`.
- 2026-10-25, verified in fake host only: our plugin registers, maps `willAppear` coordinates to a
  slot, sends SVG and base64 PNG `setImage` messages (`npm run test:host`). Proves our side
  of the protocol, nothing about the device.

## Open decisions

- **Node version for the sim link.** Options: (a) pin `node-simconnect@4.1.0` (declares Node 18+);
  (b) try 4.2.1 on 20.8.1 anyway (the engines field is advisory; may just work);
  (c) point `CodePathWin` at a separately installed newer Node. Recommendation: test (b) in
  Phase 1 and fall back to (a).
