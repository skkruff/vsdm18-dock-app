# Editor and presentation test (Windows PC)

Install as before: download the ZIP, `npm run setup`, quit VSD Craft, `npm run deploy`, start
VSD Craft. Your config.json is kept.

On first start the plugin copies the C172 and generic profiles and a Magneto set preset to
`Documents\MSFS Switchboard\`. From now on the dock uses those copies; edit them with the editor.

1. **Not connected screen** (MSFS closed): MSFS / NOT CONNECTED large across the panel, logo in
   the centre key. Readable?
2. **Aircraft load**: load the C172. The panel shows C172 / G1000 with the logo for 2.5 s, then
   the main page. No "Main" announcement, no loading flash.
3. **Switch aircraft** (C172 -> Caravan -> C172): each change shows one announcement for the right
   aircraft, nothing in between. The log shows one `aircraft` line per change with the right path.
4. **Magnetos**: the MAGS key shows your magneto icons for OFF / R / L / BOTH / START.
5. **QNH key**: the set altimeter icon sits above the value without overlap.
6. **Editor**: hold the middle round button for 1.5 s (or open http://localhost:8765/).
   - The dock picture matches the dock, with live values on the page the dock shows.
   - Click a key, change something (label, icon, layout by dragging), Save: the dock updates.
   - Try Learn: click Learn on a key's source, then flip a switch in the cockpit.
   - Try the Magneto set preset on another page, or a new profile for the Caravan
     (New, then "Use the aircraft loaded now" under Profile settings).
7. Tell me what feels wrong or missing in the editor. It's a first version.

If the editor page doesn't open: check the plugin log for an `editor` line (it shows the address,
or why it didn't start, e.g. the port is in use).
