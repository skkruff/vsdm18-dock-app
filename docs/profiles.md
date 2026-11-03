# Profile format

One JSON file per aircraft in the user's profile folder (default
`Documents\MSFS Switchboard\profiles`, config `profilesDir`). Normally edited with the editor
(`editor.md`); this is the format underneath. The plugin ships starting profiles in
`plugin/com.m18switchboard.msfs.sdPlugin/profiles/`, copied into the folder only when missing.
Saving a file reloads it on the dock. Adding an aircraft means adding a file; the engine should
not need changing.

```json
{
  "id": "c172-g1000",
  "name": "Cessna 172 SP G1000",
  "match": { "path": ["asobo_c172sp_g1000"], "title": [], "atcModel": [] },
  "pages": [ { "name": "Main", "keys": { "0": { ... }, "1": { ... } } } ]
}
```

- **match**: case-insensitive regexes per aircraft field. `path` is the aircraft.cfg path (best:
  it names the package), `title` the preset/livery title, `atcModel` the ATC model key (e.g.
  `ATCCOM.AC_MODEL C172.0.text`). Any hit selects the profile; files are tried alphabetically.
- **banner**: one or two lines announced across the panel when the aircraft loads (e.g.
  `["C172", "G1000"]`), with the MSFS logo icon in the centre key.
- **fallback: true** instead of `match`: used when nothing else matches (the generic profile).
  The page announcement then says NO PROFILE.
- **pages**: page 1 is the main page. The round buttons switch pages (◀ previous, main, next ▶),
  so profiles never spend an LCD key on paging.
- **keys**: slot number (0-14, see `hardware.md`) to key. Slots left out are dark.

## Keys

Any key type can have a `press` (e.g. a QNH readout that syncs the altimeter when pressed).

Common fields: `type`, `label` (text for generated tiles; `\n` for a second line), `icon` (icon
library base name, see `icon-index.md`; optional), `read`, `press`.

| type | Shows | Needs |
|---|---|---|
| `switch` | library icon `<icon>_<state>_<theme>.png`, or a generated tile with a red/green bar | `press` (`read`, `states` for its look) |
| `button` | stateless library icon `<icon>_<theme>.png` or the label | `press` |
| `rotary` | like a readout (a dimmer's or knob's value) | `press` (usually a tap / hold step) |
| `readout` | label and a live value, or a state from `logic`; with `icon`, the top of that library icon above the value | `read` or `logic` |
| `decor` | looks only: icon, or label and `sublabel`, or a `face`; never reads or acts | nothing (no `read` or `press` allowed) |

- **states** (switch): sim value to `on`, `off` or `clear`. `otherwise`: state for values not in
  the map. Unknown value (not yet read, sim reconnecting) shows `clear`.
- **logic** (readout; key editor redesign 2026-11-01, replaces the old `armable` type): steps
  checked in order; the first with any condition met decides the look and sublabel, else
  `otherwise`. Any number of steps. A condition is `{ "read": <source>, "is": 1 }` (`is` defaults
  to 1). Unknown values do not count. `logicFaces` holds a face per step, keyed `"0"`, `"1"`, ...
  and `"otherwise"`. Library icons have no armed version: armed draws the icon's clear version
  with its bar filled in the armed colour.
  ```json
  { "type": "readout", "label": "APR",
    "logic": { "steps": [
        { "when": [{ "read": { "var": "AUTOPILOT APPROACH ACTIVE", "unit": "bool" } }], "look": "on", "sublabel": "LOC" },
        { "when": [{ "read": { "var": "AUTOPILOT APPROACH ARM", "unit": "bool" } }], "look": "armed", "sublabel": "ARM" } ],
      "otherwise": { "look": "clear" } },
    "press": { "input": "<the APR button's input event>", "hold": 1, "release": 0 } }
  ```
- **Older forms** are converted when read (profiles, library): `armable` (with `armed`,
  `activeOr`, `armedOr`, `sublabels` / `valueFaces` per step) becomes a readout with `logic`;
  a step with `rampMs` becomes tap / hold; a stopwatch with `holdReset` becomes tap / hold; a
  readout whose hold ramps becomes a `rotary`. Files are written in the new form on the next save.
