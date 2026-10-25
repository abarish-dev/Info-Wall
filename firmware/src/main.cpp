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
#include <utility>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Update.h>
#include "mbedtls/sha256.h"
#include <ArduinoJson.h>
#include "esp_heap_caps.h"
#include "Version.h"
#include "BLEController.h"
#include "DisplayManager.h"
#include "Persistence.h"
#include "NetworkData.h"
#include "WifiKeeper.h"
#include "DeviceId.h"

// Global instances used across the firmware.
MatrixSettings g_settings;
BLEController  g_ble;
DisplayManager g_display;
NetworkData    g_net;
WifiKeeper     g_wifi;
volatile bool  g_settingsDirty = false;

static bool s_clockSynced = false;

void tryJoinWifi(const String &ssid, const String &pass) {
  Serial.printf("[WiFi] joining \"%s\"...\n", ssid.c_str());
  // Let the app know the command was received and the join is starting. This
  // is stored on the characteristic too, so a read-poll picks it up even if
  // the live notify is missed.
  g_ble.notify("{\"wifiStatus\":\"connecting\"}");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid.c_str(), pass.c_str());
  g_wifi.noteManualJoin();

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
    g_wifi.remember(ssid, pass);   // rejoin on its own after a reboot
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

// ---- 1.2.9: one install path for the Update button AND the nightly check --
// Simple channel only. Streams the build into the spare OTA slot while
// hashing it; marks it bootable only if size + SHA-256 match. Every failure
// returns a step + code so the app can show why (BLE {"ota":"failed",...}).
struct OtaResult { bool ok; bool upToDate; const char *step; int err; String msg; String ver; };

static void otaFailNotify(const OtaResult &r) {
  String m = r.msg; m.replace("\"", "'");
  g_ble.notify(String("{\"ota\":\"failed\",\"step\":\"") + r.step + "\",\"err\":" + r.err +
               ",\"msg\":\"" + m + "\"}");
}

