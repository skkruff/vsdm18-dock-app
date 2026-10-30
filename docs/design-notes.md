# Design notes from the user

Ideas the user raised ahead of the phase they belong to. Check here when starting a phase.

## Magnetos / ignition key (raised 2026-10-27, for the C172 profile and similar)

Common form: rotary key OFF / R / L / BOTH / START, where START springs back to BOTH on release.
User's current idea: four keys side by side:

    [ mag left ] [ mag state ] [ mag right ] [ start ]

- "mag left" / "mag right" are steppers: one step anticlockwise / clockwise per press
  (confirmed by user 2026-10-27), so a run-up can cycle BOTH -> L -> BOTH -> R -> BOTH.
- "mag state" (between them) shows which magnetos are running: OFF, R, L, BOTH.
- "start" sits rightmost, like cranking the key fully right. Momentary: hold the dock key to
  crank, release to drop back to BOTH, mirroring the spring-loaded key.
- "mag right" stops at BOTH; only the START key cranks (user, 2026-10-28).

Engine needs this implies: actions on key down and key up separately (momentary keys), a
multi-state readout (5 positions), and step-style actions. To find in the sim: how the 2024 C172
models the key (input event with positions, or MAGNETO_* events) and how START is held.

## Standby battery (raised 2026-10-27)

OFF / ARM / TEST, TEST spring-loaded. Model as an ARM/OFF toggle for space; TEST maybe later.

## Cockpit lighting (raised 2026-10-27)

Dimmer knobs are not flight critical: put them on their own page.

## Decisions for the C172 profile (user, 2026-10-28)

- Main page:

      [STBY BATT] [  ALT  ] [  BAT  ] [ AVN 1 ] [ AVN 2 ]
      [   BCN   ] [ LAND  ] [ TAXI  ] [  NAV  ] [ STRB  ]
      [FUEL PUMP] [ ◀ MAG ] [  MAG  ] [ MAG ▶ ] [ START ]

- Pitot heat, COM1, QNH, transponder and fuel selector go on an "Auxiliary controls" page. On
  more complex aircraft anti-icing may need its own page; overkill for the C172.
- Page switching on the three round buttons: ◀ previous, main, next ▶. Same in every aircraft.
- Pages briefly announce their name when switched: on trial, user not sold yet. Must be easy to
  turn off (config `announcePages`). First version (title on every key) was too messy; now drawn
  large across the whole panel for `announceMs` (800 ms) before the keys appear (2026-10-28).
- Pitot heat dropped from the C172 for now (user, 2026-10-28).
- Icon theme: RGB by default, navy (B_C18) selectable in config.

## Raised 2026-10-28 (after the Phase 2 test)

- **Status messages** (not connected, loading) also drawn large across the panel. Done.
- **Transitions with some presentation** (animated page changes etc.): pinned for later.
- **Keys that are both readout and action**: QNH readout press = sync altimeter to current weather
  (user has this on the comma key). Done for the C172 with the BAROMETRIC event (unverified).
- **Keypad entry**: pressing the transponder or COM standby readout switches the dock to a keypad
  (digits, display of what's typed, ENT, back/CLR); ENT sets the value and returns to the page you
  came from. Built 2026-10-30 (`keypad.js`); the set-value events still to be checked in the sim.
- **Library icon + live value on one key**: top of the icon (its printed name) above the value.
  Done as `icon` on readouts; QNH uses `set_altimeter`. Depends on VSD Craft drawing an image
  embedded in an SVG: to check on the device.
- **Spring-loaded positions must hold while the dock key is held** (e.g. START): the sim drops
  START after a few seconds like a single click. Done as `repeatMs` (re-sends while held, like a
  "repeat input" binding); to check.
- **Editor**: the user wants to place/move keys, choose what they show and do, and pick icons from
  the library without describing changes in words. See the proposal in the conversation of
  2026-10-28 and its decision once made.
- Mag state could use library icons instead of text (user has some in mind).

## Decided 2026-10-28 (after the follow-up test)

- Panel-wide messages: draw on a canvas that includes the physical gaps (a quarter of a key);
  accept that bits of letters fall behind the bezels, make the text as big as fits. MSFS logo icon
  (`fs_logo_icon`) in the centre key of status and aircraft screens.
- Aircraft load: announce the aircraft (profile `banner`, e.g. C172 / G1000) for 2.5 s, not the main
  page name. No "loading" flash when an announcement is already showing. Page switches announce
  only the page name. A key press during an announcement just dismisses it.
- Magneto state key shows the library's magneto_off/right/left/both/start icons (`valueIcons`).
  It must be reusable in other profiles: shipped as the "Magneto set" preset.
- Icon + value on one key: crop to the icon's content and scale it into the top of the key.
- Editor approved (scope change from the brief). Profiles in Documents\MSFS Switchboard. Preview
  of how keys look is part of the editor.
- Pinned: transitions with some presentation.

## Raised 2026-10-28 (library and face designer)

- Everything built so far must be reusable when setting up new aircraft, and any key the user
  makes must be savable for reuse: the key library (shipped items + "Save to library").
- Optional per-key face designer: compose a library PNG (e.g. a "Barometer" icon) with a live
  readout, or plain text when no suitable PNG exists. Built as face layers.

## Raised 2026-10-28 (round 3)

- Drawn text must match the PNG icons' lettering (shape and weight): bundled condensed fonts,
  choosable in the Look panel; default Oswald Bold.
- Drawn state bars must match the PNG ones out of the box (size, corners, colours): measured from
  the user's icons.
- Default readout colour: sky blue like the line on set_altimeter (measured), not yellow.
- Faces per state/value; several live values (different simvars) on one key.
- Make creating new functions practical: searchable list of the aircraft's input events (with
  values), a way to find simvars (e.g. NAV1 frequency) without reading documentation, and a
  Learn that copes with several inputs firing at once.

