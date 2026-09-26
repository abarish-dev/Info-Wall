# MatrixControl — Smart LED Matrix BLE Control Panel

## Original Problem Statement
Build a mobile app to control a smart LED matrix via Bluetooth. UI: prominent "Connect to Matrix" button at top; "Flight Tracking" section with a Search Radius slider (1–50 miles, default 25→user changed to 3); "Sports" section with two team-abbreviation inputs (defaults NYY, CAR); "TV Shows" section with three inputs (defaults Shrinking, Emily in Paris, Ted Lasso); persistent "Sync Settings" button at bottom. On Sync, package the current form values into a single JSON object, stringify + encode it, and write it to the characteristic. Show a success toast.

- Service UUID: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
- Characteristic UUID: `beb5483e-36e1-4688-b7f5-ea07361b26a8`

## User Choices
- Bluetooth target: **Native iOS/Android** (react-native-ble-plx) — NOT Web Bluetooth.
- Search Radius default: **3**.
- Other defaults kept (NYY/CAR; Shrinking / Emily in Paris / Ted Lasso).
- Settings **persist locally** on device.
- Field counts fixed (2 teams, 3 shows).
- Design: no explicit preference → design agent chose Dark-First Utility (Ember #FF6B00 + Obsidian).

## Architecture
- **Frontend:** Expo Router (single screen `app/index.tsx`), React Native.
- **BLE:** `react-native-ble-plx` in `src/services/ble.ts`, lazily required + guarded so the app still boots on web/Expo Go (BLE only works in a real device build).
- **Local storage:** `@/src/utils/storage` (AsyncStorage) key `matrix_settings_v1`.
- **Keyboard:** `react-native-keyboard-controller` (KeyboardAwareScrollView + KeyboardStickyView).
- **Toast:** custom `src/components/Toast.tsx` (no Alerts).
- **Fonts:** Rajdhani (display) + IBM Plex Sans (body), local TTFs in `assets/fonts`.
- **Backend:** unchanged/unused (no server-side data needed).

## User Personas
- Hardware/IoT hobbyist configuring what their LED matrix displays (nearby flights, sports teams, TV watchlist).

## Core Requirements (static)
- Connect/disconnect to matrix over BLE by Service UUID.
- Configure radius (1–50), 2 teams, 3 shows.
- On Sync: build JSON, base64-encode, write to characteristic, success toast.
- Persist all settings locally.

## Implemented (2026-06)
- [x] Full ControlPanel UI: hero + status pill + Connect button, Flight/Sports/TV sections, sticky Sync button.
- [x] BLE connect (scan by service UUID → connect → discover), permissions (Android runtime + iOS/Android manifest), graceful degradation on web/Expo Go.
- [x] Sync: JSON payload `{flightTracking:{searchRadius}, sports:{team1,team2}, tvShows:[...], syncedAt}` → UTF-8 base64 → write-with-response (fallback write-without-response).
- [x] Local persistence + hydration.
- [x] Custom success/error/info toast; haptics on connect/slider/sync.
- [x] Frontend testing_agent run — all 7 scenarios passed.

## Notes / Constraints
- **BLE requires a real device build** (dev/prod). It will not connect in Expo Go or web preview — this is expected; the UI shows a helper hint and error toast there.

## Backlog
- **P1:** Show connected device name / signal in the hero when connected.
- **P2:** "Test pattern" quick action to flash the matrix on connect.
- **P2:** Allow add/remove of team/show rows (currently fixed).
- **P2:** Read-back / confirm characteristic value after write.

## Updates (2026-06, fork)
- [x] Home screen: removed the large "Connect to Matrix" button — the status pill is now the tappable connect/disconnect control ("TAP TO CONNECT" / "TAP TO DISCONNECT"), freeing vertical space.
- [x] Animated LED-panel splash (`src/components/AnimatedSplash.tsx`): ember pixels sweep-fill a grid, "INFO WALL" wordmark fades in, then the overlay fades into the app. Mounted in `_layout.tsx` over the (black) native splash for a seamless transition.
- [x] Sync payload parity: added `stock1..stock8` to the flat `buildBlePayload` contract so a full Sync now carries financial tickers (previously only Live Push did).
- [x] Wi-Fi: typed SSID is now remembered immediately on Save (before the connect check) so it's never lost if the matrix isn't connected yet.

## Updates (2026-06, fork · round 2)
- [x] Wi-Fi status read-back: after sending credentials the app subscribes to characteristic notifications (`monitorMatrix` in `ble.ts`) and shows a live banner in the Wi-Fi panel — "Sent · waiting…" → "Matrix joined · <ip>" / "Couldn't join". Firmware contract: send `{"wifiStatus":"connected","ip":"..."}` or `{"wifiStatus":"failed"}` on the same characteristic. (Firmware update pending on user side; until then it stays on "waiting".)
- [x] Team badges: each team abbreviation shows a colored badge in its official team color (`src/utils/teamColors.ts`, ~120 NFL/MLB/NBA/NHL teams mapped; unknown abbrevs get a deterministic color). Applied via a new `badge` prop on `AvatarInput`.
- [x] Splash skip: tap anywhere on the LED intro to dismiss it instantly ("Tap to skip" hint).

## Updates (2026-06, fork · round 3)
- [x] Removed the two-letter initial avatars from team/show/ticker inputs (kept the icon avatar on Zip/Flight fields).
- [x] Team-code validation: entering a code not in the built-in ~120 NFL/MLB/NBA/NHL abbreviation set shows an inline "Unrecognized code" warning (soft, non-blocking). Source: `src/utils/teamColors.ts` `getTeamBadge().known`.
- [x] Full live sync (option B): added debounced live pushes for the remaining fields so the matrix always stays in sync while connected — `{command:"flight"}` (trackFlight + flightIdent), `{command:"weather"}` (showWeather + lat/lon), `{command:"zone"}` (trackingMode + polygon). Firmware must handle these commands.
- [x] Sync button demoted to a smaller outlined "SYNC & CONFIRM" (it now mainly does the full write + read-back confirmation, since everything else pushes live).
- [x] Accent themes: Settings → APPEARANCE lets the user pick Ember (orange), Azure (blue), Crimson (red), or Slate (gray).

## Updates (2026-06, fork · round 4)
- [x] Refactor: split the ~3000-line `app/index.tsx` (now ~2540). Extracted `src/components/FormControls.tsx` (Section, TextField [was AvatarInput], IconInput, AddRowButton), `src/components/MatrixMap.tsx` (TileMap, PolyOverlay, PolyEditor, signalColor, lonLatToTileFrac), and a `src/hooks/useThemedStyles.ts` hook. Theming now uses the hook in both index and SettingsSheet (replaced the module-level style-rebuild hack). Behavior identical; regression-tested (iteration_7, all pass).
- [x] Removed the redundant hero subtitle "Configure and push live settings to your LED matrix." (status pill + title already convey this; frees vertical space).
- [x] Added `/app/FIRMWARE_BLE_SPEC.md` — the exact ESP32/VS Code BLE contract (full sync payload keys, all live commands, and the new Wi-Fi status notification format). Implemented via runtime mutation of `colors` accent fields + a style-rebuild registry (`applyAccent`/`onAccentChange` in `theme.ts`); persisted as `theme_id_v1`. Applies app-wide (icons, sliders, toggles, buttons, borders).

## Updates (2026-06, fork · round 5)
- [x] Display & Transitions + Travel Countdown (user's Gemini spec, restyled to Info Wall theme). New `src/components/TransitionsSection.tsx`: Screen Hold slider (3–45s), Fade Speed slider (1–10), Event Name, Departure Date (native `@react-native-community/datetimepicker`; web uses a YYYY-MM-DD text fallback) + live "days to go" preview. Settings fields `fadeSpeed/holdSeconds/countdownLabel/countdownDate` persist. Pushes live when connected as `{command:"transitions", fadeSpeed, holdDurationMs, countdownLabel, countdownDate}` (added to FIRMWARE_BLE_SPEC.md). Installed `@react-native-community/datetimepicker@8.4.4` (native module — date picker needs a dev/prod build, not Expo Go).
- [x] Transitions round 2: added a "Module Visibility" subsection with 3 toggles — `showLKN` (Lake Norman Marine), `showFolly` (Folly Beach Tides), `showCountdown` (Travel Countdown). Turning off Travel Countdown hides the event-name/date fields. All three booleans added to the live `transitions` payload and to FIRMWARE_BLE_SPEC.md.
- [x] Collapsible sections: the shared `Section` component (FormControls.tsx) is now an accordion — tap the header (chevron up/down) to expand/collapse each module, with a smooth LayoutAnimation. Declutters the long scroll. Defaults to all-open. Display & Transitions confirmed positioned directly above Sync Status.
- [x] Start-collapsed defaults: Flight Tracking + Weather open on load; Pinned Flight, Sports, TV Shows, Financial Tickers, Custom Message, Display & Transitions, and Sync Status default collapsed (`defaultOpen={false}`) for a tidy first view.
- [x] Transition presets: "Calm" (fade 2 / hold 20s) and "Snappy" (fade 9 / hold 6s) one-tap chips at the top of Display & Transitions; the matching chip highlights when current values equal a preset.
- [x] Removed the splash "Tap to skip" affordance (intro is short); `AnimatedSplash` now just auto-fades with no Pressable/hint.
- [x] App version footer in Settings: bottom of the settings sheet shows `Info Wall v{version} · {platform}` (version from `app.json` via `expo-constants`), so it's easy to see which build is on the phone.
- [x] Firmware starter delivered at `/app/firmware/` (PlatformIO/Arduino: platformio.ini, include/BLEController.h, src/main.cpp, README.md) — parses every BLE command in FIRMWARE_BLE_SPEC.md. Also corrected the spec: ESP32 receives RAW JSON (no base64 decode).

## Updates (2026, fork · round 6 — Expo SDK 57 upgrade)
- [x] Upgraded Expo SDK 54 → 57 via the `expo-version-upgrade` skill (`expo@^57`, then `expo install --fix`). Now: expo 57.0.25, react-native 0.86.3, react-native-reanimated 4.5.1, expo-router 57, etc. `expo-doctor` 20/20 pass.
- [x] app.json: removed `newArchEnabled` and `edgeToEdgeEnabled` (deprecated in 55).
- [x] Icon migration (55→56): replaced `@expo/vector-icons` with `@react-native-vector-icons/ionicons@13.1.4` across all 7 files; `keyof typeof Ionicons.glyphMap` → `IoniconsIconName`. The new lib auto-loads its font via expo-font, so the custom `src/hooks/use-icon-fonts.ts` CDN workaround was DELETED and its gating removed from `_layout.tsx`.
- [x] Fixed `pointerEvents` prop → `style.pointerEvents` in AnimatedSplash (RN 0.86 deprecation).
- [x] Regression-tested (iteration_8, all 8 flows pass): boots clean, all icons render (26 glyphs), collapsible defaults, theme switch+persist, presets, map (svg), version footer, core inputs.

## Updates (2026, fork · round 7 — team logos from LED_Matrix_Aura)
- [x] Ported the team catalog from the user's repo (github.com/abarish-dev/LED_Matrix_Aura) into `src/data/teams.ts` (4 leagues, official colors, `teamLogoUrl` ESPN CDN, `readableOn`).
- [x] Sports section rebuilt: replaced free-text team boxes with `src/components/TeamPicker.tsx` — rows show the real ESPN logo on the team's color swatch + city/name, and an "Add Team" modal picks by League → Team. Teams now stored as `"LEAGUE:ABBR"` (e.g. `MLB:NYY`) to match the firmware contract; DEFAULTS updated to `["MLB:NYY","NFL:CAR"]`. Logo `<Image>` falls back to a colored abbr badge on 404. `teamColors.ts`/`getTeamBadge` no longer used.
- [x] Matrix hardware specs captured from the repo: 128×64 HUB75 (MatrixPortal S3), teams "NFL:DAL", ESPN team-logo + Google airline-logo CDNs, and a pre-rendered `generated_logos.h` to reuse when we write the draw code.
- [ ] TODO (airline logos): needs a live overhead-flight feed (adsb.lol, native-only/no CORS) which InfoWall doesn't have yet — offered to port `adsb.ts` + a live-flight card as a follow-up.

## Updates (2026, fork · round 8 — accordion memory + UX polish)
- [x] Remember Layout: each accordion section's expanded/collapsed state now persists across launches. Section open-state lifted into `app/index.tsx` (`sectionOpen` map, keys flight/pinned/weather/sports/tv/stocks/message/transitions/sync), saved under `section_open_v1`. `Section` (FormControls.tsx) made controllable via optional `open`/`onToggle` props (falls back to internal state when uncontrolled). `TransitionsSection` forwards these props.
- [x] Expand/Collapse All: a pill button at the top of the scroll toggles every section open/closed at once (`setAllSections`, `toggle-all-sections` testID); label flips EXPAND ALL ↔ COLLAPSE ALL. Verified: default=EXPAND ALL (flight+weather open), click→COLLAPSE ALL, reload persists.
- [x] Version/Build info: Settings footer now shows `Info Wall v{version} · build {buildNumber} · {platform} · tap to copy`; tapping copies device/version info (version, build, platform+OS version, device name) to the clipboard with a "Copied device info" confirmation. Added `ios.buildNumber:"1"` + `android.versionCode:1` to app.json.
- [x] "Cinematic" transition preset added to `TransitionsSection` (fade 1 / hold 45s) alongside Calm and Snappy.

## Updates (2026, fork · round 9 — Planes Overhead, Live Preview, firmware draw code)
- [x] Planes Overhead: new backend endpoint `GET /api/flights/nearby?lat&lon&radius` (server.py + airlines.py) proxies the public **adsb.lol** feed (`/v2/lat/{lat}/lon/{lon}/dist/{nm}`, miles→nm, clamped 1–250), resolves each callsign's 3-letter ICAO prefix to an airline name + IATA and a gstatic 70px logo URL, sorts by distance, returns top 15. Short in-memory cache (120s) degrades gracefully to last-good / empty (200) on upstream 429/hiccup instead of erroring. Frontend `src/services/flights.ts` + `src/components/PlanesOverhead.tsx` render a live card (auto-refresh 25s, refresh button, logo→airplane-icon fallback, loading/empty/error/no-location states) using the resolved Weather zip coords + search radius. New section key `planes` (default collapsed). Tested (iteration_9: backend 9/9 pytest, frontend all pass — live flight rendered near Mooresville).
- [x] Live Matrix Preview: rewrote `app/matrix-preview.tsx` from a static mock into a settings-driven carousel — reads `matrix_settings_v2`, builds frames only for enabled modules (message/flight/weather/teams/shows/stocks/countdown/LKN/Folly/pin) with real data (team logos via ESPN CDN, weather city from geocode cache, countdown days), auto-cycles at the user's hold+fade timing, dims to brightness, freezes on pin. Play/pause + prev/next + frame dots. Opened via a new tv icon (`preview-button`) in the home header.
- [x] Auto-Countdown Clear: effect in `index.tsx` clears `countdownDate`+`countdownLabel` (with an info toast) once the trip date has passed (days-remaining < 0), checked on launch and whenever the date changes.
- [x] ESP32 firmware draw code (not testable here — needs the physical MatrixPortal S3): new `include/DisplayManager.h` drives a 128×64 HUB75 panel via ESP32-HUB75-MatrixPanel-DMA — builds a module carousel from `g_settings`, honors brightness + evening schedule (NTP), pin freeze, hold/fade cross-fade, and visibility toggles; draws message/flight/weather/teams/shows/stocks/countdown/LKN/Folly + flash-test. `main.cpp` wires setup/loop + NTP sync on Wi-Fi join; `BLEController.h` now stores custom-message lines + a `flashRequested` flag; `platformio.ini` targets `adafruit_matrixportal_esp32s3` with the HUB75 DMA + Adafruit GFX libs. Team logos default to text abbreviations with a marked hook to blit real bitmaps from the user's `generated_logos.h`.

