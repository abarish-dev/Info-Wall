// ===========================================================================
// Info Wall — main.cpp  (ESP32 / Arduino, PlatformIO)
// ---------------------------------------------------------------------------
// Minimal entry point: starts BLE, and handles a deferred Wi-Fi join so it
// doesn't block the BLE callback. Add your matrix setup + render loop where
// marked. Open the Serial Monitor at 115200 to watch commands arrive.
// ===========================================================================
#include <Arduino.h>
#include <WiFi.h>
#include "BLEController.h"

// Global instances used across the firmware.
MatrixSettings g_settings;
BLEController  g_ble;

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

  // TODO: initialise your LED matrix / display library here.
  //   e.g. dma_display->begin(); dma_display->setBrightness8(...);

  g_ble.begin();
}

void loop() {
  // Handle a Wi-Fi request that arrived over BLE (run outside the callback).
  if (g_ble.wifiRequested) {
    g_ble.wifiRequested = false;
    tryJoinWifi(g_ble.pendingSsid, g_ble.pendingPass);
  }

  // TODO: your render loop. Read from g_settings, e.g.:
  //   - g_settings.brightness, g_settings.isPinned (freeze rotation)
  //   - g_settings.showLKN / showFolly / showCountdown (which modules to show)
  //   - g_settings.fadeSpeed / holdDurationMs (transition timing)
  //   - g_settings.teams[], shows[], stocks[]
  //   - g_settings.countdownLabel / countdownDate (days-to-go)

  delay(20);
}
