# M18 hardware layout

Verified 2026-10-27 on the user's M18 with the Phase 0 diagnostic (photo of the dock, VSD Craft
screenshot, plugin log).

## What the host reports

- Device name `VSDM18`, `size: { columns: 5, rows: 3 }`, `type: 0`.
- **15 LCD keys**: columns 0-4, rows 0-2. **Row 0 is the bottom row** (row 2 is the top).
- **3 plain buttons** (the round buttons under the LCDs) also accept the Switchboard Slot action.
  They report as `controller: "Keypad"` at **column 5**, rows 0, 1, 2, outside the advertised
  5x3 size. They send keyDown/keyUp like any key. They have no display.
- Plain button order: left = row 0, middle = row 1, right = row 2 (verified 2026-10-27 from the
  coordinate labels VSD Craft shows on each round button).
- All five display tests looked as intended on the device (user report, 2026-10-27): coordinates,
  PNG test card, title text, yellow "QNH 1013" SVG readout, setState.
- Images: 144x144 SVG and PNG data URIs display with all four edges visible and square, so the
  host scales to the key without cropping. Key icons in the user's library are 512x512.

## Slot numbering used by profiles

Slots read like a page: top-left first. Profiles use slot numbers, never raw coordinates.

```
 LCD   [ 0] [ 1] [ 2] [ 3] [ 4]     row 2 (top)
       [ 5] [ 6] [ 7] [ 8] [ 9]     row 1
       [10] [11] [12] [13] [14]     row 0 (bottom)
 btn       (15)  (16)  (17)         column 5, rows 0/1/2
```

- LCD: `slot = (2 - row) * 5 + column`
- Buttons: `slot = 15 + row`

## Other things seen in the log

- VSD Craft version 3.10.188.226 (the minimum with built-in Node 20.8.1). Windows 10.0.26300.
- The `devices` list at registration holds three entries: two `VSDM18` ids and one `VSDN3`.
  Only one M18 id was ever active. The plugin therefore follows the `device` field on each key
  event and does not assume a single device.
- `titleParametersDidChange` arrives with every `willAppear` (font HarmonyOS Sans, size 10,
  bottom-aligned, white).
- keyDown carries `userDesiredState`; not needed.