- **text** (readout): sim value to a word shown instead of the number (e.g. magneto `3` -> `BOTH`).
- **sublabel** (any type): a smaller line under the label on drawn tiles. **sublabels**: sim value
  to a sublabel (e.g. `{ "0": "ARM", "1": "OFF" }`); a value not listed shows `sublabel`. Older
  switch profiles with `text` still work (read as `sublabels`); the editor moves it over.
- **decimals**, **pad**: readout number format (`decimals: 3` -> 124.655, `pad: 4` -> 0007).
- **prefix**, **suffix** (readouts and value layers): units around the value, e.g. `"suffix": "%"`
  -> 75%, `"suffix": "RPM"` -> 2400 RPM, `"prefix": "QNH"` -> QNH 1013. A unit starting with a
  letter or digit gets a space. Not added to words from `text`. Value layers without their own
  source use the key's units unless they set their own.
- **hideValue**, **stateBar** (readout, rotary; user 2026-11-03): the automatic look without the
  number (`"hideValue": true`), and / or with a state bar coloured by `states` / `otherwise` like a
  switch's (`"stateBar": true`). A custom face ignores them (it has its own layers).
- **separator** (any type; user 2026-11-03): `true` draws a line under the label (64 x 7, corner 3.5, in the Look's
  separator colour, which is the readout colour until set).
- **valueIcons** (any type): sim value to a library icon name shown as the whole key, e.g.
  `{ "3": "magneto_both" }`. Values not listed fall back to the normal look.
- **icon on a readout**: the icon's visible content is found automatically, scaled into the top
  of the key, and the value drawn below it.
- **valueFaces** (any type): sim value to a face (below), e.g. a different look per magneto
  position. Wins over valueIcons and the key's face for that value.
- **format**: `"time"` shows seconds since midnight (LOCAL TIME, ZULU TIME) as HH:MM;
  `"duration"` shows seconds as M:SS, or H:MM:SS from an hour (stopwatches).
- **face** (any type, optional): a custom look replacing the automatic one (valueIcons still win
  when they match). `{ "background": "#000000", "layers": [...] }`, layers drawn in order, in key
  units (144 x 144):
  - `{ "kind": "icon", "icon": "set_altimeter", "crop": "auto" | "full", "x", "y", "w", "h" }`:
    icon fitted into the box. Without `icon`, the key's own icon (its on/off/clear version on
    switches). `auto` crops to the icon's visible content.
  - `{ "kind": "text", "text", "x", "y", "size", "color", "w" }`: centred on x, y; shrinks to fit w.
  - `{ "kind": "value", "x", "y", "size", "color", "w", "decimals", "pad", "format", "read" }`: a
    live value. Without `read`, the key's own value (formatted as the key says unless the layer
    sets decimals/pad/format); with `read` (`{ "input" }` or `{ "var", "unit" }`), its own source,
    so one key can show several values.
  - `{ "kind": "sublabel", "x", "y", "size", "color", "w" }`: the key's sublabel for its current
    value (or logic step); defaults to where drawn tiles put it. With `read` (its own source),
    `sublabels` (`{ value: text }`) and an optional fallback `sublabel`, it shows the text for
    that source's value instead, e.g. GPS / VLOC from `GPS DRIVES NAV1`.
  - `{ "kind": "bar", "x", "y", "w", "h", "r", "look" }`: green / red / outline by state, or
    always `look` (`on` green, `armed` white, `off` red, `clear` outline); missing fields use
    the standard bar (x 21.4, y 93.4, w 101.3, h 34.9, corner 9.5).
  - `{ "kind": "separator", "x", "y", "w", "h", "r", "color" }`: the separator line, centred on
    x, y (defaults 72, 56, 64 x 7, corner 3.5, readout colour).
  - `{ "kind": "rect", "x", "y", "w", "h", "r", "color" }`: a filled box.
  - `{ "kind": "level", "x", "y", "w", "h", "r", "dir", "min", "max", "color", "track", "bands", "read" }`:
    a level bar (user, 2026-11-03), an outline filled in proportion to the value between `min`
    (empty, default 0) and `max` (full, default 100). `dir`: `right` (fills from the left, the
    default), `left`, `up` (from the bottom), `down`. `color`: the fill (default the look's green),
    `track`: the outline. `bands`: `[{ "below": 25, "color": "#ffcc00" }, { "below": 10, "color":
    "#ff3b3b" }, { "above": 90, "color": … }]`; the tightest band the value is in sets the fill.
    Without `read` it shows the key's value; with `read`, its own source (e.g. a fuel quantity on a
    fuel pump key). Position defaults to the standard bar; an unknown value shows the outline only.
  Layers without a `color` follow the global look (editor Look panel). A text-only key with no
  sim source is a `button` with a face.

