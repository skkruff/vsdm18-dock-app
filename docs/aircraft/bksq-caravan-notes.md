# Black Square Caravan Professional (Cargo Pod): first look

Explorer run 2026-10-28. Identity: TITLE `Black Square Caravan Professional Cargo Pod N2500A`,
ATC MODEL `ATCCOM.AC_MODEL C208.0.text`, path
`SimObjects\Airplanes\bksq-aircraft-caravanprocargopod\aircraft.CFG`. 121 input events
(`bksq-caravan-input-events.txt`).

## Reported by input events

| Control | Input event | Seen |
|---|---|---|
| Battery | ELECTRICAL_BATTERY_1 | 0 / 1 |
| Ignition (ON / NORM) | ENGINE_IGNITION_1 | 1 ON, 0 NORM |
| Starter (START / OFF / MOTOR) | ENGINE_STARTER_IGNITION_1 | 0, 1, 2 seen; initial 1. Mapping to positions not yet certain |
| Avionics 1 / 2 | ELECTRICAL_AVIONICS_BUS_1 / _2 | 0 / 1 |
| Left / right landing | LIGHTING_LANDING_1 / LIGHTING_LANDING_2 | 0 / 1 |
| Taxi | LIGHTING_TAXI_1 | 0 / 1 |
| Strobe, nav, beacon | LIGHTING_STROBE_1, LIGHTING_NAV_1, LIGHTING_BEACON_1 | 0 / 1 |
| Wing (ice) light | LIGHTING_WING_1 | 0 / 1 |
| Air / environmental levers | PASSENGER_CABIN_AIR_3, _4, _5 | 0-100, animated |

## Not reported at all

Generator reset/trip, fuel boost, no smoking and seatbelt signs, pitot heat, windshield and prop
anti-ice, boot press, all dimmers, annunciator test, fire detect test, most environmental
controls. `d` (full re-read) also found nothing, so these are not input events at all.

Interpretation (assumed): Black Square's own systems keep their state in L:vars and take
commands through their own events, which input events do not cover. Phase 5 will need another
way in: candidates are reading/writing L:vars through SimConnect (to check whether MSFS 2024
allows `L:` names in data definitions), the MobiFlight WASM module, or the AAO WebAPI. MSFS
developer mode's Behaviors window shows which L:var a cockpit control uses.
