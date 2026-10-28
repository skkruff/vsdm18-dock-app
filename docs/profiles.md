# Profile format

One JSON file per aircraft in `plugin/com.m18switchboard.msfs.sdPlugin/profiles/`. Adding an
aircraft means adding a file; the engine should not need changing. Examples: `c172-g1000.json`,
`generic.json`.

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
- **fallback: true** instead of `match`: used when nothing else matches (the generic profile).
  The page announcement then says NO PROFILE.
- **pages**: page 1 is the main page. The round buttons switch pages (◀ previous, main, next ▶),
  so profiles never spend an LCD key on paging.
- **keys**: slot number (0-14, see `hardware.md`) to key. Slots left out are dark.

## Keys

Common fields: `type`, `label` (text for generated tiles; `\n` for a second line), `icon` (icon
library base name, see `icon-index.md`; optional), `read`, `press`.

| type | Shows | Needs |
|---|---|---|
| `switch` | library icon `<icon>_<state>_<theme>.png`, or a generated tile with a red/green bar | `read`, `states` |
| `readout` | label and a live value | `read` |
| `button` | stateless library icon `<icon>_<theme>.png` or the label | `press` |

- **states** (switch): sim value to `on`, `off` or `clear`. `otherwise`: state for values not in
  the map. Unknown value (not yet read, sim reconnecting) shows `clear`.
- **text**: sim value to a word, shown on readouts (e.g. magneto `3` -> `BOTH`) and under the
  label on generated switch tiles (e.g. `ARM`).
- **decimals**, **pad**: readout number format (`decimals: 3` -> 124.655, `pad: 4` -> 0007).

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
| `{ "hold": 4, "release": 3 }` | sets 4 on key down and 3 on key up (spring-loaded positions) |
| `{ "set": 2 }` | sets a fixed value |
| `{ "event": "PITOT_HEAT_TOGGLE" }` | sends a classic event, `value` optional |
| `{ "event": "AVIONICS_MASTER_SET", "toggleValue": true }` | sends 1 if the read value is 0, else 0 |

cycle/step/hold/set act on `press.input`, or on the key's `read.input` if not given.
