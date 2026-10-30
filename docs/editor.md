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
- **Look**: the font of all drawn text (7 bundled condensed fonts, default Barlow Condensed Bold;
  text is drawn as shapes, so it looks the same in the editor and on the dock) and the colours of
  readouts, labels, sublabels and the state bar (on, off, armed). Bar and readout colours are measured from your
  icons at start-up (`master_battery` on/off/clear, `set_altimeter`); ↺ goes back to the measured
  value. Bar size and corners are fixed (corner 9.5). Saved in `settings.json` next to the
  profiles folder.
- **Pages**: tabs (the first is the main page; "● on dock" marks the page the dock shows), add,
  rename, reorder, delete, and "Show on dock".
- **Dock picture**: drawn by the plugin itself, so it looks exactly like the dock. If the page is
  the one on the dock, keys show live sim values.
  - Click to select, Ctrl/Shift-click for several, drag to move/swap.
  - Ctrl+C / Ctrl+V copy and paste, also between pages and profiles. Delete removes.
- **Inspector** (right): everything about the selected key.
  - Type: switch (on/off look), switch (armable), readout (live value), button, decorative.
  - **Decorative (no function)**: label, icon, sublabel and face only, for panel titles or
    artwork. Choosing it removes the key's source, press action and per-value settings (after a
    confirm), and the inspector hides those sections.
  - **Switch (armable)**: for autopilot modes that arm before they engage. Instead of "Reads from
    the sim" and "Look per value" it shows the look as three numbered steps checked top to bottom:
    1 green (active) when a source is a value, 2 otherwise white (armed) when a second source is a
    value, 3 otherwise clear or off. "+ or" under a step adds another source; any one of them is
    enough (e.g. green on ILS capture or GPS approach active). Sublabels and faces are per step;
    Preview picks a step.
  - **ⓘ** next to a label explains it: hover for the text, click to keep it open. So far on the
    armable key and "Acts on"; more to follow.
  - Label and icon (picker shows your library; switch icons use their on/off/clear versions).
  - Source: an input event or a simvar and unit.
    - **Learn**: click it, then move the control in the cockpit. If several controls change at
      once, you choose which one from the list.
    - **Browse…** (input events): every input event of the loaded aircraft with its current value,
      searchable.
    - **Browse…** (simvars): every simvar in the MSFS 2024 SDK (about 1,700) by category with
      descriptions and units, common ones first (★), searchable ("nav1", "fuel", "heading"); **Test** reads one from the sim to check this
      aircraft has it. Any other name (also L:vars) can be typed in.
  - Sim events for presses: **Browse…** lists every key event in the MSFS 2024 SDK (about 2,100,
    common ones first) with what value it takes; **Send** fires one now so
    you can see what it does.
  - Look per value (switch), icon per value (e.g. the magneto icons).
  - **Sublabel** (any key type): a smaller line under the label, either fixed or per sim value
    (e.g. ARM / OFF on the standby battery). A per-value sublabel wins; the fixed one covers the
    rest.
  - Value text per value (readouts): a word instead of the number (e.g. magneto 3 -> BOTH).
  - Decimals / padding for readouts; **Unit before / after** (e.g. QNH, %, RPM) and a
    **Separator** line under the label (or a Separator layer in a custom face).
  - Step actions: **Wrap at the ends**, and **Hold to ramp** (tap steps once, hold keeps
    stepping by "Ramp step"): one key can run a dimmer.
  - **Dock stopwatch** (a Source choice): name (keys with the same name share one) and what to show
    (elapsed time, or running 1 / 0). **Stopwatch control** (an action): start / stop,
    **start / stop; hold to reset** (the whole stopwatch on one key), reset, start, stop. The library has a ready group: time, start/stop, reset.
  - **Open a keypad** (an action): a preset (transponder code, COM1/2 or NAV1/2 standby; guessed
    from what the key reads) or your own (digits, decimals, 0-7 only, set when all digits are in,
    and the event, simvar or input event it sets, as a number times a factor or as BCD).
    "Show the keypad on the dock picture" previews it. The library has XPDR and COM / NAV standby
    keys with keypads, for any aircraft. **Sends the value**: the event, simvar or input event it
    sets and how (number times a factor, or BCD), shown for presets too and changeable, with
    "Back to the preset's pathway"; **Try it** sends some digits now, as ENT would.