static OtaResult simpleInstall(bool fromApp) {
  OtaResult r{false, false, "check", 0, "", ""};
  String base = g_settings.apiBase;
  if (base.endsWith("/")) base.remove(base.length() - 1);
  String path, sha;
  long size = 0;
  {
    WiFiClientSecure c; c.setInsecure();
    HTTPClient h; h.setTimeout(12000); h.setReuse(false);
    String q = base + "/api/firmware/latest?current=" INFOWALL_FW_VERSION;
    if (g_settings.simpleMode) q += "&channel=simple";   // 1.3.0: main walls ask the main channel
    if (!h.begin(c, q)) { r.err = -1; r.msg = "begin"; return r; }
    h.setUserAgent(iwUserAgent());
    int code = h.GET();
    PSRAM_JSON(doc);
    DeserializationError je = code == 200 ? deserializeJson(doc, h.getStream()) : DeserializationError::Ok;
    h.end();
    if (code != 200) { r.err = code; r.msg = code < 0 ? HTTPClient::errorToString(code) : String("HTTP ") + code; return r; }
    if (je) { r.err = -2; r.msg = String("json ") + je.c_str(); return r; }
    { String ch = (const char *)(doc["channel"] | "main");
      if (g_settings.simpleMode ? ch != "simple" : ch == "simple") { r.ok = r.upToDate = true; return r; } }
    r.ver = (const char *)(doc["version"] | "");
    path = (const char *)(doc["url"] | "");
    sha = (const char *)(doc["sha256"] | "");
    size = doc["size"] | 0;
    if (!(doc["available"] | false) || !isNewerVersion(r.ver, INFOWALL_FW_VERSION)) { r.ok = r.upToDate = true; return r; }
    if (sha.length() != 64 || size <= 0 || !path.length()) { r.step = "manifest"; r.err = -3; r.msg = "incomplete"; return r; }
  }
  sha.toLowerCase();
  String url = path.startsWith("http") ? path : base + path;
  Serial.printf("[OTA] installing v%s (%ld bytes) heap %u\n", r.ver.c_str(), size, ESP.getFreeHeap());
  if (fromApp) {
    g_ble.notify(String("{\"ota\":\"installing\",\"version\":\"") + r.ver + "\"}");
    g_display.message("UPDATE", "v" + r.ver);
  }
  // Less memory pressure: the loop (page redraws, Wi-Fi fetches) is blocked
  // while we run; the panel just keeps showing the UPDATE card.
  r.step = "download";
  WiFiClientSecure c; c.setInsecure();
  HTTPClient h; h.setTimeout(20000); h.setReuse(false);
  if (!h.begin(c, url)) { r.err = -1; r.msg = "begin"; return r; }
  h.setUserAgent(iwUserAgent());
  int code = h.GET();
  if (code != 200) { h.end(); r.err = code; r.msg = code < 0 ? HTTPClient::errorToString(code) : String("HTTP ") + code; return r; }
  if (h.getSize() != size) { r.err = -4; r.msg = String("len ") + h.getSize(); h.end(); return r; }
  r.step = "begin";
  if (!Update.begin(size, U_FLASH)) { r.err = Update.getError(); r.msg = Update.errorString(); h.end(); return r; }
  r.step = "download";
  mbedtls_sha256_context ctx; mbedtls_sha256_init(&ctx); mbedtls_sha256_starts(&ctx, 0);
  WiFiClient *s = h.getStreamPtr();
  static uint8_t buf[4096];
  long got = 0; unsigned long last = millis(); int lastPct = -1;
  bool wfail = false;
  while (got < size && millis() - last < 20000) {
    size_t n = s->available();
    if (!n) { if (!h.connected() && !s->available()) break; delay(2); continue; }
    n = s->readBytes(buf, min((size_t)sizeof(buf), (size_t)(size - got)));
    if (!n) continue;
    mbedtls_sha256_update(&ctx, buf, n);
    if (Update.write(buf, n) != n) { wfail = true; break; }
    got += n; last = millis();
    int pct = (int)(got * 100 / size);
    if (fromApp && pct / 10 != lastPct / 10) {
      lastPct = pct;
      g_ble.notify(String("{\"ota\":\"progress\",\"pct\":") + pct + "}");
      g_display.message("UPDATE", String(pct) + "%");
    }
  }
  h.end();
  uint8_t dig[32]; mbedtls_sha256_finish(&ctx, dig); mbedtls_sha256_free(&ctx);
  char hex[65]; for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", dig[i]);
  if (wfail) { r.step = "write"; r.err = Update.getError(); r.msg = Update.errorString(); Update.abort(); return r; }
  if (got != size) { r.err = -5; r.msg = String("got ") + got + "/" + size; Update.abort(); return r; }
  if (sha != hex) { r.step = "verify"; r.err = -6; r.msg = "sha mismatch"; Update.abort(); return r; }
  r.step = "finish";
  if (!Update.end(true)) { r.err = Update.getError(); r.msg = Update.errorString(); return r; }
  r.ok = true;
  if (fromApp) { g_ble.notify("{\"ota\":\"progress\",\"pct\":100}"); g_display.message("UPDATE", "restart"); }
  Serial.println("[OTA] verified, rebooting");
  delay(500);
  ESP.restart();
  return r;
}

