# Phase 0 hardware test (on the Windows PC)

## One-time setup

### 1. Install Node.js

Node.js runs the setup and deploy scripts on your PC. (The plugin itself runs on Stream Dock's
own built-in copy of Node, so this is only for the scripts.)

1. Go to https://nodejs.org and download the **LTS** installer for Windows.
2. Run it and accept the defaults.

### 2. Get the project

1. On https://github.com/skkruff/vsdm18-dock-app click the green **Code** button, then
   **Download ZIP**.
2. Unzip it somewhere easy, for example `D:\MFS2024\Flight Sim Dock\vsdm18-dock-app`.
   Make sure you end up with a folder that directly contains `package.json`, not a folder inside
   a folder of the same name.

### 3. Open a command window in the project folder

1. Open the project folder in File Explorer (the one containing `package.json`).
2. Click once in the **address bar** at the top (where it shows the path), type `cmd` and press
   Enter.
3. A black **Command Prompt** window opens, already pointed at that folder. The line before the
   cursor shows the folder path.

Check Node is installed by typing this and pressing Enter:

```
node -v
```

It should print a version such as `v24.x.x`. If it says "not recognized", close the window,
reinstall Node, and open a fresh Command Prompt (windows opened before the install don't see it).

Why Command Prompt and not "Open in Terminal": the right-click Terminal opens PowerShell, which
on many PCs blocks `npm` with a "running scripts is disabled" error. Command Prompt avoids that.

## Running the test

Type each command into the Command Prompt and press Enter. Wait for each to finish (the
cursor line comes back) before the next.

1. `npm run setup`
   Downloads the one library the plugin needs and makes the test images. Expect a few lines
   ending in `icons written to ...`. Warnings in yellow are fine; red `ERR!` lines are not.
2. Quit Stream Dock completely: right-click its icon in the system tray (bottom right, near the
   clock, maybe under the `^` arrow) and choose Exit/Quit.
3. `npm run deploy`
   Copies the plugin into Stream Dock's plugin folder. Expect `Deployed to ...`.
4. Start Stream Dock. Look for the **MSFS Switchboard** category in the action list.
5. Make a fresh page and drag **Switchboard Slot** onto **every** key, including the three
   plain buttons if the software lets you.
6. Each LCD key should show `r<row> c<col>` and `slot <n>` with a red border at the very edge.
7. Press each key a few times. Every press advances that key one test:
   1. coordinates (SVG image)
   2. test card (PNG): red edge border, green cross, four coloured quadrants
   3. black key with title text "TITLE / 2 lines"
   4. "QNH 1013" readout
   5. a state change (probably nothing visible)
   then it loops.
8. Press each of the three plain buttons once.

## Icon index (any time)

In the same Command Prompt:

```
npm run icons:index -- "D:\MFS2024\Flight Sim Dock\Button Icon PNGs"
```

It writes `docs\icon-index.md` inside the project folder. Send that file over.

## What to report back

- A photo of the dock after step 6.
- For the test card: is the red border visible on all four sides? Are the quadrants square?
- Which tests showed nothing, or something wrong.
- The log file. Paste this into the File Explorer address bar to open its folder:
  `%APPDATA%\HotSpot\StreamDock\plugins\com.m18switchboard.msfs.sdPlugin\logs`
- Anything a command printed that looked like an error (copy the text or screenshot the window).

If the MSFS Switchboard category does not appear, check the Stream Dock version (needs
3.10.188.226 or newer, shown in its settings) and send whatever is in the `logs` folder.
