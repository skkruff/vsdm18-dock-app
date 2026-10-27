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
- Open detail: whether "mag right" may step from BOTH into START (probably not: START only from
  the start key, so a stray press can't crank the engine).

Engine needs this implies: actions on key down and key up separately (momentary keys), a
multi-state readout (5 positions), and step-style actions. To find in the sim: how the 2024 C172
models the key (input event with positions, or MAGNETO_* events) and how START is held.

## Standby battery (raised 2026-10-27)

OFF / ARM / TEST, TEST spring-loaded. Model as an ARM/OFF toggle for space; TEST maybe later.

## Cockpit lighting (raised 2026-10-27)

Dimmer knobs are not flight critical: put them on their own page.
