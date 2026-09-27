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
#include "esp_heap_caps.h"
#include "BLEController.h"
#include "DisplayManager.h"
#include "Persistence.h"
#include "NetworkData.h"

// Global instances used across the firmware.
MatrixSettings g_settings;
BLEController  g_ble;
DisplayManager g_display;
NetworkData    g_net;
volatile bool  g_settingsDirty = false;

static bool s_clockSynced = false;

void tryJoinWifi(const String &ssid, const String &pass) {
  Serial.printf("[WiFi] joining \"%s\"...\n", ssid.c_str());
  // Let the app know the command was received and the join is starting. This
  // is stored on the characteristic too, so a read-poll picks it up even if
  // the live notify is missed.
  g_ble.notify("{\"wifiStatus\":\"connecting\"}");

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  String result;
  if (WiFi.status() == WL_CONNECTED) {
    String ip = WiFi.localIP().toString();
    Serial.printf("[WiFi] connected: %s\n", ip.c_str());
    // Sync the clock so the schedule + countdown are correct.
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    s_clockSynced = true;
    result = String("{\"wifiStatus\":\"connected\",\"ip\":\"") + ip + "\"}";
  } else {
    Serial.println("[WiFi] failed");
    result = "{\"wifiStatus\":\"failed\"}";
  }

  // Retry the result notify a few times over ~3s. The BLE link can drop
  // momentarily when the Wi-Fi radio powers up; retrying (and the stored
  // value in notify()) makes the app reliably pick up the outcome.
  for (int i = 0; i < 6; i++) {
    g_ble.notify(result);
    delay(500);
  }
}

void setup() {
  Serial.begin(115200);
  // Wait up to ~1.5s for the USB-CDC serial monitor to attach (S3 native USB),
  // but don't block forever when running on external power with no USB.
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 1500) delay(10);
  delay(200);
  Serial.println("\n[Info Wall] booting...");

  // NOTE: do NOT globally route large allocations to PSRAM
  // (heap_caps_malloc_extmem_enable) — it starves the BLE controller of the
  // internal RAM it needs and stops advertising. Just report PSRAM presence.
  if (psramFound()) {
    Serial.printf("[MEM] PSRAM present (free %u)\n", (unsigned)ESP.getFreePsram());
  } else {
    Serial.println("[MEM] no PSRAM found");
  }

  loadSettings();       // restore last config from flash BEFORE drawing
  g_display.begin();    // shows the restored content immediately on power-up
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

  // A tracked team just scored — flash the wall with their color + "SCORE".
  if (g_ble.scoreFlashRequested) {
    g_ble.scoreFlashRequested = false;
    g_display.scoreFlash(
        g_ble.flashAbbr, g_ble.flashR, g_ble.flashG, g_ble.flashB);
  }

  // Pull our own live data over Wi-Fi (scores/prices/weather/planes/TV) so the
  // panel stays current without the phone. Safe no-op until Wi-Fi + apiBase set.
  g_net.tick();

  // Render the current module (reads live from g_settings). DisplayManager
  // honors brightness, schedule, pin, hold/fade timing and visibility toggles.
  g_display.tick();

  // Persist any config changes to flash (debounced) so they survive a reboot.
  maybeSaveSettings();

  delay(15);
}
