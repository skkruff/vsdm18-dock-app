# M18 MSFS Switchboard

The design brief is `DESIGN_BRIEF.md`; read it first. It is the source of truth for goals,
architecture (single Node process; dock / sim / profile layers) and the phase plan.

## Current state

Phase 0 (hardware and SDK spike), code done, awaiting the hardware test in `docs/phase0-test.md`.

## Layout

- `plugin/com.m18switchboard.msfs.sdPlugin/`: the Stream Dock plugin folder as deployed.
  - `plugin/dock.js`: dock layer, the only code that speaks the Stream Dock protocol.
  - `plugin/index.js`: currently the Phase 0 diagnostic.
- `scripts/`: `make-icons.js` (placeholder PNGs), `deploy.js` (copy to `%APPDATA%`, Windows).
- `test/fake-host.js`: stand-in Stream Dock host, `npm run test:host`.
- `docs/sdk-notes.md`: SDK summary. `docs/verified.md`: verified vs assumed, keep it updated.

## Rules

- Record findings in `docs/verified.md` with date and method; never present untested as verified.
- Dev happens in a Linux container without the device or the sim: anything needing either is
  tested by the user on Windows.
- One action ("Switchboard Slot") on every key; the plugin owns all drawing and paging.
- Stream Dock bundles Node 20.8.1: no syntax or APIs newer than that in plugin code.
