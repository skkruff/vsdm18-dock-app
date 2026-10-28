# Phase 2 test: the switchboard on the dock (Windows PC)

## Install

1. Download the latest ZIP from GitHub, open a Command Prompt in the project folder.
2. `npm run setup`
3. Quit VSD Craft completely (tray icon, Exit).
4. `npm run deploy`
5. Start VSD Craft. Your existing page with **Switchboard Slot** on all 15 keys and 3 round
   buttons is reused; nothing to redo. (If a key has lost the action, drag it back on.)

Settings live in `config.json` in the deployed plugin folder
(`%APPDATA%\HotSpot\StreamDock\plugins\com.m18switchboard.msfs.sdPlugin`). Defaults: your
icon folder on D:, theme `RGB`, page announcements on. Change `"theme"` to `"B_C18"` for navy, or
`"announcePages"` to `false`, then restart VSD Craft. Redeploying keeps your config.json.

## Checks

Note anything that looks wrong; a photo helps.

1. **Before MSFS starts:** the centre key says "MSFS not connected", the rest are dark.
2. **Start MSFS 2024**, load the C172 G1000 cold and dark. While it loads the centre key says
   "Loading aircraft". Then the main page appears and briefly shows the title "Main".
3. **State follows the cockpit:** flip switches in the cockpit with the mouse. The matching keys
   change within a moment.
4. **Keys work the cockpit:** press each key on the top two rows and the fuel pump. The cockpit
   switch moves, and the key changes once it has.
5. **Magnetos:** ◀ MAG and MAG ▶ step the key OFF / R / L / BOTH, and MAGS shows the position.
   MAG ▶ does nothing at BOTH. Hold START: the engine cranks and START lights; let go: back to
   BOTH. (The hold is the one action not yet tried against the sim.)
6. **Pages:** right round button -> "Auxiliary" (COM1, COM1 STBY, SWAP, QNH, XPDR, pitot heat,
   fuel selector). Try the swap and fuel selector. Left round button goes back, the middle one
   always returns to Main.
7. **Announcements:** do the page names flashing on the keys help or annoy?
8. **Other aircraft:** end the flight and pick another aircraft (e.g. the Caravan). The dock
   should switch to the generic page and announce "NO PROFILE".
9. **Restarts:** quit MSFS: the dock returns to "MSFS not connected". Restart VSD Craft with MSFS
   running: the keys come back with the right states.

## Send back

- The plugin log: `%APPDATA%\HotSpot\StreamDock\plugins\com.m18switchboard.msfs.sdPlugin\logs\<date>.log`
- What didn't work, and your view on announcements and the look of the keys.

If the dock stays on "MSFS not connected" with MSFS running, the log will say why. The most
likely cause is the SimConnect library not running on VSD Craft's older Node version.