## Sources (`read`)

- `{ "input": "ELECTRICAL_BATTERY_1" }`: an input event (list them with `npm run sim:explore`).
- `{ "var": "KOHLSMAN SETTING MB:1", "unit": "millibars" }`: a simvar. `unit: "bool"` gives 0/1.
- `{ "timer": "T1" }`: a dock stopwatch's elapsed whole seconds (show with `"format": "duration"`,
  M:SS or H:MM:SS); `{ "timer": "T1", "part": "running" }`: 1 while it runs, else 0. Stopwatches
  are kept by the plugin, count sim time (SIMULATION TIME, follow sim rate; held while the sim
  reports any pause through the Pause_EX1 event, as active pause does not stop SIMULATION TIME;
  ignore jumps over 60 s such as a new flight) and are saved in `dock-state.json` next to the
  profiles folder, so they survive restarts. Keys using the same name share one stopwatch.

- `{ "sim": "paused" }`: 1 while the sim is paused (the pause key, active pause or the menu), else 0
  (from the Pause_EX1 system event). The sim reports it only when it changes, so it is unknown
  (clear) after the plugin connects until the first pause or unpause.

The engine watches only the sources on the page being shown.

## Actions (`press`)

The key never changes on press; it changes when the sim reports the new value.

| press | Does |
|---|---|
| `{ "cycle": [0, 1] }` | sets the input event to the value after the current one in the list (a toggle); from a value not in the list, the next listed value above it |
| `{ "step": 1, "max": 3 }` | current value plus step, held within min/max; nothing at the stop |
| `{ "step": 25, "min": 0, "max": 100, "wrap": true }` | as step; at the stop, goes round to the other end |
| `{ "hold": 4, "release": 3, "repeatMs": 250 }` | sets 4 on key down and 3 on key up (spring-loaded positions). `repeatMs` re-sends 4 while held, for aircraft that drop the position otherwise |
| `{ "set": 2 }` | sets a fixed value |
| `{ "event": "PITOT_HEAT_TOGGLE" }` | sends a classic event, `value` optional |
| `{ "event": "AVIONICS_MASTER_SET", "toggleValue": true }` | sends 1 if the read value is 0, else 0 |
| `{ "timer": "T1", "action": "toggle" }` | a dock stopwatch: `toggle` (start / stop), `start`, `stop`, `reset` |
| `{ "keypad": "xpdr" }` | opens a keypad over the dock; the value typed is set on ENT, or as soon as all digits are in. Presets: `xpdr` (4 digits 0-7, XPNDR_SET as BCD; `vfr`: "1200", the code the VFR key sets, changeable e.g. to "7000"), `com1` / `com2` (6 digits, 3 decimals, COM_STBY_RADIO_SET_HZ / COM2_STBY_RADIO_SET_HZ), `nav1` / `nav2` (5 digits, 2 decimals, NAV1/2_STBY_SET_HZ). Your own: `{ "title", "digits", "decimals", "octal", "autoEnter": true, "apply": { "event" \| "var" + "unit" \| "input", "encode": "number" \| "bcd16", "scale" } }`; a preset can be given with overrides as `{ "preset": "com1", "title": "COM1" }`. Missing digits count as zeros (124.8 -> 124.800). A preset's pathway can be replaced on the key, e.g. `{ "preset": "xpdr", "apply": { "input": "XPDR_CODE" } }` (event / var / input replaces the preset's target; encode and scale fill in from the preset). The layout is the keypad layout below. CANCEL or a round button closes it |
| `{ "keys": "Ctrl+Shift+L" }` | presses a keyboard shortcut (Windows), for things MSFS only has key bindings for (flashlight, views). Modifiers go down first (Ctrl, Shift, Alt, Win; RCtrl etc. for right-hand ones) and up last. `"whileHeld": true` keeps the keys down while the dock key is held. MSFS is brought to the front first unless `"focus": false`. Key names: letters, digits, F1-F24, Up/Down/Left/Right, Home, End, PgUp, PgDn, Insert, Delete, Pause (or Break), PrtSc, Esc, Enter, Tab, Space, Numpad0-9, NumpadAdd/Subtract/Multiply/Divide/Decimal/Enter, punctuation, or browser key codes (KeyL) |