## LED accent strip (asked 2026-10-28, not built)

- The plugin SDK (what VSD Craft gives plugins) has no LED or brightness control: nothing in the
  event docs or any template (checked 2026-10-28).
- MiraboxSpace/StreamDock-Device-SDK (C++, Python, and a ready-made WebSocket server) talks to the
  device directly over USB and lists the M18 with LED commands: whole-strip colour
  (`setLEDColor`), LED brightness 0-255, reset to default. Its Python source gives the M18
  `hasRGBLed = True`, 24 LEDs; per-LED colours appear not to be enabled for the M18.
- Unknown, must be tested before relying on it: whether it works while VSD Craft is running (both
  talk to the same USB device; VSD Craft may also overwrite the colour with its own effects).
- Possible uses: master caution / warning colour (stall, low fuel, low voltage), autopilot
  disconnect flash, parking brake set reminder, gear unsafe, colour per page or per aircraft,
  sim connected / disconnected.

## Editor help (ⓘ), 2026-10-29

The ⓘ mechanism is built (texts in `HELP` in `editor.js`); so far only on the armable key and
"Acts on". Polishing step: write help for the remaining key setup intricacies (hold repeat timings,
cycle vs set, sources vs Acts on, faces per value, crop auto/full).

## Stopwatch: build in the keypad phase (user, 2026-10-30) — built 2026-10-30

Agreed: a dock stopwatch, not the G1000's own timer (that would need PFD softkey sequences and
probably state hidden in the NXi's JavaScript, not L:vars). Build it in the keypad phase on the
same groundwork, **dock variables**: values the plugin keeps itself, readable by keys like a simvar
and changed by presses (the keypad needs the same for the digits being typed).
- Counts **sim time** (SIMULATION TIME / ABSOLUTE TIME): stops when the sim pauses, follows sim rate.
- Start/stop and reset presses; elapsed time as MM:SS (H:MM:SS past an hour). Count-down with a
  flash at zero is optional.
- **Must survive a plugin / VSD Craft restart** (user): persist its state (running, start, accumulated).
- Known limits: not shown on the PFD, separate from the G1000 timer.

## Keypad layout: finalise and lock (possible future task, user 2026-10-30)

The keypad's look is editable for now ("Keypad" tab in the editor, one layout for every keypad,
saved in keypad.json). Once the user has settled on a layout, it can become the built-in one and
the layout editing be locked away again. The functional configuration stays exposed: per keypad
key, the preset, title and especially the send pathway (event / simvar / input event, encoding,
scale), since the right pathway may differ per aircraft.

## Editor polish backlog (Phase 4b, user 2026-10-30)

Collected for the editor visual and quality-of-life pass after Phase 4. Add to it as friction
shows up.
- ⓘ help for the remaining key setup intricacies (see "Editor help" above).
- Editing library items in place ("Update the original" when re-saving keys inserted from it).
- Keypad layout: once settled, make it the built-in one and lock layout editing again; keep the
  functional settings (preset, title, send pathway) exposed (see "Keypad layout" above).
- A long inspector: group sections (look, source, press, preview) so they can be folded.
- Dimmers: a level bar on the key (width follows the value).
- "Press these in order" actions (G1000 softkey sequences, e.g. XPDR then ALT).
- Visual consistency: spacing, control sizes, dialogs, the dock picture's selection and drop marks.