- **Keypad (all keypads)** tab, after the page tabs: the one keypad layout every keypad uses, laid
  out on the dock picture like a page. Each key is a **Keypad key** with a role (digit, ENT, DEL,
  CLR, CANCEL, VFR, title, value now, digits typed) and the usual label, sublabel, icon and face.
  On a transponder keypad the 9 key is VFR (sets the VFR code, 1200 unless the keypad key says
  e.g. 7000); untick "VFR on transponders" on the 9 to keep it a plain 9.
  Save stores it for all profiles (`keypad.json`); "Reset to built-in" goes back. Missing digits
  or ENT are listed as warnings.
  - **Press a keyboard shortcut**: type it ("Ctrl+Shift+L") or click **Record** and press it;
    "While held" keeps the keys down while the dock key is held; "Bring MSFS to the front" (on by
    default) makes sure the keys go to the sim. **Send now** tries it. Shortcuts the browser keeps
    (Ctrl+W, Ctrl+T, Ctrl+N) can't be recorded: type them.
  - When pressed: toggle/cycle, step (with min/max), hold (with release value and repeat for
    spring-loaded positions), set, or a sim event. **Acts on** chooses what toggle / step / hold /
    set change: an input event (a cockpit control), or a **simvar written directly** (Browse,
    unit, and **Set** to write a value once and read it back: "kept" or "the sim did not keep
    it"). Simvars marked [settable] in Browse are the ones the SDK says can be set.
  - **Face (optional)**: design the key's look yourself from layers drawn in order: a library
    icon (cropped to its content or whole, fitted into a box you place), your own text, live
    values (the key's own, or each from its own source), a state bar (green / red / outline) and
    coloured boxes, and the sublabel (a Sublabel layer shows the key's sublabel for its current
    value or step). A Sublabel layer can also have its own source, like a live value: text per value of that
    source, plus text for other values. A State bar layer either follows the key's state or always shows green, white,
    red or clear ("shows"), e.g. a different bar on each per-value face of a readout. Every new face includes one, placed where drawn tiles put it; the designer
    shows "SUBLABEL" there until the key has one, so it can be moved. Typing a sublabel adds the
    layer to an older face that lacks it. "+ face for a value" adds a separate face shown for one sim value (e.g. per
    switch position). Drag on the big preview to move
    the selected layer, or type positions (key units 0-144). Use it to put a PNG above a readout,
    or make a clean text-only key when the library has no suitable PNG. "Remove custom face" goes
    back to the automatic look.
  - Preview value: type a value to see that look.
  - Advanced: the key as JSON.
  - An empty key shows **Add key** (and Paste when something is copied).
- **Library**: reusable keys and groups of keys, searchable, by category. It ships with every key
  built so far (each C172 and generic key, plus groups: magneto set, fuel selector, exterior
  lights row). Save any key or selection with "Save to library": a name, and a category from the
  list of existing ones or "New category…". **Groups** fills itself: every item of more than one
  key appears there as well as in its own category, so it can't be chosen when saving. To use an
  item, drag it onto the dock picture (dashed outlines show every key it will land on: yellow for
  empty, orange for a key it replaces; keys that would fall off the panel are counted under the
  picture), or click the target key and press Insert (groups go in with their top-left key there).
  If the item works one input event the loaded aircraft doesn't have, you can choose this
  aircraft's equivalent from its list, or keep it. Simvars are the same in every aircraft and are
  never asked about. Deleting a shipped item keeps it deleted; new shipped items arrive with updates.
  The library is `library.json` next to the profiles folder.

## Saving rules

A save is refused, with the reason, if the profile is invalid (e.g. a switch with no source). The
file on disk is unchanged until it saves cleanly.
