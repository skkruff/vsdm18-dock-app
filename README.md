# M18 MSFS Switchboard

An aircraft-aware switchboard for Microsoft Flight Simulator 2024 on the VSDinside Stream Dock M18
(VSD Craft). The 15 display keys show the cockpit's real state (switch positions, frequencies,
modes) and work its controls; the three round buttons page through each aircraft's pages. When an
aircraft loads, the plugin picks its profile and announces it across the keys.

Everything is set up in a local web editor: keys, pages, looks and a library of reusable keys.

## What it does

- **Keys that follow the sim**: switches with green / red / outline bars (or your own icons),
  readouts (frequencies, times, percentages, with units), annunciators that show armed and active
  modes, and decorative keys.
- **Presses**: toggles, steps (with wrap and hold-to-ramp for dimmers), spring-loaded holds,
  sim events, input events (each aircraft's own cockpit controls), simvar writes, keyboard
  shortcuts (for things MSFS only has key bindings for), stopwatches, and keypads for transponder
  codes and radio frequencies (with a VFR key).
- **Profiles per aircraft**, matched by the aircraft's folder, title or ATC model; a generic profile
  for anything else. A Cessna 172 G1000 (MSFS 2024) profile ships with it.
- **The editor** (http://localhost:8765, or hold the middle round button): a picture of the dock
  drawn exactly as the dock shows it, a key inspector, a face designer, Browse lists of every simvar
  and key event in the MSFS 2024 SDK, Learn (move a control in the cockpit to pick it), a keypad
  layout, and the library.

## Install (Windows PC with VSD Craft and Node.js)

1. Download this repository (Code → Download ZIP) and unzip it.
2. In that folder, open a terminal and run `npm run setup` (once, and after each download).
3. Quit VSD Craft, run `npm run deploy`, start VSD Craft.
4. In VSD Craft, put the "Switchboard Slot" action on all 15 keys and the 3 round buttons of one page.

The plugin connects to MSFS by itself when the sim runs. Settings: `config.json` in the plugin
folder (icon folder, theme, editor port, announcement timings).

## Where things are kept

In `Documents\MSFS Switchboard\`, never touched by an update:

| File | What |
|---|---|
| `profiles\*.json` | one profile per aircraft (shipped ones are copied in only when missing) |
| `library.json` | the key library (shipped items refreshed on start, yours kept) |
| `settings.json` | the Look: font and colours |
| `keypad.json` | your keypad layout (absent: the built-in one) |
| `dock-state.json` | stopwatches, so they survive restarts |

Logs: `logs\YYYY-MM-DD.log` in the plugin folder
(`%APPDATA%\HotSpot\StreamDock\plugins\com.m18switchboard.msfs.sdPlugin`).

## Documentation

- `docs/editor.md`: the editor, screen by screen.
- `docs/profiles.md`: the profile format underneath (keys, sources, presses, faces, keypads).
- `docs/editor-test.md`: what to check on the dock after an update.
- `docs/verified.md`: what has been tested where, and what is still assumed.
- `docs/design-notes.md`: ideas and the backlog. `DESIGN_BRIEF.md`: goals and the phase plan.
- `docs/aircraft/`: per-aircraft control inventories. `docs/hardware.md`, `docs/icons.md`: the dock
  and the icon library.

## Development

Plugin code runs on VSD Craft's bundled Node 20.8.1 (no newer APIs). `npm test` runs the unit
tests; `npm run test:editor` drives the editor in Chromium (needs Playwright). `npm run sim:explore`
lists an aircraft's input events and reports cockpit changes (needs MSFS).
