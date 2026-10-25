# Stream Dock M18 MSFS 2024 Switchboard: Design Brief

Use this file as the project's `CLAUDE.md` (or `DESIGN_BRIEF.md` referenced from it). It describes what to build, how to structure it, what is known, and what must be verified before relying on it.

## 1. Goal

Turn a VSDinside Stream Dock M18 into a flight sim switchboard for Microsoft Flight Simulator 2024 (Windows). The aim is to cut cockpit mouse clicking and keyboard shortcuts to a minimum.

Core behaviours:

1. **Aircraft-aware layouts.** Detect the loaded aircraft and populate the dock with that aircraft's switches. Different aircraft have different layouts (for example, some have left and right landing lights, some have one).
2. **State-aware icons.** Each switch key shows an icon that reflects the real sim state (on/off, and other states where relevant). Icons come from the user's existing PNG library.
3. **Readout keys.** Spare keys display live values from the sim, such as QNH, COM1 active/standby frequency, and transponder code.
4. **Pages.** When an aircraft's controls do not fit on one page (autopilot, for example), provide switchable pages. One key position is reserved for page switching and stays in the same place across all aircraft.

## 2. Hardware and environment

- Device: VSDinside / Mirabox Stream Dock M18, plugged in and working with the vendor software. The user describes it as 18 buttons. **First task: determine which are LCD keys and which are plain buttons, and the grid layout.** Do not assume.
- OS: Windows, MSFS 2024 on the same machine.
- Plugin SDK: official StreamDock Plugin SDK (GitHub: MiraboxSpace/StreamDock-Plugin-SDK, docs at sdk.key123.vip). Templates exist for JavaScript, Vue, Node.js, C++, Qt and Python. Per the docs, non-Vue plugins go in a `.sdPlugin` folder under `C:\Users\<user>\AppData\Roaming\HotSpot\StreamDock\plugins`, with a Stream Dock restart the first time.
- The SDK's structure closely resembles the Elgato Stream Deck SDK (manifest, plugin page talking to the host over WebSocket, HTML Property Inspector). Treat that as a hint, not a guarantee. Read the actual docs.

## 3. Architecture (initial decision)

Start with a **single Node.js process**: the Stream Dock plugin and the sim link live together. Split the sim link into a separate bridge process only if a real need appears.

Keep three layers separate:

1. **Dock layer.** Talks to Stream Dock: receives key events, sets images, titles and states, handles page redraws.
2. **Sim layer.** Behind a `SimBackend` interface: `connect()`, `onAircraftChanged(cb)`, `subscribe(vars, cb)`, `read(var)`, `send(action)`. First implementation uses SimConnect. The interface exists so that a different backend (AAO WebAPI, MobiFlight WASM, or direct L:var access) can be swapped in later for third-party aircraft without touching the other layers.
3. **Profile engine.** Loads the profile for the detected aircraft, decides what each key shows and does, subscribes only to the variables the active page needs, and renders.

**Rule: the icon always reflects sim state, never the last button press.** Pressing a key sends a command. The icon changes only when the sim reports the new state. This prevents desync.

**Aircraft knowledge lives in data, not code.** Adding an aircraft should mean adding a profile file and finding its variable names, with little or no engine change.

## 4. Profile format (draft, refine during implementation)

One JSON file per aircraft in `profiles/`. Draft shape:

```json
{
  "id": "cessna172",
  "match": ["Cessna 172", "C172"],
  "pages": [
    {
      "name": "main",
      "keys": [
        {
          "slot": 0,
          "type": "switch",
          "label": "Landing",
          "read": { "var": "LIGHT LANDING", "unit": "bool" },
          "press": { "event": "LANDING_LIGHTS_TOGGLE" },
          "icons": { "on": "landing_on.png", "off": "landing_off.png" }
        },
        {
          "slot": 12,
          "type": "readout",
          "label": "QNH",
          "read": { "var": "KOHLSMAN SETTING MB:1", "unit": "millibars" },
          "format": "0000"
        },
        { "slot": 17, "type": "page", "target": "next" }
      ]
    }
  ]
}
```

Notes:
- `match` is how the detected aircraft (from title or ATC model) maps to a profile. Use a case-insensitive substring or regex list. If nothing matches, show a clear "no profile" state and fall back to a small generic profile (master, lights, radios).
- `slot` is the physical key index. Keep slot numbering documented once the hardware layout is known.
- Switch types will need more than on/off in time (three-position, multi-state). Design `icons` as a map of named states from the start.
- Prefer set-style events over pure toggles where the sim offers them. Where only a toggle exists, read state first and send the toggle only if needed.

## 5. Candidate sim variables and events for the Cessna 172

These are standard SimConnect names and **must be verified against the 172 in MSFS 2024** (that they exist, that they reflect the real switch position, and that the events actually move the switch). Do not trust this list.

