# Mom Wall app

A simplified companion to the Info Wall app, for a wall in **simple mode** (firmware 1.2.0+).

- **Today**: word of the day (Hear it / More), born today, classical fact + on-this-day (Listen / Read more), math, family message. Data: `GET $EXPO_PUBLIC_BACKEND_URL/api/daily`.
- **Wall Settings**: 12 toggles. Sends BLE `simple` (with `simpleMode:true`), `weather`, `sky`, `clock`, `settime`.
- **Set Up Wi-Fi**: BLE `wifiScan` → `ws`/`wsDone` notifies → `wifi {ssid,password}`.

`src/services/ble.ts` is copied from `frontend/src/services/ble.ts`. BLE needs a dev/production build (not Expo Go).
Family messages are written with `POST /api/family {text, sender, wall}` + header `X-Family-Token`.
