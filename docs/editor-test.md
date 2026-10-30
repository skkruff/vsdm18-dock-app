# Checklist after an update (Windows PC)

Install as usual: download the ZIP, `npm run setup`, quit VSD Craft, `npm run deploy`, start VSD
Craft, and Ctrl+F5 in the editor. Your profiles, library, settings, keypad layout and stopwatches
in Documents are kept. The history of what was tested when is in `verified.md`.

A quick pass, in the C172 G1000, to catch regressions. Anything that fails: note it with the
plugin log (`logs\` in the plugin folder).

## Dock

1. **Start-up**: "MSFS / NOT CONNECTED" sways until the sim runs; loading the aircraft announces
   "C172 / G1000" across the keys, then the Primary page shows.
2. **Switches** (Primary): BAT, ALT, lights, fuel pump follow the cockpit both ways (press on the
   dock, and flip in the cockpit). Magnetos step and stop at BOTH; START cranks while held.
3. **Pages**: the round buttons page back and forth; the middle one goes to the main page; holding
   it opens the editor.
4. **Radios**: swap keys swap; COM1 / COM2 audio keys follow the panel LEDs; the standby keys open
   their keypads and set the typed value; XPDR keypad: 8 and 9 dimmed, VFR sets 1200.
5. **Autopilot**: the buttons work the G1000's AP panel.
6. **Auxiliary**: QNH syncs on press; the time key shows local and Zulu; the stopwatch starts,
   stops, resets on a hold, and stands still in any pause; dimmers step on a tap, ramp on a hold;
   the flashlight shortcut toggles it (MSFS comes to the front).
7. **Restart**: quit and start VSD Craft with a stopwatch running; it carries on from its time.

## Editor

8. Edit a key, save: the dock updates within a second. A key's preview matches the dock.
9. Browse simvars and events (Test / Send), Learn an input event, the face designer, and the
   library (save, insert, drag a group: outlines show where it lands).
10. The Keypad tab shows the layout; Preview on a keypad key's settings draws it on the picture.
