# StreamDock SDK notes

Source: `MiraboxSpace/StreamDock-Plugin-SDK` (GitHub, cloned 2026-10-25), mainly the Node.js V2
template, the Python core (`SDPythonSDK/src/core/plugin.py`) and the Qt SDK constants
(`SDQtSDK/SDK/SDKDefines.h`). Checked against the docs at sdk.key123.vip/en/guide on
2026-10-27 (registration, events sent/received, manifest, style guide); they agree except as
noted under "Corrections from the docs".

## Corrections from the docs (2026-10-27)

- Key images: the style guide says **128x128** for key icons (not 144). The M18's real LCD
  resolution is still unknown; Phase 0 shows how a 144 image scales.
- `setImage` accepts base64 PNG, JPG, GIF data URIs and SVG (`data:image/svg+xml;charset=utf8,`).
  `setImage` and `setTitle` take an optional `state` to target one state.
- `Controllers` documented values: `Keypad`, `Information` (display only, no key events),
  `SecondaryScreen`, `Knob`. The manifest example also lists an undocumented `btn`; if the M18's
  plain buttons refuse our action, try adding `btn`.
- `switchToProfile` is not in the docs' list of sent events (only in the Qt SDK constants).
  We do not rely on it.
- `logMessage` goes to a debug window (double-click the version number in Stream Dock settings),
  not to a file. Our file logger stays.
- Manifest `Nodejs` may take `"Debug": "--inspect=127.0.0.1:3210"` to attach a debugger.

## Shape of a plugin

- A folder named `<uuid>.sdPlugin` in `%APPDATA%\HotSpot\StreamDock\plugins\`.
- `manifest.json` names the entry point (`CodePathWin: "plugin/index.js"`) and requests the
  host's built-in Node via `"Nodejs": { "Version": "20" }`. The template readme says Windows
  Stream Dock >= 3.10.188.226 bundles **Node 20.8.1**. Dependencies are not installed by the
  host: ship `node_modules` or a bundle.
- The host launches the process with
  `-port <n> -pluginUUID <uuid> -registerEvent <event> -info <json>`, the plugin opens
  `ws://127.0.0.1:<port>` and sends `{ "event": <registerEvent>, "uuid": <pluginUUID> }`.
  The host closing the socket means "exit".
- `-info` carries `application` (language, platform, version), `devices` (id, name, type,
  `size.columns`, `size.rows`), `colors`, `devicePixelRatio`. Identical to Elgato's.

## Manifest (per action)

`UUID`, `Name`, `Icon`, `States[]` (`Image`, `TitleAlignment`, `FontSize`), `Controllers`
(template uses `[]`; Elgato values are `Keypad`, `Encoder`), `DisableAutomaticStates`,
`UserTitleEnabled`, `SupportedInMultiActions`, `Tooltip`, `PropertyInspectorPath`, `Settings`
(defaults).

## Events received (host -> plugin)

Per key (`context` identifies one placed action instance):
`willAppear`, `willDisappear` (payload: `coordinates {row, column}`, `settings`, `state`,
`isInMultiAction`), `keyDown`, `keyUp`, `didReceiveSettings`, `titleParametersDidChange`,
`propertyInspectorDidAppear/Disappear`, `sendToPlugin`, `dialDown/Up/Rotate`, `touchTap`.

Global: `deviceDidConnect` (`device`, `deviceInfo`), `deviceDidDisconnect`,
`applicationDidLaunch/Terminate` (needs `ApplicationsToMonitor` in manifest, Elgato-style),
`systemDidWakeUp`, `didReceiveGlobalSettings`.

## Events sent (plugin -> host)

`setImage {image, target}`, `setTitle {title, target}`, `setState {state}`, `showAlert`,
`showOk`, `setSettings`, `getSettings`, `setGlobalSettings`, `getGlobalSettings`,
`switchToProfile {profile}`, `sendToPropertyInspector`, `openUrl`, `logMessage`,
`setFeedback`, `setText`. `target`: 0 hardware+software, 1 hardware only, 2 software only.

`setImage` in the templates is used with an **SVG data URI** (`data:image/svg+xml;charset=utf8,...`,
144x144 canvas). Base64 PNG data URIs are the Elgato norm and are tested in Phase 0.

## Consequence for this project

The plugin cannot place actions on keys. The user places action instances; the plugin only
learns about keys through `willAppear` with coordinates. So the design is:

1. One action, **Switchboard Slot**, placed on every key of one Stream Dock page (one-time setup).
2. The plugin maps `(row, column)` to a slot index and owns everything drawn on those keys.
3. Pages and aircraft changes are **plugin-side redraws**, not Stream Dock profile switches.
   `switchToProfile` exists in the protocol but (Elgato precedent) only switches to profiles
   bundled with the plugin; we do not need it.
