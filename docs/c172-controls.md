# C172 SP G1000 (MSFS 2024): cockpit control inventory

Source: the user's cockpit screenshot (2026-10-27). Principle (user, 2026-10-27): profiles cover
the switches actually in the cockpit, comprehensively, laid out like the panel where possible,
not just the ones named in the brief.

Status: **verified** = moved and read back by script in MSFS 2024; **broken** = tested, did not
work; **to find** = not yet tested, explorer run needed.

## Main page candidates (flight-critical)

| Control | Panel position | Positions | Status |
|---|---|---|---|
| Standby battery | top left | OFF / ARM / TEST (spring-loaded) | to find. Plan: ARM/OFF toggle only, TEST not modelled for now |
| Master ALT | split master, left half | off / on | verified: GENERAL ENG MASTER ALTERNATOR:1 + TOGGLE_MASTER_ALTERNATOR |
| Master BAT | split master, right half | off / on | verified: ELECTRICAL MASTER BATTERY + TOGGLE_MASTER_BATTERY |
| Avionics bus 1 | avionics rocker, left | off / on | **broken** via AVIONICS MASTER SWITCH / AVIONICS_MASTER_SET (var follows the event, cockpit switch does not, and the switch does not move the var). To find, likely an input event |
| Avionics bus 2 | avionics rocker, right | off / on | **broken**, as above |
| Beacon | lights row | off / on | verified: LIGHT BEACON + TOGGLE_BEACON_LIGHTS |
| Landing | lights row | off / on | verified: LIGHT LANDING + LANDING_LIGHTS_TOGGLE |
| Taxi | lights row | off / on | verified: LIGHT TAXI + TOGGLE_TAXI_LIGHTS |
| Nav | lights row | off / on | verified: LIGHT NAV + TOGGLE_NAV_LIGHTS |
| Strobe | lights row | off / on | verified: LIGHT STROBE + STROBES_TOGGLE |
| Fuel pump | lower row, left | off / on | to find |
| Pitot heat | lower row | off / on | verified: PITOT HEAT SWITCH + PITOT_HEAT_TOGGLE |
| Cabin power 12V | lower row, right | off / on | to find |
| Magnetos / ignition | key, bottom left | OFF / R / L / BOTH / START | to find (multi-state) |
| Alternate static air | red pull knob, bottom right | in / out | to find |

## Lighting page (not flight-critical, user's suggestion)

Dimming knobs: SW/CB PANELS, STBY IND, PEDESTAL, AVIONICS. Probably plus/minus key pairs or
preset levels. To find.

## Autopilot page (G1000 keys next to the PFD)

AP, FD, HDG, ALT, NAV, VNV, APR, BC, VS, FLC, NOSE UP, NOSE DN; HDG and ALT knobs. To find.

## Readouts (verified 2026-10-27)

| Readout | Variable | Notes |
|---|---|---|
| QNH | KOHLSMAN SETTING MB:1, millibars | e.g. 1013.25; display rounded to whole hPa |
| COM1 active / standby | COM ACTIVE/STANDBY FREQUENCY:1, MHz | e.g. 124.655 (8.33 kHz steps); 3 decimals |
| Transponder | TRANSPONDER CODE:1, number | plain decimal (1200), not BCD |

## Not yet placed

Fuel selector and shutoff, parking brake, flaps, trim, mixture: outside the screenshot. Decide
after the explorer run whether any belong on the dock.
