// ===========================================================================
// Info Wall — main.cpp  (Adafruit MatrixPortal S3 / Arduino, PlatformIO)
// ---------------------------------------------------------------------------
// Starts BLE, drives the 128x64 HUB75 LED matrix via DisplayManager, handles a
// deferred Wi-Fi join, and (once online) syncs the clock over NTP so the
// display schedule + travel countdown are accurate.
// Open the Serial Monitor at 115200 to watch commands arrive.
// ===========================================================================
#include <Arduino.h>
#include <WiFi.h>
#include "BLEController.h"
#include "DisplayManager.h"

// Global instances used across the firmware.
MatrixSettings g_settings;
BLEController  g_ble;
DisplayManager g_display;

static bool s_clockSynced = false;

void tryJoinWifi(const String &ssid, const String &pass) {
  Serial.printf("[WiFi] joining \"%s\"...\n", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    String ip = WiFi.localIP().toString();
    Serial.printf("[WiFi] connected: %s\n", ip.c_str());
    // Sync the clock so the schedule + countdown are correct.
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    s_clockSynced = true;
    // Tell the app it worked (matches the banner the app listens for).
    g_ble.notify(String("{\"wifiStatus\":\"connected\",\"ip\":\"") + ip + "\"}");
  } else {
    Serial.println("[WiFi] failed");
    g_ble.notify("{\"wifiStatus\":\"failed\"}");
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[Info Wall] booting...");

  g_display.begin();
  g_ble.begin();
}

void loop() {
  // Handle a Wi-Fi request that arrived over BLE (run outside the callback).
  if (g_ble.wifiRequested) {
    g_ble.wifiRequested = false;
    tryJoinWifi(g_ble.pendingSsid, g_ble.pendingPass);
  }

  // Flash test pattern requested from the app.
  if (g_ble.flashRequested) {
    g_ble.flashRequested = false;
    g_display.flashTest();
  }

  // Render the current module (reads live from g_settings). DisplayManager
  // honors brightness, schedule, pin, hold/fade timing and visibility toggles.
  g_display.tick();

  delay(15);
}
