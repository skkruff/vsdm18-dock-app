# Editor test, round 4 (Windows PC)

Install as before: download the ZIP, `npm run setup`, quit VSD Craft, `npm run deploy`, start
VSD Craft. Your profiles, library and settings in Documents are kept. Your library's older groups
stay in Groups; new ones also go in a category you choose.

1. **Splash**: load an aircraft. The announcement text should slide left to right so letters behind
   the bezels show at some point. Also on "MSFS / NOT CONNECTED".
2. **Font and bars**: default font is Barlow Condensed Bold (if you saved another font in Look, that
   one stays; pick Barlow there). Drawn bars use corner 9.5.
3. **Face designer**: "Design a custom face" on a drawn switch (e.g. AVN BUS). Nothing should jump.
4. **Library**: categories appear once each, however much you search, save or change the look.
5. **Save to library**: pick a category from the list or "New category…". Save a group: it shows in
   its category and in Groups.
6. **Group drop**: drag a group over the dock picture: dashed outlines on every key it will land on
   (orange where it replaces a key; a note under the picture if keys fall off the edge).
7. **Insert**: inserting LOCAL TIME (or any simvar) asks nothing. A key whose input event this
   aircraft lacks offers "Choose from this aircraft…" with the aircraft's list.
8. **Sublabel**: in Look, "Sublabel" sets its colour. In the key editor every key has a Sublabel,
   fixed, and per value when the key reads the sim. Readout labels are in the Labels colour.
   Sublabels are a little bigger than before.
9. **Empty key**: shows "Add key", no "null".

## Switch (armable), 2026-10-29

10. On the autopilot page, a key's Type "Switch (armable)". Step 1: Browse a simvar, e.g.
    `AUTOPILOT APPROACH ACTIVE`; step 2: `AUTOPILOT APPROACH ARM`. "When pressed": Hold 1 / 0 with
    "Acts on" the APR button's input event (Learn finds it). Fly an ILS: white while armed, green
    on capture. Same for GS, NAV, ALT.
11. With a PNG icon on the key: armed should look like your clear icon with a white bar.
12. ⓘ: hover and click the ones on the armable key and "Acts on". Is the text clear?
13. APR for both approach kinds: step 1 `AUTOPILOT APPROACH CAPTURED`, "+ or"
    `AUTOPILOT APPROACH ACTIVE`; step 2 `AUTOPILOT APPROACH HOLD`. Fly an ILS and an RNAV approach;
    note which simvars change (Test) at "APR pressed" and "captured".
14. XPDR mode: on the XPDR key, When pressed "Toggle / cycle values" 3, 4; Acts on "Simvar",
    `TRANSPONDER STATE:1`, unit `number`. Use **Set** with 4 and 3 first: "kept" means the sim
    took it. Then check the G1000's XPDR mode follows, and whether it stays.
15. Keyboard shortcut: a key with "Press a keyboard shortcut", Record your flashlight binding,
    **Send now**: MSFS should come to the front and the flashlight toggle. Check the plugin log for
    "keys ready". Then try a combination (e.g. Ctrl+Shift+something you have bound) and
    "While held" with something you can see (e.g. a view pan key).