static void otaCheck() {
  if (WiFi.status() != WL_CONNECTED || g_settings.apiBase.length() == 0) {
    g_ble.notify("{\"ota\":\"offline\"}");
    return;
  }
  {                                     // 1.2.9 simple / 1.3.0 main: same verified path as nightly
    OtaResult r = simpleInstall(true);
    if (r.upToDate) { g_ble.notify("{\"ota\":\"uptodate\",\"fw\":\"" INFOWALL_FW_VERSION "\"}"); return; }
    if (!r.ok) {
      Serial.printf("[OTA] FAILED at %s (%d): %s\n", r.step, r.err, r.msg.c_str());
      g_display.message("UPDATE", "failed");
      otaFailNotify(r);
      delay(1500);
    }
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
    // 1.2.6: a simple-mode (Mom Wall) build asks ONLY the separate "simple"
    // channel, so it never sees the main 1.1.x builds, and main-channel walls
    // never see 1.2.x.
    String q = base + "/api/firmware/latest?current=" INFOWALL_FW_VERSION;
    if (g_settings.simpleMode) q += "&channel=simple";
    if (!http.begin(client, q)) {
      otaFailNotify({false, false, "check", -1, "begin", ""});
      return;
    }
    http.setUserAgent(iwUserAgent());
    int code = http.GET();
    PSRAM_JSON(doc);
    bool ok = code == 200 && !deserializeJson(doc, http.getStream());
    http.end();
    if (!ok) {
      Serial.printf("[OTA] latest check failed (HTTP %d)\n", code);
      otaFailNotify({false, false, "check", code, String("HTTP ") + code, ""});
      return;
    }
    ver = (const char *)(doc["version"] | "");
    path = (const char *)(doc["url"] | "/fw/firmware.bin");
    String chan = (const char *)(doc["channel"] | "main");
    bool chanOk = g_settings.simpleMode ? chan == "simple" : chan != "simple";
    if (!chanOk || !(doc["available"] | false) || !isNewerVersion(ver, INFOWALL_FW_VERSION)) {
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
  // 1.2.6: progress for the app's Update button (every 10%).
  static int lastPct; lastPct = -1;
  httpUpdate.onProgress([](int cur, int total) {
    int pct = total > 0 ? (int)((long long)cur * 100 / total) : 0;
    if (pct / 10 != lastPct / 10) {
      lastPct = pct;
      g_ble.notify(String("{\"ota\":\"progress\",\"pct\":") + pct + "}");
      g_display.message("UPDATE", String(pct) + "%");
    }
  });
  t_httpUpdate_return ret = httpUpdate.update(client, url);
  if (ret == HTTP_UPDATE_FAILED) {
    Serial.printf("[OTA] FAILED (%d): %s\n", httpUpdate.getLastError(),
                  httpUpdate.getLastErrorString().c_str());
    g_display.message("UPDATE", "failed");
    otaFailNotify({false, false, "install", httpUpdate.getLastError(), httpUpdate.getLastErrorString(), ""});
    delay(1500);
  }
}

// ---- 1.2.7: nightly self-update (simple mode / Mom Wall only) --------------
// Around 3 AM local (+ random 0-59 min jitter picked at boot) the wall asks
// the "simple" channel. A strictly newer build is streamed into the spare OTA
// slot while its SHA-256 is computed; only if size + hash match is the slot
// marked bootable and the wall rebooted. Any failure aborts the write, so the
// running version keeps going and the check is retried the next night.
static int g_nightlyJitterMin = -1;
static int g_nightlyDoneYday = -1;

static bool nightlyInstall() {
  OtaResult r = simpleInstall(false);
  if (!r.ok) Serial.printf("[NIGHTLY] failed at %s (%d): %s\n", r.step, r.err, r.msg.c_str());
  return r.ok;
}

static void nightlyTick() {
  if (!g_settings.autoUpdate) return;   // 1.3.0: all walls, own channel; app can turn it off
  static unsigned long lastLook = 0;
  if (millis() - lastLook < 30000) return;
  lastLook = millis();
  if (g_nightlyJitterMin < 0) g_nightlyJitterMin = (int)(esp_random() % 60);
  struct tm t;
  if (!getLocalTime(&t, 0) || t.tm_year < 120) return;
  if (t.tm_hour != 3 || t.tm_min < g_nightlyJitterMin || t.tm_yday == g_nightlyDoneYday) return;
  if (WiFi.status() != WL_CONNECTED || g_settings.apiBase.length() == 0) return;
  g_nightlyDoneYday = t.tm_yday;   // one attempt per night; a failure waits for tomorrow
  nightlyInstall();
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
  g_wifi.begin();       // rejoin the saved network (no phone needed)
}

// ---- Wi-Fi scan for the app's network picker (BLE "wifiScan") --------------
// Async so the display keeps animating. Results are deduped by SSID (strongest
// kept), sorted strongest first, capped at 15, and sent ONE network per notify
// ({"ws":[i,n,"ssid",rssi,secure]}) so each frame stays small, then
// {"wsDone":n}. Works while connected (STA): the radio hops channels briefly.
static bool     g_scanRunning = false;
static uint32_t g_scanStart   = 0;

static bool     g_scanPausedJoin = false;  // we stopped a join attempt to scan

static void startWifiScan() {
  if (g_scanRunning) return;
  if (WiFi.getMode() == WIFI_OFF) WiFi.mode(WIFI_STA);
  // 1.2.1: when the wall is NOT on Wi-Fi (e.g. a new home), the core's
  // auto-reconnect and WifiKeeper keep (re)starting a join to the old saved
  // network. On the ESP32 a scan can't start while the STA is connecting
  // (scanNetworks -> WIFI_SCAN_FAILED) and a WiFi.begin() mid-scan aborts it,
  // so the picker got nothing. Stop the join for the scan; resume after.
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.setAutoReconnect(false);
    WiFi.disconnect(false, false);
    g_wifi.pause(true);
    g_scanPausedJoin = true;
    delay(100);
  }
  WiFi.scanDelete();
  int16_t r = WiFi.scanNetworks(true /*async*/, false /*hidden*/);
  if (r == WIFI_SCAN_FAILED) {             // one retry after a short settle
    delay(300);
    r = WiFi.scanNetworks(true, false);
  }
  if (r == WIFI_SCAN_FAILED) {
    Serial.println("[WiFi] scan failed to start");
    if (g_scanPausedJoin) { g_scanPausedJoin = false; WiFi.setAutoReconnect(true); g_wifi.pause(false); }
    g_ble.notify("{\"wsDone\":-1}");
    return;
  }
  g_scanRunning = true;
  g_scanStart = millis();
  Serial.println("[WiFi] scan started");
}

static String jsonEsc(const String &in) {
  String o;
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if ((uint8_t)c < 0x20) o += ' ';
    else o += c;
  }
  return o;
}

