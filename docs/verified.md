# Verified vs assumed

Each entry: status, date, how. **Verified** means tested against the real thing. **From source**
means read in SDK/library code but not run on the hardware or sim. **Assumed** means neither.

## Section 7 questions

| # | Question | Status | Finding |
|---|---|---|---|
| 1 | Which keys are LCD, grid, key resolution | Verified (2026-10-27) | 15 LCD keys in 5 columns x 3 rows, row 0 at the bottom. 3 plain buttons below, reported as column 5. Images scale to the key without cropping. Native LCD resolution still unknown (not needed so far). Details and slot map in `hardware.md`. |
| 2 | SDK calls: setImage, setTitle, setState, profile/page switching | Partly verified (2026-10-27) | setImage (PNG/JPG/GIF base64, SVG), setTitle, setState documented. `switchToProfile` not documented, so the plugin redraws keys itself for pages. Key icon size per docs: 128x128. On the M18: SVG and base64 PNG setImage both display correctly. setTitle and the SVG readout also display as intended (user report). |
| 3 | Does Stream Dock load Elgato plugins | Open | Protocol is Elgato-compatible (Qt SDK even names `connectElgatoStreamDeckSocket`), which makes it likely for simple JS plugins. Not tested. Not required. |
| 4 | SimConnect library for MSFS 2024 | Verified (2026-10-27) on user's Node v24; VSD Craft's Node 20.8.1 still open | `node-simconnect` 4.2.1 (2026-10-03): pure TypeScript over TCP, no native DLL, README lists MSFS 2024 and a `SunRise` (2024) protocol, includes input event APIs (useful for Phase 5). **Conflict:** 4.2.x declares Node >= 20.17; Stream Dock bundles 20.8.1. 4.1.0 declares Node >= 18. See open decision below. |
| 5 | C172 variables and events | Verified, except avionics (2026-10-27) | All section 5 variables read and track cockpit changes; all events move their variable. **Avionics:** AVIONICS MASTER SWITCH / AVIONICS_MASTER_SET change each other but not the cockpit's two avionics bus switches (user observed). Full table in `c172-controls.md`. |
| 6 | Detecting aircraft change | Verified (2026-10-27) | See "Aircraft detection" below. |

## Aircraft detection (MSFS 2024, 2026-10-27 sim-spike run)

- Connected with protocol KittyHawk; sim reports `SunRise` 12.2 build 282174.
- TITLE is the preset name (`C172SP G1000 Passengers`); ATC MODEL is a localisation key
  (`ATCCOM.AC_MODEL C172.0.text`), so match it with a pattern like `C172`.
- The AircraftLoaded system event gives the aircraft.cfg path, which names the package
  (`asobo-aircraft-c172sp-as1000`, `bksq-aircraft-caravanpro`). The path is the only field that
  separates the Black Square Caravan from the default Caravan (both ATC MODEL C208).
- Picking an aircraft in the free flight menu already changes TITLE and ATC MODEL (the menu
  counts as a loaded aircraft), and fires AircraftLoaded. Loading into the flight fires it again
  with the same path. MSFS 2024 cannot change aircraft mid-flight.
- TITLE changed about 1 ms before ATC MODEL, and the path 2.7 s after: the backend now waits for
  them to settle (750 ms debounce) and asks for the current path on connect.
- Restart flight (Esc menu) fires AircraftLoaded with the same path and resets switch states;
  no aircraft change. The dock redraws from the value changes alone.
- Cold and dark load resets all switches to off about 25 s after the aircraft appears.

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

- 2026-10-27, sim: Phase 1 spike in MSFS 2024 with the C172 G1000 (log reviewed). Results in
  the table above and `c172-controls.md`. Transponder code reads as plain decimal (1200).
- 2026-10-27, unit test only: input event support and aircraft debounce added to the backend
  (`test/simconnect.test.js`), not yet run against MSFS. `npm run sim:explore` is the tool.
- 2026-10-27, unit test only: `SimConnectBackend` bookkeeping (subscribe, decode, send, exceptions,
  reconnect) against a fake SimConnect handle (`test/simconnect.test.js`). Not run against MSFS.

## Open decisions

- **Node version for the sim link.** Options: (a) pin `node-simconnect@4.1.0` (declares Node 18+);
  (b) try 4.2.1 on 20.8.1 anyway (the engines field is advisory; may just work);
  (c) point `CodePathWin` at a separately installed newer Node. The Phase 1 spike runs on the
  user's own Node (v24), so it does not answer this. Phase 2 runs the backend inside VSD Craft
  and will show whether (b) works; fall back to (a) if not.
