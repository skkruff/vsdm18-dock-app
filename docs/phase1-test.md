# Phase 1 sim link test (on the Windows PC)

Checks that we can talk to MSFS 2024, see which aircraft is loaded, read the C172's switches and
radios, and move switches by sending events. No dock involved.

## Steps

1. Get the latest project from GitHub (Code > Download ZIP) and unzip it over, or next to, your
   old copy. Open a Command Prompt in the folder that contains `package.json` (address bar,
   type `cmd`, Enter).
2. `npm run setup` (needed again: it installs the new SimConnect library).
3. Start MSFS 2024 and load into a flight with the default **Cessna 172**, cold and dark or
   engine running, either is fine. Wait until you are in the cockpit.
4. `npm run sim:spike`

## What should happen

- `CONNECTED to ...` with the sim's version, then an `AIRCRAFT title="..." atcModel="..."` line.
- A `VALUE` line for every switch and readout with its current state.
- After about 3 seconds the script flips the **landing light** on its own, and flips it back
  3 seconds later. Watch the switch in the cockpit. Each flip prints a `RESULT OK ...` or
  `RESULT FAIL ...` line.
- Flip switches in the cockpit with the mouse: each one should print a `CHANGE` line.
- Change the altimeter setting, COM1 standby frequency and transponder code in the cockpit:
  each should print a `CHANGE` line.

Then, with the Command Prompt window focused (click on it first):

- Press **1** to **9** one at a time, a couple of seconds apart. Each sends one event:
  1 battery, 2 alternator, 3 avionics, 4 beacon, 5 landing, 6 taxi, 7 nav, 8 strobe,
  9 pitot heat. Watch whether the cockpit switch moves, and read the `RESULT` line.
- Press **r** to re-read every value once.
- If you have time: switch to a different aircraft in the sim (or go back to the menu and load
  another), and watch for new `AIRCRAFT` lines.
- Press **q** to quit. It prints a summary.

If it says `Could not connect`, it keeps retrying every 5 seconds; start MSFS or wait for it to
finish loading. Ctrl+C also quits.

## What to report back

- The log file: `logs\sim-spike-<date>.log` inside the project folder.
- Anything where the cockpit disagreed with the script, for example a switch that moved but
  the script said FAIL, or a switch that moved the wrong thing.
