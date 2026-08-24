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

