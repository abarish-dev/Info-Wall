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
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h>
#include "esp_heap_caps.h"
#include "Version.h"
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
    // Sync the clock (US Eastern, auto-DST) so the weather clock, schedule and
    // countdown are correct.
    configTzTime(INFOWALL_TZ, "pool.ntp.org", "time.nist.gov");
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

// ---- Over-the-air firmware update ------------------------------------------
// Same scheme as the Aura panel: ask <apiBase>/api/firmware/latest, and if the
// hosted build is STRICTLY newer, stream <apiBase><url> (a static file on
// Vercel's CDN, served directly, no redirect) into the inactive OTA slot and
// reboot into it. Triggered only by the app's "Install update" (BLE "ota").
static void parseVersion(const String &v, int out[3]) {
  out[0] = out[1] = out[2] = 0;
  int idx = 0, start = 0;
  for (uint32_t i = 0; i <= v.length() && idx < 3; i++) {
    if (i == v.length() || v[i] == '.') {
      if (i > (uint32_t)start) out[idx] = v.substring(start, i).toInt();
      idx++;
      start = i + 1;
    }
  }
}

static bool isNewerVersion(const String &server, const String &current) {
  int s[3], c[3];
  parseVersion(server, s);
  parseVersion(current, c);
  for (int i = 0; i < 3; i++)
    if (s[i] != c[i]) return s[i] > c[i];
  return false;
}

static void otaCheck() {
  if (WiFi.status() != WL_CONNECTED || g_settings.apiBase.length() == 0) {
    g_ble.notify("{\"ota\":\"offline\"}");
    return;
  }
  String base = g_settings.apiBase;
  if (base.endsWith("/")) base.remove(base.length() - 1);

  String ver, path;
  {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.setTimeout(12000);
    if (!http.begin(client, base + "/api/firmware/latest?current=" INFOWALL_FW_VERSION)) {
      g_ble.notify("{\"ota\":\"failed\"}");
      return;
    }
    int code = http.GET();
    JsonDocument doc;
    bool ok = code == 200 && !deserializeJson(doc, http.getStream());
    http.end();
    if (!ok) {
      Serial.printf("[OTA] latest check failed (HTTP %d)\n", code);
      g_ble.notify("{\"ota\":\"failed\"}");
      return;
    }
    ver = (const char *)(doc["version"] | "");
    path = (const char *)(doc["url"] | "/fw/firmware.bin");
    if (!(doc["available"] | false) || !isNewerVersion(ver, INFOWALL_FW_VERSION)) {
      Serial.printf("[OTA] up to date (running %s, server %s)\n",
                    INFOWALL_FW_VERSION, ver.c_str());
      g_ble.notify("{\"ota\":\"uptodate\",\"fw\":\"" INFOWALL_FW_VERSION "\"}");
      return;
    }
  }

  String url = path.startsWith("http") ? path : base + path;
  Serial.printf("[OTA] installing v%s from %s\n", ver.c_str(), url.c_str());
  g_ble.notify(String("{\"ota\":\"installing\",\"version\":\"") + ver + "\"}");
  g_display.message("UPDATE", "v" + ver);
  delay(500);

  WiFiClientSecure client;
  client.setInsecure();
  httpUpdate.rebootOnUpdate(true);   // reboot straight into the new slot
  httpUpdate.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  t_httpUpdate_return ret = httpUpdate.update(client, url);
  if (ret == HTTP_UPDATE_FAILED) {
    Serial.printf("[OTA] FAILED (%d): %s\n", httpUpdate.getLastError(),
                  httpUpdate.getLastErrorString().c_str());
    g_display.message("UPDATE", "failed");
    g_ble.notify("{\"ota\":\"failed\"}");
    delay(1500);
  }
}

void setup() {
  Serial.begin(115200);
  // Wait up to ~1.5s for the USB-CDC serial monitor to attach (S3 native USB),
  // but don't block forever when running on external power with no USB.
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 1500) delay(10);
  delay(200);
  Serial.println("\n[Info Wall] booting v" INFOWALL_FW_VERSION "...");

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

  // Phone-pushed nearest plane (only accepted when the panel's own fetch is
  // stale). Applied here, not in the BLE callback, so it can't race a draw.
  if (g_ble.planesPushed) {
    g_ble.planesPushed = false;
    PlaneInfo p = g_ble.pushedPlane;
    if (p.cs.length()) g_display.notePlanes(&p, 1);
    else g_display.notePlanes(nullptr, 0);
  }

  // "Install update" from the app (BLE "ota").
  if (g_ble.otaRequested) {
    g_ble.otaRequested = false;
    otaCheck();
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