static void pollWifiScan() {
  if (!g_scanRunning) return;
  int16_t n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) {
    if (millis() - g_scanStart < 15000) return;
    n = WIFI_SCAN_FAILED;  // give up
  }
  g_scanRunning = false;
  if (g_scanPausedJoin) {                    // let the saved-network join resume
    g_scanPausedJoin = false;
    WiFi.setAutoReconnect(true);
    g_wifi.pause(false);
  }
  if (n < 0) { WiFi.scanDelete(); g_ble.notify("{\"wsDone\":-1}"); return; }

  const int MAXN = 15;
  String ss[MAXN]; int32_t rs[MAXN]; bool sec[MAXN]; int cnt = 0;
  for (int i = 0; i < n; i++) {
    String s = WiFi.SSID(i);
    if (s.length() == 0) continue;           // hidden network
    int32_t r = WiFi.RSSI(i);
    bool lock = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    int dup = -1;
    for (int k = 0; k < cnt; k++) if (ss[k] == s) { dup = k; break; }
    if (dup >= 0) { if (r > rs[dup]) { rs[dup] = r; sec[dup] = lock; } continue; }
    if (cnt < MAXN) { ss[cnt] = s; rs[cnt] = r; sec[cnt] = lock; cnt++; }
    else {                                    // replace the weakest if stronger
      int w = 0; for (int k = 1; k < cnt; k++) if (rs[k] < rs[w]) w = k;
      if (r > rs[w]) { ss[w] = s; rs[w] = r; sec[w] = lock; }
    }
  }
  WiFi.scanDelete();
  for (int a = 0; a < cnt; a++)               // sort strongest first
    for (int b = a + 1; b < cnt; b++)
      if (rs[b] > rs[a]) { std::swap(ss[a], ss[b]); std::swap(rs[a], rs[b]); std::swap(sec[a], sec[b]); }
  for (int i = 0; i < cnt; i++) {
    g_ble.notify(String("{\"ws\":[") + i + "," + cnt + ",\"" + jsonEsc(ss[i]) + "\"," +
                 rs[i] + "," + (sec[i] ? 1 : 0) + "]}");
    delay(15);  // let each notify drain
  }
  g_ble.notify(String("{\"wsDone\":") + cnt + "}");
  Serial.printf("[WiFi] scan done: %d networks (%d unique)\n", n, cnt);
}

void loop() {
  // Parse BLE writes here, not in the BLE task (1.1.21).
  g_ble.processPending();

  // Handle a Wi-Fi request that arrived over BLE (run outside the callback).
  if (g_ble.wifiRequested) {
    g_ble.wifiRequested = false;
    tryJoinWifi(g_ble.pendingSsid, g_ble.pendingPass);
  }

  // Wi-Fi picker scan (BLE "wifiScan").
  if (g_ble.wifiScanRequested) {
    g_ble.wifiScanRequested = false;
    startWifiScan();
  }
  pollWifiScan();

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

  // Diagnostics for the app (BLE "diag"): firmware, saved URL, Wi-Fi/IP,
  // heap and the last result of every Wi-Fi fetch.
  // Dog walk-by: app's "Walk now" button / changed frequency.
  if (g_ble.dogResched) { g_ble.dogResched = false; g_display.dogReschedule(); }
  if (g_ble.dogNowRequested) { g_ble.dogNowRequested = false; g_display.dogNow(); }

  if (g_ble.diagRequested) {
    g_ble.diagRequested = false;
    g_ble.notify(g_net.diagJson());
  }

  // Pull our own live data over Wi-Fi (scores/prices/weather/planes/TV) so the
  // panel stays current without the phone. Safe no-op until Wi-Fi + apiBase set.
  g_wifi.tick();
  g_net.tick();
  nightlyTick();   // 1.2.7: Mom Wall self-update ~3 AM

  // Render the current module (reads live from g_settings). DisplayManager
  // honors brightness, schedule, pin, hold/fade timing and visibility toggles.
  g_display.tick();

  // Persist any config changes to flash (debounced) so they survive a reboot.
  maybeSaveSettings();

  delay(15);
}
