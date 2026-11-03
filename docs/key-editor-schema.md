# Key Editor Design Schema

### 

###### Considerations

* Emulating Input Types we see in the cockpit
* Preserve existing flexibility \& cross functionality across types
* Ideally we don't break anything already built
* Create logical flows for new key creation
* "Arming" is moved from switch type to readout. ARM and CAPTURE are states to be read, not button types. Buttons *can* "arm" functions, but the button itself is not actually armable.
* Switching key types during editing should clean up redundant json code at an appropriate juncture.



###### QOL - Tackled now or later

* A nice QOL feature would be to hide/collapse/dim mutually exclusive design choices (e.g. choosing a PNG icon set, or icon per value, hides items like custom sublabels as these would be drawn over and unusable)
* Better differentiation in the builder between form and function would be desirable. Proposal: 3 distinct visually separated sections in the builder (not with these names) - WHERE A KEY GETS INFO, WHAT A KEY LOOKS LIKE, WHAT A KEY DOES WHEN PRESSED
* A way of previewing a profile on the physical dock. Currently with no sim loaded or no/unknown aircraft loaded pressing 'Show on dock' throws the error "that profile is not the one in use on the dock" - a sim independent "Preview Mode" would be great for testing.



##### Key Types

###### 

###### Toggles/Switches

This type covers both toggles and rockers, anything that can be actuated into mutually exclusive states. 
(Open question: a push button which locks and unlocks its depressed state on each push is functionally the same as a toggle with 2 positions, do we include it here or under a 'Button' type, with the 'cycle state' WHEN PRESSED action chosen? My instinct is that it doesn't matter as long as a user can build the desired function from either direction.

* User can choose between 2, 3 and 4 state switch
* Builder attempts to populate appropriate readout features from chosen value
* User can define different outcomes for tap and for hold key presses (e.g. tap cycles states 0,1; hold activates state 2)
* Key can have readout features (state bar, sublabel or value) from it's own variable or elsewhere but this is not required for saving
* Key will not save unless some form of WHEN PRESSED function is implemented



###### Button

This type covers anything you push to depress, including avionics softkeys. It also currently covers turning a key or selector in a given direction - not a neat inclusion but it's a rare case that doesn't seem to fit easily elsewhere. Analysis of this assessment welcome.

* Common uses are to send a event, set a variable or activate a keybind
* User can define different outcomes for tap and for hold key presses, including hold sending a continuous/repeating activation signal
* Key can have readout features (state bar, sublabel or value) from it's own variable or elsewhere but this is not required for saving
* Key will not save unless some form of WHEN PRESSED function is implemented



###### Rotary

This covers anything that can be spun to set a value from a wide range, most commonly seen in lighting dimmers, air vents and other climate control features

* Populates a key with our currently implemented step and ramp functionality
* Builder attempts to populate appropriate readout features from chosen value
* Key can have readout features (state bar, sublabel or value) from it's own variable or elsewhere but this is not required for saving
* Key will not save unless some form of WHEN PRESSED function is implemented



###### Readout

This types covers displaying information from the sim in various formats, including emulating cockpit annunciators which are handled chiefly through the sublabel functionality. It can have actions assigned WHEN PRESSED, but doesn't have to in order to save. (Our previous APPROACH mode arming button experiment would be built under this key type, with showing APR state as a primary function and WHEN PRESSED as optional assignable functionality)

* Supports value, sublabel per value/state, state bar display
* User can turn on priority "if/else/otherwise" logic to cover arming and capture states
* Supports opening keypad option for appropriate variables
* Can be saved with no WHEN PRESSED function
* Cannot be saved with no state or variable being read



###### Decorative

This is used for adding aesthetic elements to the Dock and presents a key builder with clean, pared down functionality

* The only thing that prevents saving this type is having nothing displayed on the face


---

## Decisions (user, 2026-11-01)

1. **Switch states are uncapped**: any number of positions (magnetos have 5). The editor picks the
   number when pointed at the right source where it can.
2. **Tap / hold threshold**: a default the user can change per key, **400 ms** (the hold-to-ramp
   threshold that has worked in flight). A long one guards a function well.
3. **Readout state logic is generalised**: a list of any length of "when these, look like this",
   then "otherwise". Replaces the Switch (armable) type.
4. **Preview mode is siloed from the sim**, even with the matching aircraft loaded: it shows a
   profile on the dock and nothing reaches the sim. To test actions against the sim, load the
   aircraft with preview off.
5. **Order**: the redesign comes now, before Phase 4, so Phase 4 uses it and finds its bugs.

## Implementation plan (Claude, 2026-11-01)

The type becomes mainly an editor concept: it decides the flow, the sections shown, the defaults
and the save rules. The engine draws and acts from the fields, so existing keys keep working.
Old forms are migrated when files are read (profiles, library, keypad layout), in one place.

**Model**
- Types: `switch`, `button`, `rotary`, `readout`, `decor` (and `keypad`, keypad layout only).
  `armable` keys become `readout` keys with state logic.
- Look by value: `states` (value -> on / off / armed / clear), as now, for any type.
- Readout state logic: `logic: { steps: [{ when: [{ read, is }], look, sublabel }], otherwise: { look, sublabel } }`;
  a step is taken when any of its conditions holds; faces per step via `logicFaces`.
- Press: an action as now (tap), or `{ tap, hold, holdMs }` with each an action; a hold action
  may repeat (`repeatMs`: a repeated step is the ramp, counting from the value it last sent). An
  action may be a list of actions done in order. Spring-loaded keys (down on press, release on
  let-go) stay an action of their own. Ramp and hold-to-reset become tap / hold.

**Stages**
1. Model, migration and engine: tap / hold, action lists, readout logic, preview mode.
2. Editor: three sections (gets info / looks like / does when pressed), type flows and save rules,
   cleanup of unused fields at save, dim-and-explain rules.
3. Editor: Switch with N states (catalog enum prefill, Learn positions), Rotary template (level
   bar), Readout logic editor, preview mode controls.
4. Tests throughout, docs, and the user's C172 profile migrated and checked.

**Status (2026-11-01)**: stages 1-4 built and tested in the container (unit and browser tests);
the shipped C172 and generic profiles are in the new form. The level bar arrived 2026-11-03 as a face layer (any key type). Waiting for the user's test on
the dock.
