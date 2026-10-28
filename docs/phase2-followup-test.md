# Phase 2 follow-up checks (Windows PC)

Install as before: download the ZIP, `npm run setup`, quit VSD Craft, `npm run deploy`, start
VSD Craft. Your config.json is kept; the new `announceMs` setting defaults to 800 ms.

1. **Banners:** with MSFS closed, "MSFS / NOT CONNECTED" is drawn large across the panel. While
   an aircraft loads, "LOADING / AIRCRAFT". Switching pages shows the page name across the panel
   for 0.8 s, then the keys. Readable? Too slow, too fast? (`announceMs` in config.json; set
   `announcePages` to false to turn it off.)
2. **START:** hold START for 5+ seconds in the C172. The starter should keep cranking until you
   let go, then drop to BOTH.
3. **QNH:** on the Auxiliary page the QNH key shows the top of the "set altimeter" icon with the
   value below. Does the icon part draw at all? Press it: the altimeter should sync to current
   weather (same as your comma key).
4. **Pitot heat** is gone from the Auxiliary page; the fuel selector moved left one key.
5. **Aircraft change:** go from the C172 to the Caravan and back. The log should show one
   `aircraft` line per change, each with the right path.

Send back the plugin log and your impressions.
