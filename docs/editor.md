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
- **Look**: the font of all drawn text (7 bundled condensed fonts; text is drawn as shapes, so it
  looks the same in the editor and on the dock) and the colours of readouts, labels and the state
  bar. Bar size, corners and colours, and the readout colour, are measured from your icons at
  start-up (`master_battery` on/off/clear, `set_altimeter`); ↺ goes back to the measured value.
  Saved in `settings.json` next to the profiles folder.
- **Pages**: tabs (the first is the main page; "● on dock" marks the page the dock shows), add,
  rename, reorder, delete, and "Show on dock".
- **Dock picture**: drawn by the plugin itself, so it looks exactly like the dock. If the page is
  the one on the dock, keys show live sim values.
  - Click to select, Ctrl/Shift-click for several, drag to move/swap.
  - Ctrl+C / Ctrl+V copy and paste, also between pages and profiles. Delete removes.
- **Inspector** (right): everything about the selected key.
  - Type: switch (on/off look), readout (live value), button.
  - Label and icon (picker shows your library; switch icons use their on/off/clear versions).
  - Source: an input event or a simvar and unit.
    - **Learn**: click it, then move the control in the cockpit. If several controls change at
      once, you choose which one from the list.
    - **Browse…** (input events): every input event of the loaded aircraft with its current value,
      searchable.
    - **Browse…** (simvars): about 120 common simvars by category with descriptions and units,
      searchable ("nav1", "fuel", "heading"); **Test** reads one from the sim to check this
      aircraft has it. Any other name (also L:vars) can be typed in.
  - Sim events for presses: **Browse…** lists about 80 common events; **Send** fires one now so
    you can see what it does.
  - Look per value (switch), text per value, icon per value (e.g. the magneto icons).
  - Decimals / padding for readouts.
  - When pressed: toggle/cycle, step (with min/max), hold (with release value and repeat for
    spring-loaded positions), set, or a sim event.
  - **Face (optional)**: design the key's look yourself from layers drawn in order: a library
    icon (cropped to its content or whole, fitted into a box you place), your own text, live
    values (the key's own, or each from its own source), a state bar (green / red / outline) and
    coloured boxes. "+ face for a value" adds a separate face shown for one sim value (e.g. per
    switch position). Drag on the big preview to move
    the selected layer, or type positions (key units 0-144). Use it to put a PNG above a readout,
    or make a clean text-only key when the library has no suitable PNG. "Remove custom face" goes
    back to the automatic look.
  - Preview value: type a value to see that look.
  - Advanced: the key as JSON.
- **Library**: reusable keys and groups of keys, searchable, by category. It ships with every key
  built so far (each C172 and generic key, plus groups: magneto set, fuel selector, exterior
  lights row). Save any key or selection with "Save to library" (name and category). To use one,
  drag it onto the dock picture, or click the target key and press Insert (groups go in with their
  top-left key there). If the item reads one source, you're asked whether this aircraft uses a
  different one. Deleting a shipped item keeps it deleted; new shipped items arrive with updates.
  The library is `library.json` next to the profiles folder.

## Saving rules

A save is refused, with the reason, if the profile is invalid (e.g. a switch with no source). The
file on disk is unchanged until it saves cleanly.