**Lists**: `[ action, action ]` does each in order on one press (e.g. two softkeys).

**Tap / hold**: `{ "tap": <action or list>, "hold": <action or list>, "holdMs": 400 }`. The tap
acts on release before `holdMs` (default 400); the hold acts once `holdMs` is reached, and the tap
then doesn't. Without `tap`, a short press does nothing. A hold action with `repeatMs` repeats
every that many ms while held; a repeating `step` ramps (counts from the value it last sent;
with `wrap` it turns back at the ends). Examples:

- dimmer: `{ "tap": { "step": 25, "min": 0, "max": 100, "wrap": true }, "hold": { "step": 5, "min": 0, "max": 100, "wrap": true, "repeatMs": 100 } }`
- stopwatch on one key: `{ "tap": { "timer": "T1", "action": "toggle" }, "hold": [{ "timer": "T1", "action": "stop" }, { "timer": "T1", "action": "reset" }], "holdMs": 1000 }`

A spring-loaded `{ "hold": 4, "release": 3 }` (a number) is not tap / hold: it holds a position
while the key is down.

**Sends ×** (`"scale": 0.01` on a cycle / step / hold / set action): for controls set in other units
than they report. The DA62's LIGHTING_PANEL_LIGHT_INTENSITY reads 0-100 but is set 0-1, so
`{ "step": 10, "min": 0, "max": 100, "scale": 0.01 }` steps from 50 to 60 and sends 0.6. Steps,
limits and the key's value stay in the units read; ramps are scaled the same way.

cycle/step/hold/set act on `press.var` (a simvar written directly, e.g.
`{ "var": "TRANSPONDER STATE:1", "unit": "number" }`), else `press.input`, else the key's
`read.input`. A simvar is only written when named in `press.var`. The sim keeps writes only to
simvars it lets clients set (the SDK's "settable"), and an aircraft's avionics may put their own
value back. Cycle and step start from the written simvar's current value (it is watched).

## Keypad layout (`keypad.json`)

One layout for every keypad, next to the profiles folder; without the file the built-in one is
used. Edited in the editor's "Keypad (all keypads)" tab. `{ "keys": { slot: key } }`, keys of type
`keypad` with a `role`: `digit` (+ `digit`: "0"-"9"), `ent`, `del` (last digit), `clr` (all
digits), `cancel`, `vfr` (sets the keypad's VFR code), `title` (title, value now below), `now`,
`typed` (a `digit` "9" key is VFR on keypads with a VFR code unless it has `"vfr": false`); plus `label`, `sublabel`,
`icon`, `face` like any key (a face's value layers show the role's text). `decor` keys may sit
in it too. Built-in: CANCEL, title, typed, DEL, ENT on the top row; 1-5 and 6-0 below. Keys that
do nothing at the moment are dimmed. The round buttons always close the keypad.
