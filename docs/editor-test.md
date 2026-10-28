# Editor test, round 3 (Windows PC)

Install as before: download the ZIP, `npm run setup`, quit VSD Craft, `npm run deploy`, start
VSD Craft. Your profiles, library and settings in Documents are kept.

1. **Text position**: compare a key in the editor with the dock. Readout values and labels should
   now sit in the same place on both (no bleeding off the top).
2. **Font**: open the editor's **Look** panel and try the fonts against your PNG keys on the dock.
   The change applies to the dock straight away. Default is Oswald Bold.
3. **Bars and colours**: drawn keys (AVN BUS, STBY BATT, FUEL PUMP if drawn) should now have bars the
   same size, shape and colour as your PNG keys; readouts in the sky blue of SET ALTIMETER. The Look
   panel says what was measured; adjust colours there if needed.
4. **Faces per value**: on a key with values (e.g. MAGS), "+ face for a value" and design one.
5. **Several values on a key**: in a face, "+ Live value", "its own source", Browse… a simvar (try
   "nav1" for NAV ACTIVE FREQUENCY:1), Test it, choose it.
6. **Browse input events**: on a key's source, Browse… shows the aircraft's input events with
   values. Learn: flip a switch; if several things change, you're asked which.
7. **Events**: on a press action "Send a sim event", Browse… and Send to try one.
8. The two face designer glitches you saw (edits stopped taking; pixelated text): tell me if
   either comes back.
