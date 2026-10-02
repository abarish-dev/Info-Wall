# Info Wall — ESP32 Firmware Starter (PlatformIO / VS Code)

This is a **ready-to-flash skeleton** for the LED-matrix side of Info Wall. It
handles all the Bluetooth + JSON plumbing so you can focus on drawing to your
panel. It matches the app contract in `/app/FIRMWARE_BLE_SPEC.md`.

## What's here
```
firmware/
├── platformio.ini         # board + libraries (ArduinoJson)
├── include/BLEController.h # BLE setup + parses EVERY command from the app
└── src/main.cpp            # boot, Wi-Fi join, your render loop (TODOs)
```

## How to use in VS Code
1. Install the **PlatformIO IDE** extension in VS Code.
2. Copy this `firmware/` folder somewhere and open it with
   **File → Open Folder** (PlatformIO detects `platformio.ini`).
3. Plug in your ESP32 and click the PlatformIO **Upload** (→) button.
4. Open the **Serial Monitor** (115200 baud). You'll see `[BLE] advertising as
   FlightWall-XXXX`, then every command the app sends printed as it arrives.
5. Open the Info Wall app, tap **TAP TO CONNECT**, pick your `FlightWall-…`
   device, and watch the commands stream in.

## What you still need to add
Search the files for `TODO`:
- **Display init** in `setup()` (your HUB75 / WS2812 / etc. library).
- **Render loop** in `loop()` — read from the global `g_settings` struct.
- Optional per-command redraw in `BLEController::handleJson()`.

Everything BLE-related (UUIDs, `FlightWall-` name, notifications, JSON parsing,
full-sync vs live-command handling, and the Wi-Fi status reply the app expects)
is already wired up.

> Note: the app sends **raw JSON** (not base64) — this starter parses it
> directly with ArduinoJson, which is correct.

## Firmware version + over-the-air updates (1.1.0+)

- The version lives in `include/Version.h` (`INFOWALL_FW_VERSION`). The panel
  reports it over BLE: it leaves `{"ready":true,"fw":"x.y.z"}` on the
  characteristic when the app connects, and answers the `version` command with
  a `{"fw":"x.y.z"}` notification.
- The app's **Install update** button sends `{"command":"ota"}`. The panel
  calls `<server>/api/firmware/latest?current=<ver>` and, only if the hosted
  build is strictly newer, shows `UPDATE vX`, streams `<server>/fw/firmware.bin`
  into the inactive OTA slot (HTTPUpdate, no redirects) and reboots into it.
  It notifies `{"ota":"uptodate"|"installing"|"failed"|"offline"}` back.
- The board's default partition table (`partitions-8MB-tinyuf2.csv`) already
  has two 2 MB app slots (`ota_0` / `ota_1`), so no partition change is
  needed and NVS settings survive both USB flashes and OTA updates.
- **1.1.0 is the first OTA-capable build, so flash it over USB once.** After
  that, publish builds as described in `backend/public/fw/README.md`.
- Firmware older than 1.1.0 treated unknown commands as a full sync (blanking
  teams/shows/stocks). 1.1.0 ignores unknown commands, and the app only sends
  `version`/`ota` after it has seen a `fw` value.

## Logos

`include/logos/generated_logos.h` is shared with LED_Matrix_Aura (24x24
RGB565, 123 team logos + 12 airlines, including the hand-tuned Titans, Tampa
Bay and Capitals marks and the crisp Southwest heart). `include/Logos.h` holds
the lookup helpers. Regenerate with Aura's `firmware/tools/generate_logos.py`.