| Function | Variable | Event |
|---|---|---|
| Battery master | ELECTRICAL MASTER BATTERY | TOGGLE_MASTER_BATTERY |
| Alternator | GENERAL ENG MASTER ALTERNATOR:1 | TOGGLE_MASTER_ALTERNATOR |
| Avionics master | AVIONICS MASTER SWITCH | AVIONICS_MASTER_SET |
| Beacon | LIGHT BEACON | TOGGLE_BEACON_LIGHTS |
| Landing | LIGHT LANDING | LANDING_LIGHTS_TOGGLE |
| Taxi | LIGHT TAXI | TOGGLE_TAXI_LIGHTS |
| Nav | LIGHT NAV | TOGGLE_NAV_LIGHTS |
| Strobe | LIGHT STROBE | STROBES_TOGGLE |
| Pitot heat | PITOT HEAT SWITCH | PITOT_HEAT_TOGGLE |
| QNH | KOHLSMAN SETTING MB:1 | (readout) |
| COM1 active / standby | COM ACTIVE FREQUENCY:1 / COM STANDBY FREQUENCY:1 | (readout) |
| Transponder | TRANSPONDER CODE:1 | (readout) |
| Aircraft identity | TITLE, ATC MODEL | (aircraft detection) |

## 6. Icons

The user has a library of PNG icons. Ask where it lives and how files are named before designing the lookup. Proposed convention, to confirm: `<function>_<state>.png` (for example `landing_on.png`, `landing_off.png`). Profiles reference icons by filename. The plugin loads them and sends them to the dock in whatever form the SDK's set-image call accepts (verify: base64 PNG or data URI, size requirements).

Readout keys need generated images (text drawn onto a background). Verify what `setTitle` can do on this hardware first, then decide between title text and a rendered image (SVG or canvas).

## 7. Things to verify before building on them

Treat each as unknown until tested on the real hardware and sim:

1. Which keys are LCD, grid layout, key image resolution.
2. The SDK calls available: set image, set title, set state, and especially whether a plugin can switch the dock's profile or page, or whether the plugin must redraw every key itself.
3. Whether the Stream Dock software will load Elgato Stream Deck plugins at all (useful for comparison with AAO's free Stream Deck plugin, not required).
4. Which SimConnect library works with MSFS 2024 (candidates: `node-simconnect` for Node; `Python-SimConnect` if Python is chosen). Check maintenance status and 2024 compatibility.
5. That the 172's variables and events behave as listed in section 5.
6. How to detect an aircraft change (system event for aircraft loaded, versus polling TITLE).

When something is verified, note it in `docs/verified.md` with the date and how it was verified. Distinguish "verified" from "assumed" in your explanations to the user.

## 8. Build plan

**Phase 0: Hardware and SDK spike.** Read the SDK docs. Install a hello-world plugin. Confirm the plugin loads, a key press arrives, and the plugin can set an image and title on a key. Map the physical keys. Answer questions 1 to 3 in section 7. Output: `docs/verified.md` with findings.

**Phase 1: Sim link spike.** Standalone script, no dock. Connect to MSFS 2024 via SimConnect. Log the aircraft title and ATC model, and subscribe to the 172's light and radio variables printing changes as they happen. Send one event (landing light toggle) and confirm the switch moves. Answer questions 4 to 6. Output: a working `SimBackend` implementation plus verified variable list.

**Phase 2: Vertical slice.** Join both spikes. One 172 profile, one page, three switch keys (landing, nav, beacon), one readout (QNH). Aircraft detection selects the profile. Icons follow sim state. Keys redraw correctly after sim restart, aircraft change, and dock reconnect.

**Phase 3: Full Cessna 172.** All switches, readouts, and an autopilot or secondary page with a page-switch key in a fixed slot. Handle states: sim not running, no profile for aircraft, variable unavailable.

**Phase 4: Second aircraft.** Add a different default aircraft with a different light setup (for example one with separate left/right landing lights). Goal: prove that a new aircraft needs only a profile file. Fix any engine assumptions this exposes.

**Phase 5: Third-party aircraft.** Evaluate per aircraft (the user flies study-level aircraft such as the Black Square Baron and the A2A Comanche). These typically use their own L:vars and custom events rather than standard variables. Decide per aircraft whether to use input events, the MobiFlight WASM module, or the AAO WebAPI as an alternative `SimBackend`. This phase is where most of the effort will go.

**Phase 6: Hardening.** Reconnection handling, logging, config file for icon path and profile folder, brief README, simple way to reload profiles without restarting.

## 9. Constraints and preferences

- Subscribe only to the variables on the active page, on change, not every frame.
- No dependence on paid third-party software in the core path. AAO or others are optional backends, not requirements.
- Keep the first milestone small and demonstrable. Prefer a working slice over broad scaffolding.
- Explain choices concisely. State what was verified versus assumed. Ask before adding heavy dependencies or changing the architecture in section 3.
- Out of scope for now: a settings GUI, auto-downloading profiles, multi-device support, flight planning features.

## 10. First actions for Claude Code

1. Ask the user where the PNG icon library is and how the files are named.
2. Fetch and read the StreamDock Plugin SDK docs and templates. Summarise the manifest, events sent and received, and image/title APIs.
3. Scaffold the plugin from the Node.js template and get the hello-world loading on the M18 (Phase 0).
4. Report findings for section 7 questions 1 to 3 before moving to Phase 1.
