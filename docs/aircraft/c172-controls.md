# C172 SP G1000 (MSFS 2024): cockpit control inventory

Sources: the user's cockpit screenshot (2026-10-27), Phase 1 spike (2026-10-27) and the explorer
run (2026-10-28, user's control order in the log review). Full input event list:
`c172-g1000-input-events.txt` (233 events).

Principle (user): cover the controls actually in the cockpit, laid out like the panel where
possible, thorough but judicious (15 display keys). Ask the user when a control's importance is
unclear.

## How to drive the C172

**Input events are the primary interface** for this aircraft. Every switch the user worked was
reported live, `d` (full re-read) found nothing missed, and setting the avionics bus input
events moved the cockpit switches both ways. The classic simvars/events from the brief also work
for the switches they cover, but not for the avionics buses.

Values are numbers. Positions below come from the order the user worked each control.

## Main page candidates

| Control | Input event | Values | Notes |
|---|---|---|---|
| Standby battery | ELECTRICAL_BATTERY_STBY_2 | 0 ARM, 1 OFF, 2 TEST (springs back to 1) | Plan: ARM/OFF toggle |
| Master ALT | ELECTRICAL_ALTERNATOR_1 | 0 off, 1 on | also GENERAL ENG MASTER ALTERNATOR:1 / TOGGLE_MASTER_ALTERNATOR |
| Master BAT | ELECTRICAL_BATTERY_1 | 0 off, 1 on | also ELECTRICAL MASTER BATTERY / TOGGLE_MASTER_BATTERY |
| Avionics bus 1 | ELECTRICAL_LINE_BUS_1_TO_AVIONICS_BUS_1 | 0 off, 1 on | set verified both ways. Classic AVIONICS_MASTER does **not** work |
| Avionics bus 2 | ELECTRICAL_LINE_BUS_2_TO_AVIONICS_BUS_2 | 0 off, 1 on | set verified both ways |
| Beacon | LIGHTING_BEACON_1 | 0 / 1 | also LIGHT BEACON / TOGGLE_BEACON_LIGHTS |
| Landing | LIGHTING_LANDING_1 | 0 / 1 | also LIGHT LANDING / LANDING_LIGHTS_TOGGLE |
| Taxi | LIGHTING_TAXI_1 | 0 / 1 | also LIGHT TAXI / TOGGLE_TAXI_LIGHTS |
| Nav | LIGHTING_NAV_0 | 0 / 1 | also LIGHT NAV / TOGGLE_NAV_LIGHTS |
| Strobe | LIGHTING_STROBE_0 | 0 / 1 | also LIGHT STROBE / STROBES_TOGGLE |
| Fuel pump | FUEL_PUMP_1 | 0 / 1 | |
| Pitot heat | DEICE_PITOT_1 | 0 / 1 | also PITOT HEAT SWITCH / PITOT_HEAT_TOGGLE |
| Magnetos | ENGINE_MAGNETO_1 | 0 OFF, 1 R, 2 L, 3 BOTH, 4 START (springs back to 3) | design in `../design-notes.md`. Holding START from the dock (set 4 on key down, 3 on key up) still to test |
| Fuel selector | FUEL_SELECTOR_1 | 0 LEFT, 1 BOTH, 2 RIGHT | user: placement to decide |

Only "set" has been verified on the avionics buses; the other input events have been verified
as readable and live-reported, not yet set from the script.

## Lighting page

| Knob | Input event | Seen |
|---|---|---|
| Glareshield (SW/CB panels) | LIGHTING_PANEL_1 | steps of 5 from 0 |
| Standby indicator | LIGHTING_PANEL_2 | steps of 5 from 0 |
| Pedestal | LIGHTING_PEDESTRAL_1 (sic) | steps of about 5 from 0 |
| Avionics | LIGHTING_POTENTIOMETER_5 | starts at 10, steps of 5 |

Range assumed 0-100 (not yet confirmed).

## Autopilot page

G1000 keys exist as input events, e.g. AS1000_AUTOPILOT_AP_PFD, _FD_, _HEADING_, _ALTITUDE_,
_NAVIGATION_, _APPROACH_, _BACKCOURSE_, _VERTICALSPEED_, _FLIGHTLEVELCHANGE_,
_VERTICAL_NAVIGATION_, VERTICALSPEED_UP/DOWN; knobs AS1000_HEADING_PFD, AS1000_ALTITUDE_INNER/
OUTER_PFD. These are momentary buttons: their lit state will come from autopilot simvars. To work
out in the autopilot phase.

## Readouts (verified 2026-10-27)

| Readout | Variable | Notes |
|---|---|---|
| QNH | KOHLSMAN SETTING MB:1, millibars | e.g. 1013.25; display rounded to whole hPa |
| COM1 active / standby | COM ACTIVE/STANDBY FREQUENCY:1, MHz | e.g. 124.655 (8.33 kHz steps); 3 decimals |
| Transponder | TRANSPONDER CODE:1, number | plain decimal (1200), not BCD |

## Left out (user decision, 2026-10-27)

- Cabin power 12V (ELECTRICAL_ELECTRICAL_SWITCH_POWER12V): passenger power outlets.
- Alternate static air (SAFETY_ALTERNATE_STATIC_AIR): never used in practice.

## Not yet placed

Fuel shutoff (FUEL_VALVE_SHUTOFFVALVE), parking brake (LANDING_GEAR_PARKINGBRAKE), flaps
(HANDLING_FLAPS), trim, mixture: available as input events. Ask the user before placing.
