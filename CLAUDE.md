# M18 MSFS Switchboard

The design brief is `DESIGN_BRIEF.md`; read it first. It is the source of truth for goals,
architecture (single Node process; dock / sim / profile layers) and the phase plan.

## Current state

Phases 0, 1 and 2 done and tested by the user (2026-10-28). Follow-ups from the Phase 2 test in
code, to recheck (`docs/phase2-followup-test.md`): START repeat while held, panel-wide banners,
QNH press, icon above readout, stale aircraft path fix. Open: the editor (see
`docs/design-notes.md`), keypad entry.

## Profile content principles (user, 2026-10-27)

- Base profiles on the controls actually in each aircraft's cockpit, not only those named in the
  brief. Inventory per aircraft (e.g. `docs/aircraft/c172-controls.md`) before writing a profile.
- Be thorough but judicious: 15 display keys. Leave out controls with no practical use in the sim
  (e.g. C172 cabin 12V power, alternate static air). **When unsure whether a control matters,
  ask the user.**
- Keep it readable and follow the real panel layout where possible.
- Non-critical controls (e.g. cockpit lighting dimmers) go on their own page.
- Multi-position switches may be simplified when space is tight (e.g. C172 standby battery as
  ARM/OFF only, TEST not modelled), noted as a known simplification.
- The user's ideas for later stages are collected in `docs/design-notes.md`; check it when
  starting a phase.

The dock software on the user's PC is **VSD Craft** (VSDinside's branding of Stream Dock); its
data folder is still `%APPDATA%\HotSpot\StreamDock`.

## Layout

- `plugin/com.m18switchboard.msfs.sdPlugin/`: the Stream Dock plugin folder as deployed.
  - `plugin/dock.js`: dock layer, the only code that speaks the Stream Dock protocol.
  - `plugin/index.js`: entry point; wires dock, sim and engine; key coordinates to slots.
  - `plugin/engine.js`: profile engine (pages, watches, presses, status screens).
  - `plugin/profiles.js`: profile loading, validation, aircraft matching.
  - `plugin/render.js`: key images (library icons or generated SVG tiles).
  - `plugin/icons.js`: icon library lookup (naming scheme in `docs/icons.md`).
  - `plugin/sim/simconnect.js`: sim layer, `SimBackend` implemented on node-simconnect.
  - `profiles/*.json`: one per aircraft, format in `docs/profiles.md`. `config.json`: user settings.
- `scripts/`: `make-icons.js` (placeholder PNGs), `deploy.js` (copy to `%APPDATA%`, Windows),
  `index-icons.js` (lists the user's icon library into `docs/icon-index.md`),
  `sim-spike.js` (Phase 1: standalone sim test, `npm run sim:spike`), `sim-explore.js`
  (lists an aircraft's input events and reports cockpit changes, `npm run sim:explore`).
- `test/`: `fake-host.js` (stand-in Stream Dock host), `icons.test.js`, `simconnect.test.js`
  (backend against a fake SimConnect handle), `engine.test.js` (engine with the real profiles
  against a fake sim). Run all with `npm test`.
- `docs/aircraft/`: per-aircraft control inventories and input event lists.
- `docs/hardware.md`: M18 key layout and slot numbering. `docs/icons.md`, `docs/icon-index.md`:
  icon library.
- `docs/sdk-notes.md`: SDK summary. `docs/verified.md`: verified vs assumed, keep it updated.

## Rules

- Record findings in `docs/verified.md` with date and method; never present untested as verified.
- Dev happens in a Linux container without the device or the sim: anything needing either is
  tested by the user on Windows.
- One action ("Switchboard Slot") on every key; the plugin owns all drawing and paging.
- Stream Dock bundles Node 20.8.1: no syntax or APIs newer than that in plugin code.
