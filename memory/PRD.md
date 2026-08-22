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

