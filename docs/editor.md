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
  readouts, labels, sublabels, the state bar (on, off, armed) and the separator (the readout
  colour until set; ↺ goes back to it). Labels on automatic keys are drawn at size 40 where they
  fit, smaller for two lines; sublabels at 25. Bar and readout colours are measured from your
  icons at start-up (`master_battery` on/off/clear, `set_altimeter`); ↺ goes back to the measured
  value. Bar size and corners are fixed (corner 9.5). Saved in `settings.json` next to the
  profiles folder.
- **Pages**: tabs (the first is the main page; "● on dock" marks the page the dock shows), add,
  rename, reorder, delete, and "Show on dock". **Preview on dock** shows the profile being
  edited (saved or not) on the dock, with the preview values, cut off from the sim even when its
  aircraft is loaded: presses on the dock never reach the sim (the round buttons page, keypads
  open). Edits and the page you pick follow on the dock; keys not finished yet are left off, with
  the reason. **Stop preview** goes back to the sim. To try presses against the sim, save and use
  the profile with preview off.
- **Dock picture**: drawn by the plugin itself, so it looks exactly like the dock. If the page is
  the one on the dock, keys show live sim values.
  - Click to select, Ctrl/Shift-click for several, drag to move/swap.
  - Ctrl+C / Ctrl+V copy and paste, also between pages and profiles. Delete removes.
- **Inspector** (right): everything about the selected key.
  - **Type** (key editor redesign, 2026-11-01, the user's schema in `key-editor-schema.md`):
    **Switch / toggle** (positions you can see; any number of them), **Button** (something you
    push), **Rotary** (a dimmer or knob over a range: tap steps, hold ramps), **Readout /
    annunciator** (shows the sim's value or a state), **Decorative** (looks only). Below it three
    foldable sections: **Gets its information from**, **Looks like**, **When pressed**, then
    Preview. Changing type keeps everything until you save (flip back and forth freely); settings
    the new type doesn't use are listed and removed at save. Choices another one covers are
    dimmed with the reason (e.g. the label under a PNG icon).
  - **Decorative**: label, icon, sublabel and face only, for panel titles or artwork; the
    information and press sections are hidden.
  - **State logic** (readouts; replaces Switch (armable)): steps checked top to bottom, the first
    with any of its conditions met decides the look (green, white, red, clear) and sublabel, else
    "otherwise". Any number of steps; "+ or" adds a condition with its own source and value;
    ↑ ↓ reorder. Faces and Preview are per step. Keys saved as Switch (armable) open as a readout
    with two steps.
  - **Positions / Per value** table: one row per sim value with its look, sublabel, the text shown
    instead of the number (readouts) and an icon for the whole key. **Fill from the SDK** fills it
    from the values the SDK lists for a simvar (e.g. transponder mode 0 off ... 4 alt);
    **Learn positions** records the values while you move the control in the cockpit, then Done.
    A switch with no press yet gets a cycle through what was found.
  - **ⓘ** next to a label explains it: hover for the text, click to keep it open.
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
  - **Revert changes** (under the key editor): the key back to how it was when last saved; dim
    while it has no changes. On an empty slot it brings back a key deleted since the save.
  - **On the key** (readouts and rotaries): **Show the value**, **Level bar** (rotaries: filled
    by the value between the step's minimum and maximum, in the state bar's place), **State bar** (coloured by the
    look per value, e.g. a COM receive readout: label, OFF sublabel, green bar) and
    **Separator** (a line under the label). Dimmed when the key has a custom face, which has its
    own layers.
  - **On the key** on switches, buttons and decorative keys: **Separator**, a line under the label
    (dimmed when a PNG icon fills the key or the key has a custom face).
  - **Value**: decimals / padding, show as, **Unit before / after** (e.g. QNH, %, RPM).
  - Step actions: **Wrap at the ends**. A dimmer is a Rotary: tap steps, hold repeats a smaller
    step ("Repeat while held", ms), counting from the value it last sent.
  - **Sim paused** (a Source choice): 1 in any pause (pause key, active pause, menu), else 0;
    unknown until the first pause change after the plugin connects.
  - **Dock stopwatch** (a Source choice): name (keys with the same name share one) and what to show
    (elapsed time, or running 1 / 0). **Stopwatch control** (an action): start / stop, reset,
    start, stop; the whole stopwatch on one key is tap start / stop, hold stop then reset. The library has a ready group: time, start/stop, reset.
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
  - **When pressed**: toggle / cycle, step (min / max, wrap), set, hold a position while pressed
    (spring-loaded, with release value and repeat), a sim event, a keyboard shortcut, a keypad or
    a stopwatch control. **+ then** adds another action done after it (e.g. two softkeys).
    **Something else when held**: a tap and a hold do different things. A tap acts when you let
    go before the hold time (400 ms unless changed, "Hold for, ms"); the hold acts at the hold
    time, so the two never both happen. A hold action can repeat while held. Without a hold
    action a press acts at once. **Acts on** chooses what toggle / step / hold / set change: an
    input event (a cockpit control), or a **simvar written directly** (Browse, unit, and **Set**
    to write a value once and read it back: "kept" or "the sim did not keep it"). Simvars marked
    [settable] in Browse are the ones the SDK says can be set. **Sends ×** scales the value sent
    for controls set in other units than they read (DA62 panel light: reads 0-100, set 0-1,
    so 0.01); set it on both the tap and the hold.
  - **Face (optional)**: design the key's look yourself from layers drawn in order: a library
    icon (cropped to its content or whole, fitted into a box you place), your own text, live
    values (the key's own, or each from its own source), a state bar (green / red / outline) and
    coloured boxes, and the sublabel (a Sublabel layer shows the key's sublabel for its current
    value or step). A Sublabel layer can also have its own source, like a live value: text per value of that
    source, plus text for other values. A State bar layer either follows the key's state or always shows green, white,
    red or clear ("shows"), e.g. a different bar on each per-value face of a readout. Every new face includes one, placed where drawn tiles put it; the designer
    shows "SUBLABEL" there until the key has one, so it can be moved. Typing a sublabel adds the
    layer to an older face that lacks it. **Level bar** layer: a bar filled by the value, across or upright (direction: fills left to
    right, right to left, bottom to top, top to bottom; turning it upright moves it to the key's
    right edge), "empty at" / "full at", fill and outline colours, the key's value or its own
    source, and optional colour bands ("+ colour band": below or above a value, e.g. yellow below
    25, red below 10). "+ face for a value" adds a separate face shown for one sim value (e.g. per
    switch position). Drag on the big preview to move
    the selected layer, or type positions (key units 0-144). **↔ centre** / **↕ centre** on each
    layer put it in the middle of the key. Icon layers have a **scale** (% of the key's width; the
    icon's box keeps its shape and centre) instead of width and height. Use it to put a PNG above a readout,
    or make a clean text-only key when the library has no suitable PNG. "Remove custom face" goes
    back to the automatic look.
  - Preview value: type a value to see that look.
  - Advanced: the key as JSON.
  - An empty key shows **Add key** (and Paste when something is copied).
- **Library** (top of the right column, beside the dock picture, so keys drag straight across;
  its list scrolls on its own): reusable keys and groups of keys, searchable, by category. It ships with every key
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

A save is refused, with the reason, until every key has what its type needs: a switch, button or
rotary something to do when pressed; a readout a source or state logic; a decorative key something
on its face (label, icon, sublabel or face). The plugin also refuses invalid profiles (e.g. an event
with no name). The file on disk is unchanged until it saves cleanly. Settings the key's type
doesn't use are removed at save.
