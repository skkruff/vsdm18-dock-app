# Icon library

Location (user's PC): `D:\MFS2024\Flight Sim Dock\Button Icon PNGs`. 1,803 files, all 512x512,
394 icon bases, every file matches the scheme below. Full list in `icon-index.md`.

## Naming, as seen in the screenshot

`<base>[_<state>]_<theme>.png`

- **Themes** (3 variants of every icon): `B_C18` (navy background), `RGB` (black background),
  `RGB_white` (white background).
- **States** for switch-type icons: `on` (green bar), `off` (red bar on RGB), `clear`
  (outlined empty bar).
- **Stateless** icons have no state part. Directional and momentary actions put the direction in
  the base: `aileron_left`, `aileron_trim_right`, `airspeed_reference_minus`,
  `altitude_reference_plus`, `anti_ice` (snowflake only).
- The icons carry their own label text, so keys need no title.

`plugin/icons.js` parses names by suffix (base names contain underscores) and resolves
`(base, state)` to a file in the configured theme. `npm run icons:index -- "<folder>"` writes
`docs/icon-index.md` listing every base, its states and themes, the PNG pixel sizes, and any
file that does not fit the scheme.

## How profiles will use it (proposed)

```json
{ "slot": 0, "type": "switch", "icon": "landing_light",
  "read": { "var": "LIGHT LANDING", "unit": "bool" },
  "states": { "1": "on", "0": "off" } }
```

The engine maps the sim value to a state name and draws `<icon>_<state>_<theme>.png`. When the
value is not known yet (sim not connected, variable unavailable) it draws `clear`. If a file is
missing, it falls back to a generated text tile so a gap in the library never blanks a key.

## User notes (2026-10-27)

The themes are automated colour variations from the icon pack. The user has copied the icons they
like from two of them, navy (`B_C18`) and RGB black/white; only the RGB variants have real red and
green indicators. Which theme(s) to use, and the meaning of `clear`, are still to be discussed.
