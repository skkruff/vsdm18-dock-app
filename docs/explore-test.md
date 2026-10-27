# Cockpit discovery run (on the Windows PC)

Finds the names MSFS uses for every cockpit control of the loaded aircraft, and how to drive
the ones the classic events could not (the C172's avionics bus switches first).

## Steps

1. Download the latest ZIP from GitHub and open a Command Prompt in the project folder as before.
   Run `npm run setup` once (cheap if nothing changed).
2. Start MSFS 2024, load the default **C172 G1000**, cold and dark, and wait for the cockpit.
3. `npm run sim:explore`
   It prints `INPUT EVENTS <n> found, list written to ...` and `Ready.`
4. **Work every cockpit control once, one at a time, about 3 seconds apart**, saying nothing
   to the script. Do them in a fixed order and jot the order down, for example:
   standby battery (to ARM, then back to OFF), master ALT, master BAT, avionics bus 1, avionics
   bus 2, beacon, land, taxi, nav, strobe, fuel pump, pitot heat, each dimmer knob (turn a
   little), then the magneto key through every position: OFF, R, L, BOTH, and hold START for
   about two seconds before letting it spring back.
   Each should print one or more `INPUT ...` lines.
5. Type `d` and press Enter. It re-reads everything and shows any control that changed but
   was not reported live. (Tells us whether live reporting can be trusted.)
6. Try driving an avionics bus. First see what it is called:
   `list avionics`
   Then pick the name that looks like bus 1 and set it, for example:
   `set ELECTRICAL_Avionics_Bus_1 1` (use the real name from the list)
   Watch the cockpit switch, then set it back to 0. Do the same for bus 2.
7. `q` to quit.

## Send back

- `logs\sim-explore-<date>.log`
- `logs\input-events-<aircraft>.txt` (the full list of controls)
- The order you worked the controls in, and anything you noticed (a control that printed
  nothing, a `set` that did not move the switch).

If you want to go further, the same run works in any aircraft. A run in the Black Square
Caravan or Baron would already tell us a lot about Phase 5.
