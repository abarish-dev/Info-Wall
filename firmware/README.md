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
