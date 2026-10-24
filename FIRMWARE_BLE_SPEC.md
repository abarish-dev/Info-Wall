# Info Wall — ESP32 BLE Contract (what to implement in VS Code)

BLE service/characteristic (unchanged):
- Service UUID: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
- Characteristic UUID: `beb5483e-36e1-4688-b7f5-ea07361b26a8`
- Advertise a name starting with `FlightWall-` (the app scans by this prefix).

The app always writes a **UTF-8 JSON string** to the characteristic.
(The React Native side base64-encodes it only because the BLE library's JS API
requires that; react-native-ble-plx decodes it back to raw bytes before it goes
over the air.) **Your ESP32 receives raw JSON bytes — just read the value and
`deserializeJson` it directly. Do NOT base64-decode.** Likewise, when you notify
back, send a plain JSON string (the app base64-decodes it on its side).

There are two kinds of writes:

---

## 1) Full Sync (the "SYNC & CONFIRM" button)

A single **flat** JSON object (no nested objects except `polygon`). Keys and types
must match exactly:

```json
{
  "radius": 3,
  "trackFlight": false,
  "flightIdent": "",
  "showWeather": true,
  "lat": 35.584,
  "lon": -80.8685,
  "trackingMode": "radius",          // "radius" | "polygon"
  "polygon": [[35.58,-80.86],[...]],  // array of [lat,lon]
  "brightness": 80,                   // 0-100
  "scheduleEnabled": false,
  "scheduleStart": "19:00",           // "HH:MM"
  "scheduleEnd": "07:00",
  "scheduleBrightness": 40,           // 0-100 (0 = display off)
  "team1": "NYY", "team2": "CAR", "team3": "", ... "team8": "",
  "tv1": "Shrinking", "tv2": "", ... "tv8": "",
  "stock1": "AAPL", "stock2": "MSFT", "stock3": "", ... "stock8": ""
}
```

After a Full Sync the app reads the characteristic back and expects to decode the
same/echo JSON to show "confirmed by matrix". If you don't support read-back it
still works, it just shows "sent (not confirmed)".

---

## 2) Live commands (pushed automatically while connected)

Each is a small JSON with a `command` field, written whenever the user edits that
area (debounced ~0.8s). Handle each `command`:

```json
{ "command": "brightness", "brightness": 60 }
{ "command": "radius", "radius": 12 }
{ "command": "schedule", "scheduleEnabled": true, "scheduleStart": "19:00", "scheduleEnd": "07:00", "scheduleBrightness": 40 }
{ "command": "pin", "isPinned": true }
{ "command": "teams", "teams": ["NYY","CAR"] }
{ "command": "shows", "shows": ["Shrinking","Ted Lasso"] }
{ "command": "stocks", "stock1": "AAPL", "stock2": "MSFT", ... "stock8": "" }
{ "command": "message", "showCustomMessage": true, "line1": "...", "line2": "...", "line3": "..." }
{ "command": "flight", "trackFlight": true, "flightIdent": "DAL520" }
{ "command": "weather", "showWeather": true, "lat": 35.584, "lon": -80.8685 }
{ "command": "zone", "trackingMode": "polygon", "polygon": [[lat,lon],...] }
{ "command": "flash_test", "ts": 1719000000000 }
{ "command": "wifi", "ssid": "MyNetwork", "password": "secret" }
{ "command": "transitions", "fadeSpeed": 5, "holdDurationMs": 12000, "showLKN": true, "showFolly": true, "showCountdown": true, "countdownLabel": "BALTIC CRUISE", "countdownDate": "2026-09-14" }
```

Notes:
- `teams`/`shows` arrays only include non-empty entries.
- `stocks` are sent as `stock1..stock8` keys (empty string = unused slot).
- On `wifi`, store the credentials, connect to Wi-Fi, then reboot/apply as needed.

---

## 3) Wi-Fi status (NEW — firmware needs to send this back)

The app now shows a live "Wi-Fi joined / failed" banner. To power it, after you
receive a `{"command":"wifi",...}` and try to join, **notify** on the SAME
characteristic (enable notifications on it) with one of:

```json
{ "wifiStatus": "connected", "ip": "192.168.1.42" }
{ "wifiStatus": "failed" }
```

The app subscribes to notifications right after sending Wi-Fi creds. Until your
firmware sends this, the app just shows "Sent · waiting for the matrix to join…".
(`ip` is optional; if present it's displayed.)

## Wi-Fi self-fetch (panel is phone-independent)
The panel pulls its own live data over Wi-Fi from the Info Wall backend and no
longer depends on the phone for live updates. The phone only pushes preferences
(saved to NVS). New BLE commands:
- `{command:"server", url:"https://<host>"}` — backend base URL (persisted).
- `{command:"teams", teams:[...], colors:["#RRGGBB",...]}` — team colors added
  so the panel can flash the correct color on a score.
- `{command:"scoreflash", team, abbr, color}` — optional phone-side trigger;
  the panel also detects scores itself.

Panel poll intervals (NetworkData.h): scores 30s, quotes 120s, weather 900s,
planes 30s, tv 3600s. Endpoints: /api/device/scores, /api/device/quotes,
/api/weather/current, /api/device/planes, /api/device/tv. On a live team's
score increase the panel runs the SCORE flash on its own.

### Wi-Fi scan (fw 1.1.19+)
App writes `{"command":"wifiScan"}`. The wall runs an async scan (display keeps
running) and notifies one network per frame, strongest first, deduped, max 15:
`{"ws":[index,count,"SSID",rssi,secure]}` then `{"wsDone":count}` (`-1` = scan failed).
Hidden networks are skipped; the app keeps a manual SSID field for them.

## Trivia section (fw 1.3.0+, main walls / normal mode)

The Mom Wall daily slides, each on its own toggle, in the normal rotation.
Ignored in simple mode (Mom Wall keeps its own `simple` toggles). Any subset
of keys may be sent; missing keys keep their current value. Persisted (`tvF`).

```json
{ "command": "trivia", "tvOn": true, "born": true, "composer": true,
  "musicDay": true, "word": true, "origin": true, "cfact": true, "math": false }
```

| key | slide | default |
|---|---|---|
| `tvOn` | master switch | on |
| `born` | Born Today | on |
| `composer` | Composer Birthday (`ck == "composer_born"`) | on |
| `musicDay` | Classical On This Day (any other `ck`) | on |
| `word` | Word of the Day | on |
| `origin` | Word Origin (2nd page of Word) | on |
| `cfact` | Classical Fact | on |
| `math` | Math | off |

Reply: `{"trivia":1|0}`. Data comes from `GET /api/device/daily` (fetched by
the wall when `tvOn`, at day change / every 30 min, skipped below 60 KB free
heap). Normal mode uses amber accents (titles/years); short slides are
vertically centred.

## Nightly auto-update (fw 1.3.0+)

```json
{ "command": "autoupdate", "nightly": true }
```

Default on, persisted (`auU`). Around 3 AM local + random jitter the wall asks
`/api/firmware/latest` on its own channel (main walls: default/main channel;
simple mode: `channel=simple`), and installs only a strictly newer version,
streamed into the spare OTA slot and marked bootable only if size + SHA-256
match the manifest. The app's Update button uses the same verified path on
both channels. Reply: `{"autoupdate":1|0}`.
