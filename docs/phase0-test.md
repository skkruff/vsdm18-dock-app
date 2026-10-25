# Phase 0 hardware test (on the Windows PC)

Needs Node.js 20 or newer installed (only for the setup/deploy scripts; the plugin itself runs
on Stream Dock's built-in Node).

1. In the project folder: `npm run setup`
2. Quit Stream Dock completely (tray icon too).
3. `npm run deploy`
4. Start Stream Dock. Look for the **MSFS Switchboard** category in the action list.
5. Make a fresh page and drag **Switchboard Slot** onto **every** key, including the three
   plain buttons if the software lets you.
6. Each LCD key should show `r<row> c<col>` and `slot <n>` with a red border at the very edge.
7. Press each key a few times. Every press advances that key one test:
   1. coordinates (SVG image)
   2. test card (base64 PNG): red edge border, green cross, four coloured quadrants
   3. black key with title text "TITLE / 2 lines" (setTitle)
   4. "QNH 1013" readout drawn as SVG
   5. setState(1) (expected to do nothing visible: only one state is defined)
   then it loops.
8. Press each of the three plain buttons once.

## What to report back

- A photo of the dock after step 6.
- For the test card: is the red border visible on all four sides? Are the quadrants square?
- Which tests showed nothing, or something wrong.
- The log file: `%APPDATA%\HotSpot\StreamDock\plugins\com.m18switchboard.msfs.sdPlugin\logs\<date>.log`
  (it records the device size, every key's coordinates, and whether the plain buttons send
  key events at all).

If the category does not appear, check the Stream Dock version (needs >= 3.10.188.226) and send
whatever is in the `logs` folder, if anything.
