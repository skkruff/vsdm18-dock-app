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
| `switch` | library icon `<icon>_<state>_<theme>.png`, or a generated tile with a red/green bar | `read`, `states` |
| `readout` | label and a live value; with `icon`, the top of that library icon above the value | `read` |
| `button` | stateless library icon `<icon>_<theme>.png` or the label | `press` |

- **states** (switch): sim value to `on`, `off` or `clear`. `otherwise`: state for values not in
  the map. Unknown value (not yet read, sim reconnecting) shows `clear`.
- **text**: sim value to a word, shown on readouts (e.g. magneto `3` -> `BOTH`) and under the
  label on generated switch tiles (e.g. `ARM`).
- **decimals**, **pad**: readout number format (`decimals: 3` -> 124.655, `pad: 4` -> 0007).
- **valueIcons** (any type): sim value to a library icon name shown as the whole key, e.g.
  `{ "3": "magneto_both" }`. Values not listed fall back to the normal look.
- **icon on a readout**: the icon's visible content is found automatically, scaled into the top
  of the key, and the value drawn below it.
- **valueFaces** (any type): sim value to a face (below), e.g. a different look per magneto
  position. Wins over valueIcons and the key's face for that value.
- **format**: `"time"` shows seconds since midnight (LOCAL TIME, ZULU TIME) as HH:MM.
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
  - `{ "kind": "bar", "x", "y", "w", "h", "r" }`: green / red / outline by state; missing fields use
    the bar measured from the user's icons.
  - `{ "kind": "rect", "x", "y", "w", "h", "r", "color" }`: a filled box.
  Layers without a `color` follow the global look (editor Look panel). A text-only key with no
  sim source is a `button` with a face.

## Sources (`read`)

- `{ "input": "ELECTRICAL_BATTERY_1" }`: an input event (list them with `npm run sim:explore`).
- `{ "var": "KOHLSMAN SETTING MB:1", "unit": "millibars" }`: a simvar. `unit: "bool"` gives 0/1.

The engine watches only the sources on the page being shown.

## Actions (`press`)

The key never changes on press; it changes when the sim reports the new value.

| press | Does |
|---|---|
| `{ "cycle": [0, 1] }` | sets the input event to the value after the current one in the list (a toggle) |
| `{ "step": 1, "max": 3 }` | current value plus step, held within min/max; nothing at the stop |
| `{ "hold": 4, "release": 3, "repeatMs": 250 }` | sets 4 on key down and 3 on key up (spring-loaded positions). `repeatMs` re-sends 4 while held, for aircraft that drop the position otherwise |
| `{ "set": 2 }` | sets a fixed value |
| `{ "event": "PITOT_HEAT_TOGGLE" }` | sends a classic event, `value` optional |
| `{ "event": "AVIONICS_MASTER_SET", "toggleValue": true }` | sends 1 if the read value is 0, else 0 |

cycle/step/hold/set act on `press.input`, or on the key's `read.input` if not given.
