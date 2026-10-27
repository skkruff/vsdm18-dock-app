# M18 MSFS Switchboard

The design brief is `DESIGN_BRIEF.md`; read it first. It is the source of truth for goals,
architecture (single Node process; dock / sim / profile layers) and the phase plan.

## Current state

Phase 0 done on hardware (2026-10-27); see `docs/hardware.md`. Next: Phase 1 (sim link spike).

The dock software on the user's PC is **VSD Craft** (VSDinside's branding of Stream Dock); its
data folder is still `%APPDATA%\HotSpot\StreamDock`.

## Layout

- `plugin/com.m18switchboard.msfs.sdPlugin/`: the Stream Dock plugin folder as deployed.
  - `plugin/dock.js`: dock layer, the only code that speaks the Stream Dock protocol.
  - `plugin/index.js`: currently the Phase 0 diagnostic.
  - `plugin/icons.js`: icon library lookup (naming scheme in `docs/icons.md`).
- `scripts/`: `make-icons.js` (placeholder PNGs), `deploy.js` (copy to `%APPDATA%`, Windows),
  `index-icons.js` (lists the user's icon library into `docs/icon-index.md`).
- `test/`: `fake-host.js` (stand-in Stream Dock host), `icons.test.js`. Run all with `npm test`.
- `docs/hardware.md`: M18 key layout and slot numbering. `docs/icons.md`, `docs/icon-index.md`:
  icon library.
- `docs/sdk-notes.md`: SDK summary. `docs/verified.md`: verified vs assumed, keep it updated.

## Rules

- Record findings in `docs/verified.md` with date and method; never present untested as verified.
- Dev happens in a Linux container without the device or the sim: anything needing either is
  tested by the user on Windows.
- One action ("Switchboard Slot") on every key; the plugin owns all drawing and paging.
- Stream Dock bundles Node 20.8.1: no syntax or APIs newer than that in plugin code.
