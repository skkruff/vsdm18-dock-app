# Switchboard editor

A web page served by the plugin while VSD Craft runs. Open it with
**http://localhost:8765/** in your browser, or **hold the middle round button for 1.5 s**.

It edits the profile files in your profile folder (default
`Documents\MSFS Switchboard\profiles`; the editor's header shows the profile in use, and the
plugin log shows the folder). Saving updates the dock within a second. Redeploying the plugin
never touches this folder: shipped profiles are copied in only when you don't have them yet.

## The screen

- **Header**: profile picker, New / Duplicate / Delete (keeps a `.bak`), Save (Ctrl+S), sim status
  and which profile the dock is using.
- **Profile settings**: ID, name, the two announcement lines shown when the aircraft loads, and
  what the profile matches. "Use the aircraft loaded now" fills in the aircraft's folder name.
  "Preview announcement" shows it on the dock picture.
- **Pages**: tabs (the first is the main page; "● on dock" marks the page the dock shows), add,
  rename, reorder, delete, and "Show on dock".
- **Dock picture**: drawn by the plugin itself, so it looks exactly like the dock. If the page is
  the one on the dock, keys show live sim values.
  - Click to select, Ctrl/Shift-click for several, drag to move/swap.
  - Ctrl+C / Ctrl+V copy and paste, also between pages and profiles. Delete removes.
- **Inspector** (right): everything about the selected key.
  - Type: switch (on/off look), readout (live value), button.
  - Label and icon (picker shows your library; switch icons use their on/off/clear versions).
  - Source: an input event (with **Learn**: click it, then move the control in the cockpit) or a
    simvar and unit.
  - Look per value (switch), text per value, icon per value (e.g. the magneto icons).
  - Decimals / padding for readouts.
  - When pressed: toggle/cycle, step (with min/max), hold (with release value and repeat for
    spring-loaded positions), set, or a sim event.
  - Preview value: type a value to see that look.
  - Advanced: the key as JSON.
- **Presets**: groups of keys you can drop into any profile. Select keys, "Save selected keys as
  preset". To insert, click where its top-left key should go, then "Insert". If the preset reads
  one source, you're asked whether this aircraft uses a different one. A **Magneto set** preset
  ships with the plugin.

## Saving rules

A save is refused, with the reason, if the profile is invalid (e.g. a switch with no source). The
file on disk is unchanged until it saves cleanly.
