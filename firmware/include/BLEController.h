// ===========================================================================
// Info Wall — BLEController.h  (ESP32 / Arduino, PlatformIO)
// ---------------------------------------------------------------------------
// Sets up the BLE service + characteristic with the app's exact UUIDs,
// advertises as "InfoWall-XXXX", receives writes, parses the JSON the app
// sends, and dispatches each `command`. It also notifies the app back with the
// Wi-Fi status. Drop your actual matrix-drawing code into the marked TODOs.
//
// IMPORTANT: The app sends RAW JSON bytes (it base64s only for its JS library,
// which decodes before transmit). So here we parse getValue() directly — no
// base64 decoding.
// ===========================================================================
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <WiFi.h>
#include <time.h>
#include <sys/time.h>
#include "Version.h"
#include "PsramJson.h"
#include "WeatherIcons.h"

// --- Must match the app exactly -------------------------------------------
static const char *SERVICE_UUID        = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
static const char *CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// POSIX timezone for the wall's clock + evening schedule. US Eastern with
// automatic daylight-saving (DST starts 2nd Sun of Mar, ends 1st Sun of Nov).
// Used by both the BLE-triggered Wi-Fi join and the auto-reconnect sync path.
#define INFOWALL_TZ "EST5EDT,M3.2.0,M11.1.0"

// One aircraft in range, as the flight card needs it.
struct PlaneInfo {
  String cs;        // callsign (identity), e.g. "AAL2854" / "N381MG"
  String ident;     // flight number to show, e.g. "AA2854" (falls back to cs)
  String airline;   // "American Airlines" ("" for private)
  String logo;      // logo key (ICAO; brand for regionals)
  String code;      // ICAO airline prefix for the text badge
  String from, to;  // route IATA codes (may be empty)
  String type;      // aircraft type, e.g. "A319"
  String line;      // legacy one-liner (older app push), e.g. "American 5.8mi"
  int    alt = -1, spd = -1;  // ft, mph (-1 = n/a)
  float  dist = -1;           // mi (-1 = n/a)
};

// One index row on the optional Markets page.
struct MarketInfo {
  String name;            // "S&P 500"
  float  value = 0;       // index level
  float  pct = 0;         // % change vs previous close
  bool   hasPct = false;
  int8_t spark[34];       // 0..13 (0 = bottom), -1 = no data for that column
  int    sparkLen = 0;    // columns filled so far today
  int    base = -1;       // previous-close level on the same scale (-1 = n/a)
};

// A VIP aircraft near the wall (/api/device/vip): Air Force One, a VC-25A,
// Special Air Mission (SAM) jets. Shown only as an interrupt card.
struct VipInfo {
  String key;     // AF1 | AF2 | VC25 | SAM | EXEC | VENUS
  String label;   // "AIR FORCE ONE"
  String cs, hex, type, reg, dir;
  float  dist = -1;
  long   alt = 0;
  int8_t vr = 0;  // 1 climbing, -1 descending
  int    hdg = 0, spd = 0;
};

// --- Global settings the rest of your firmware reads ----------------------
struct MatrixSettings {
  // Flight / weather / zone
  int   radius          = 3;
  bool  trackFlight     = false;
  String flightIdent    = "";
  bool  showWeather     = true;
  bool  showForecast    = false;  // 3-day forecast page (app toggle, default off)
  bool  showMoon        = true;   // moon phase + sunrise/sunset page (Weather section)
  float lat             = 0.0f;
  float lon             = 0.0f;
  String trackingMode   = "radius";   // "radius" | "polygon"

  // Display
  int   brightness      = 80;         // 0-100
  bool  scheduleEnabled = false;
  String scheduleStart  = "19:00";
  String scheduleEnd    = "07:00";
  int   scheduleBrightness = 40;
  bool  isPinned        = false;      // freeze/lock screen

  // Transitions + travel countdown
  int   fadeSpeed       = 5;          // 1-10
  int   holdDurationMs  = 12000;
  bool  showLKN         = true;
  bool  showFolly       = true;
  bool  showMarkets     = false;      // optional S&P/Dow/Nasdaq page (app toggle)
  bool  showCountdown   = true;
  String countdownLabel = "";
  String countdownDate  = "";         // "YYYY-MM-DD"

  // Custom 3-line message
  bool  showCustomMessage = false;
  String msgLine1       = "";
  String msgLine2       = "";
  String msgLine3       = "";

  // Content
  String teams[8];
  String teamColor[8];          // "#RRGGBB" per team (for on-device score flash)
  float  prevScore[8] = {-1,-1,-1,-1,-1,-1,-1,-1};    // last seen live score (score-flash detection)
  String shows[MAX_SHOWS];
  String stocks[8];
  float  stockPrice[8] = {0};
  float  stockChg[8]   = {0};   // daily % change
  bool   stockOk[8]    = {true, true, true, true, true, true, true, true};
                                // false = live feed returned no data (e.g. delisted)
  String scores[4];             // live/final game score lines
  String reminders[4];          // episodes airing today
  String teamRecord[8];         // "12-5" win-loss, aligned to teams[]
  String teamLabel[8];          // per-team next-game / live / final label
  String teamHL[8];             // per-team highlight: live|recent|today|soon|...
  // Pinned flight status from /api/device/flight (not persisted).
  int8_t flightOk = -1;         // -1 unknown/not fetched, 0 not found, 1 verified
  String flightNo = "";         // normalized IATA flight number
  String flightAl = "";         // airline short name
  String flightRoute = "";      // "MCO > CLT" or "" when unknown
  bool flightAir = false;
  long flightAlt = 0;
  long flightDmi = -1;          // miles to destination, -1 unknown
  String flightEta = "";        // ET arrival "9:41"
  String flightTo = "";
  String showLabel[MAX_SHOWS];          // per-show schedule label (next ep / season start)
  MarketInfo markets[3];        // /api/device/markets
  int    marketCount = 0;
  String marketStatus = "";     // "Open" | "Pre-mkt" | "After hrs" | "Closed"
  String teamShort[8];          // compact <=16-char status ("Sat 7:05p @ TB")
  uint32_t teamTs[8] = {0};     // epoch when teamLabel/teamShort were last set (0 = unknown)
  // One-team-per-page game card (backend fields op/ha/s/o/or/st/nd/nt).
  String teamOpp[8];            // opponent abbr ("TB")
  String teamOppRec[8];         // opponent record
  String teamStatus[8];         // readable status ("Top 8th", "2nd 18:26", "FINAL")
  String teamNextDay[8];        // "TOMORROW" / "TUE OCT 6"
  String teamNextTime[8];       // "8:20 PM"
  int8_t teamHome[8]     = {-1, -1, -1, -1, -1, -1, -1, -1};  // 1 home, 0 away, -1 unknown
  int16_t teamScore[8]   = {-1, -1, -1, -1, -1, -1, -1, -1};
  int16_t teamOppScore[8] = {-1, -1, -1, -1, -1, -1, -1, -1};

  // Sky pages (1.1.17): ISS + VIP alerts (Flights section), day/night map
  // (Display section). Defaults ON; older saved settings without the keys
  // keep these defaults.
  bool showIss  = true;
  bool showMap  = true;
  bool vipAlert = true;
  // Big clock page (1.1.20, Display section). clockColor indexes BIGCLK_COLORS.
  bool    showBigClock = true;
  uint8_t clockColor   = 0;
  bool    clock24      = false;
  // /api/device/sky (not persisted)
  int8_t moonIl = -1;           // illumination % (-1 = not fetched)
  bool   moonWax = true;
  String moonPh, sunRise, sunSet, moonRise;
  bool   moonRiseTmw = false;
  bool   issOk = false;
  int    issMi = 0;             // height now, miles
  uint32_t issNvR = 0;          // next VISIBLE pass: rise epoch
  String issNvDay, issNvTime, issNvFr, issNvTo;
  int    issNvEl = 0, issNvMin = 0;
  uint32_t issPR = 0, issPE = 0;  // next pass of any kind (rise/set epoch)
  int    issPEl = 0;
  String issPFr, issPTo;
  // /api/device/vip (not persisted)
  VipInfo vip[2];
  int    vipN = 0;

  // Mom Wall "simple mode" (1.2.0). Off = the wall behaves exactly as 1.1.21.
  // On: teams / stocks / markets / ISS / VIP / lake / tides / countdown are
  // hidden, planes are locked to 3 mi around Mooresville 28117 (slide skipped
  // when none), and the daily slides below join the rotation.
  bool simpleMode = false;
  bool smPlanes = true, smTv = true;           // simple-mode-only toggles
  bool smLake = true;                         // 1.2.4: Lake Norman slide on Mom Wall
  bool smBorn = true, smWord = true, smCFact = true, smCToday = true, smMath = true, smFamily = true;
  // 1.3.0 Trivia section (main walls, normal mode). Ignored in simple mode,
  // which keeps its own sm* toggles. Defaults: all on except Math.
  bool tvOn = true, tvBorn = true, tvComposer = true, tvMusicDay = true, tvWord = true,
       tvOrigin = true, tvCFact = true, tvMath = false;
  // 1.3.0: nightly (~3 AM + jitter) SHA-verified self-update on the wall's own
  // channel (main, or simple for Mom Wall). Default on.
  bool autoUpdate = true;
  // /api/device/daily (persisted so the slides show right after a reboot)
  String dyDate, dyWord, dyPron, dyPos, dyDef, dyOrigin, dyEx;
  String dyBorn, dyBornDesc, dyCFact, dyCToday, dyCDesc, dyCKind, dyMathBig, dyMathText, dyFam, dyFamFrom;
  String dyEarthT, dyEarthTopic, dyEarthText;   // 1.2.21 geography / geology fact
  int dyBornYear = 0, dyCTYear = 0;

  // Dog walk-by (a sprite of Adam's dachshund crosses the bottom of the panel)
  bool dogEnabled = true;
  int  dogMinMin  = 10;         // random interval between walks, minutes
  int  dogMaxMin  = 30;

  // Wi-Fi self-fetch (panel pulls its own live data; no phone required)
  String apiBase        = "";   // e.g. "https://<host>"  (set via BLE "server")
  int    wxTemp         = 0;
  int    wxHi           = 0;
  int    wxLo           = 0;
  String wxText         = "";
  // 3-day forecast (next 3 days after today) from /api/weather/current "fc".
  uint8_t fcN           = 0;
  String  fcDay[3];
  uint8_t fcIcon[3]     = {2, 2, 2};
  int16_t fcHi[3]       = {0, 0, 0};
  int16_t fcLo[3]       = {0, 0, 0};
  String planeLine      = "";   // nearest overhead flight
  String planeCode      = "";   // airline IATA/ICAO code for the badge (e.g. DAL)
  // Every aircraft currently in range (backend /api/device/planes, nearest
  // first). Each one is its own page in the rotation; a newly seen callsign
  // interrupts the rotation once (see DisplayManager::notePlanes).
  PlaneInfo planes[6];
  int    planeCount     = 0;
  unsigned long planesFetchMs = 0;  // last successful panel-side fetch (millis)
  String tvNewLine      = "";   // a show with a new episode

  // Folly Beach tides (NOAA 8665424) + Lake Norman (Duke Energy + USGS).
  String follyL1        = "";   // next tide, e.g. "H 9:31p 6.2ft"
  String follyL2        = "";   // following tide
  int    follyWater     = 0;    // water temp F (0 = n/a)
  String follyDir       = "";   // "in" (rising) | "out" (falling) | ""
  String lakeLvl        = "";   // current level, e.g. "97.5"
  String lakeFull       = "";   // vs full pond, e.g. "-2.5"
  String lakeTgt        = "";   // Duke guide-curve target, e.g. "98.5"
  String lakeTgtDiff    = "";   // level vs target, e.g. "-1.0"
  int    lakeWater      = 0;    // water temp F (0 = n/a)
};

extern MatrixSettings g_settings;

// Store up to 3 forecast days ({"d","i","h","l"}) from the server or the phone.
inline void applyForecast(JsonArrayConst fc) {
  uint8_t n = 0;
  for (JsonObjectConst d : fc) {
    if (n >= 3) break;
    if (d["h"].isNull() || d["l"].isNull()) continue;
    g_settings.fcDay[n]  = (const char *)(d["d"] | "");
    g_settings.fcIcon[n] = wxIconIndex(d["i"] | "cloud");
    g_settings.fcHi[n]   = d["h"].as<int>();
    g_settings.fcLo[n]   = d["l"].as<int>();
    n++;
  }
  if (n) g_settings.fcN = n;   // keep the last good forecast on an empty reply
}
extern volatile bool g_settingsDirty;

// ===========================================================================
// Mom Wall defaults (1.2.2): backend URL + 28117 location when unset.
inline void simpleDefaults() {
  if (!g_settings.simpleMode) return;
  if (g_settings.apiBase.length() == 0) g_settings.apiBase = "https://info-wall-api.vercel.app";
  if (g_settings.lat == 0.0f && g_settings.lon == 0.0f) { g_settings.lat = 35.58f; g_settings.lon = -80.82f; }
}

class BLEController {
 public:
  void begin();
  // Push a JSON status string back to the app (e.g. Wi-Fi result).
  void notify(const String &json);

  // Set by the characteristic callback; call in loop() to run Wi-Fi joins
  // outside the BLE callback context.
  volatile bool wifiRequested = false;
  volatile bool wifiScanRequested = false; // BLE "wifiScan": loop() scans + notifies
  volatile bool flashRequested = false;
  volatile bool scoreFlashRequested = false;
  volatile bool otaRequested = false;   // BLE "ota": check + install update
  volatile bool diagRequested = false;  // BLE "diag": loop() notifies a status JSON
  volatile bool dogNowRequested = false; // BLE "dog" now:true -> walk immediately
  volatile bool dogResched = false;      // dog settings changed -> pick a new time
  volatile bool planesPushed = false;   // phone pushed a nearest plane (fallback)
  PlaneInfo pushedPlane;
  String flashAbbr;
  uint8_t flashR = 255, flashG = 106, flashB = 0;
  String pendingSsid;
  String pendingPass;

 private:
  BLEServer         *server_ = nullptr;
  BLECharacteristic *ch_     = nullptr;
  bool               connected_ = false;
  // What a READ of the characteristic should return. The BLE stack stores
  // every incoming WRITE as the characteristic value (before onWrite runs),
  // which used to wipe the {"fw":...} hello — the app then read back its own
  // command and showed the firmware as "pre-1.1". onWrite restores this.
  String             lastValue_;

  // Make sure a stored JSON object always carries "fw" so a READ at any
  // moment tells the app which firmware this is.
  static String withFw(const String &json) {
    if (!json.startsWith("{") || json.indexOf("\"fw\"") >= 0) return json;
    String body = json.substring(1);
    body.trim();
    String o = "{\"fw\":\"" INFOWALL_FW_VERSION "\"";
    if (!body.startsWith("}")) o += ",";
    return o + body;
  }
  // Called from both the BLE task (onWrite/onConnect) and loop() (notify),
  // so the shared String is guarded by a mutex.
  SemaphoreHandle_t valueLock_ = nullptr;
  void store(const String &json) {
    String v = withFw(json);
    if (valueLock_) xSemaphoreTake(valueLock_, portMAX_DELAY);
    lastValue_ = v;
    if (ch_) ch_->setValue((uint8_t *)lastValue_.c_str(), lastValue_.length());
    if (valueLock_) xSemaphoreGive(valueLock_);
  }
  void restoreValue() {
    if (valueLock_) xSemaphoreTake(valueLock_, portMAX_DELAY);
    if (ch_) ch_->setValue((uint8_t *)lastValue_.c_str(), lastValue_.length());
    if (valueLock_) xSemaphoreGive(valueLock_);
  }

  void handleJson(const String &raw);
  // 1.1.21: writes are queued by onWrite and parsed in loop() (processPending),
  // so the Bluedroid BTC task (small stack) never runs JSON parsing / String
  // churn. The full sync + clock command overflowed it in 1.1.20 -> reboot.
  static const int kQ = 8;
  String q_[kQ];
  int qHead_ = 0, qLen_ = 0;
  void enqueue(const String &raw) {
    if (valueLock_) xSemaphoreTake(valueLock_, portMAX_DELAY);
    if (qLen_ == kQ) { qHead_ = (qHead_ + 1) % kQ; qLen_--; }   // drop oldest
    q_[(qHead_ + qLen_) % kQ] = raw;
    qLen_++;
    if (valueLock_) xSemaphoreGive(valueLock_);
  }
 public:
  void processPending() {
    for (;;) {
      String raw;
      if (valueLock_) xSemaphoreTake(valueLock_, portMAX_DELAY);
      if (qLen_ > 0) { raw = q_[qHead_]; q_[qHead_] = String(); qHead_ = (qHead_ + 1) % kQ; qLen_--; }
      if (valueLock_) xSemaphoreGive(valueLock_);
      if (raw.length() == 0) return;
      Serial.print("[BLE] rx: ");
      Serial.println(raw);
      handleJson(raw);
    }
  }
 private:
  friend class CharCallbacks;
  friend class ServerCallbacks;
};

extern BLEController g_ble;

// ---------------------------------------------------------------------------
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *s) override {
    g_ble.connected_ = true;
    Serial.println("[BLE] app connected");
    // Let the app READ which firmware this is right after connecting (before
    // it sends anything). Firmware older than 1.1.0 never exposes "fw", which
    // is how the app knows not to send "version"/"ota" to it.
    g_ble.store("{\"ready\":true,\"fw\":\"" INFOWALL_FW_VERSION "\"}");
  }
  void onDisconnect(BLEServer *s) override {
    g_ble.connected_ = false;
    Serial.println("[BLE] app disconnected — re-advertising");
    s->getAdvertising()->start();
  }
};

// ---------------------------------------------------------------------------
class CharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    // Raw JSON bytes (NOT base64).
    // Copy and queue only; loop() parses (see processPending).
    std::string v = c->getValue();
    if (v.empty()) return;
    g_ble.enqueue(String(v.c_str()));
    // Undo the stack's "value = what was just written": put back the last
    // status/hello (always with "fw"), or the read-back echo set by a sync.
    g_ble.restoreValue();
  }
};

// ---------------------------------------------------------------------------
inline void BLEController::begin() {
  // Advertise a name the app scans for (prefix "InfoWall-").
  // Suffix = LAST two MAC bytes, as printed at the end of the MAC address
  // (AA:BB:CC:DD:EE:FF -> "EEFF"). getEfuseMac() is little-endian (byte 0 is
  // the low byte), so the old `chip & 0xFFFF` was bytes 0-1: the manufacturer
  // prefix, identical on every board of a batch.
  uint64_t chip = ESP.getEfuseMac();
  char name[24];
  snprintf(name, sizeof(name), "InfoWall-%02X%02X",
           (unsigned)((chip >> 32) & 0xFF), (unsigned)((chip >> 40) & 0xFF));

  if (!valueLock_) valueLock_ = xSemaphoreCreateMutex();
  BLEDevice::init(name);
  server_ = BLEDevice::createServer();
  server_->setCallbacks(new ServerCallbacks());

  BLEService *service = server_->createService(SERVICE_UUID);
  ch_ = service->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE |
          BLECharacteristic::PROPERTY_WRITE_NR |
          BLECharacteristic::PROPERTY_NOTIFY);
  ch_->addDescriptor(new BLE2902());   // enables notifications
  ch_->setCallbacks(new CharCallbacks());
  store("{\"ready\":true,\"fw\":\"" INFOWALL_FW_VERSION "\"}");

  service->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.print("[BLE] advertising as ");
  Serial.println(name);
}

inline void BLEController::notify(const String &json) {
  if (!ch_) return;
  // ALWAYS store the value so the app can READ it back as a fallback, even if
  // the BLE link briefly dropped when Wi-Fi started (radio coexistence) and
  // the live notification below was lost.
  store(json);
  if (connected_) {
    ch_->notify();
    Serial.print("[BLE] tx: ");
    Serial.println(json);
  } else {
    Serial.print("[BLE] stored (not connected): ");
    Serial.println(json);
  }
}

// ---------------------------------------------------------------------------
// Parse one incoming JSON object and update g_settings. No reboot required.
inline void BLEController::handleJson(const String &raw) {
  PSRAM_JSON(doc);
  DeserializationError err = deserializeJson(doc, raw);
  if (err) {
    Serial.print("[JSON] parse error: ");
    Serial.println(err.c_str());
    return;
  }

  const char *cmd = doc["command"] | "";

  // ---- Live commands ------------------------------------------------------
  if (strcmp(cmd, "brightness") == 0) {
    g_settings.brightness = doc["brightness"] | g_settings.brightness;

  } else if (strcmp(cmd, "radius") == 0) {
    g_settings.radius = doc["radius"] | g_settings.radius;

  } else if (strcmp(cmd, "schedule") == 0) {
    g_settings.scheduleEnabled    = doc["scheduleEnabled"]    | g_settings.scheduleEnabled;
    g_settings.scheduleStart      = (const char *)(doc["scheduleStart"] | g_settings.scheduleStart.c_str());
    g_settings.scheduleEnd        = (const char *)(doc["scheduleEnd"]   | g_settings.scheduleEnd.c_str());
    g_settings.scheduleBrightness = doc["scheduleBrightness"] | g_settings.scheduleBrightness;

  } else if (strcmp(cmd, "pin") == 0) {
    g_settings.isPinned = doc["isPinned"] | g_settings.isPinned;

  } else if (strcmp(cmd, "teams") == 0) {
    // The app re-sends the same list on every connect / Sync. Only a slot whose
    // team actually changed loses its game details; an identical resend must
    // not wipe the card (that forced the old row layout with "--" until the
    // next successful Wi-Fi fetch).
    String nt[8];
    JsonArray arr = doc["teams"].as<JsonArray>();
    int i = 0;
    for (JsonVariant v : arr) { if (i < 8) nt[i++] = (const char *)(v | ""); }
    for (int k = 0; k < 8; k++) {
      g_settings.teamColor[k] = "";
      if (nt[k] == g_settings.teams[k]) continue;
      g_settings.teams[k] = nt[k];
      g_settings.teamLabel[k] = ""; g_settings.teamShort[k] = ""; g_settings.teamRecord[k] = "";
      g_settings.teamHL[k] = "";
      g_settings.teamOpp[k] = ""; g_settings.teamOppRec[k] = ""; g_settings.teamStatus[k] = "";
      g_settings.teamNextDay[k] = ""; g_settings.teamNextTime[k] = "";
      g_settings.teamHome[k] = -1; g_settings.teamScore[k] = -1; g_settings.teamOppScore[k] = -1;
      g_settings.teamTs[k] = 0;
    }
    JsonArray col = doc["colors"].as<JsonArray>();
    int j = 0;
    for (JsonVariant v : col) { if (j < 8) g_settings.teamColor[j++] = v.as<const char *>(); }

  } else if (strcmp(cmd, "server") == 0) {
    // Base URL of the app backend so the panel can fetch its own live data.
    g_settings.apiBase = (const char *)(doc["url"] | "");

  } else if (strcmp(cmd, "shows") == 0) {
    for (int i = 0; i < MAX_SHOWS; i++) g_settings.shows[i] = "";
    JsonArray arr = doc["shows"].as<JsonArray>();
    int i = 0;
    for (JsonVariant v : arr) { if (i < MAX_SHOWS) g_settings.shows[i++] = v.as<const char *>(); }

  } else if (strcmp(cmd, "stocks") == 0) {
    for (int i = 0; i < 8; i++) {
      char key[8], pk[8], ck[8];
      snprintf(key, sizeof(key), "stock%d", i + 1);
      snprintf(pk, sizeof(pk), "price%d", i + 1);
      snprintf(ck, sizeof(ck), "chg%d", i + 1);
      g_settings.stocks[i] = (const char *)(doc[key] | "");
      g_settings.stockPrice[i] = doc[pk] | 0.0f;
      g_settings.stockChg[i] = doc[ck] | 0.0f;
    }

  } else if (strcmp(cmd, "message") == 0) {
    // { showCustomMessage, line1, line2, line3 }
    g_settings.showCustomMessage = doc["showCustomMessage"] | g_settings.showCustomMessage;
    g_settings.msgLine1 = (const char *)(doc["line1"] | g_settings.msgLine1.c_str());
    g_settings.msgLine2 = (const char *)(doc["line2"] | g_settings.msgLine2.c_str());
    g_settings.msgLine3 = (const char *)(doc["line3"] | g_settings.msgLine3.c_str());

  } else if (strcmp(cmd, "scores") == 0) {
    for (int i = 0; i < 4; i++) {
      char k[10];
      snprintf(k, sizeof(k), "score%d", i + 1);
      g_settings.scores[i] = (const char *)(doc[k] | "");
    }

  } else if (strcmp(cmd, "reminders") == 0) {
    for (int i = 0; i < 4; i++) {
      char k[12];
      snprintf(k, sizeof(k), "reminder%d", i + 1);
      g_settings.reminders[i] = (const char *)(doc[k] | "");
    }

  } else if (strcmp(cmd, "teamdetails") == 0) {
    // Per-team record + next-game label + highlight, pushed by the phone so the
    // panel shows details even when its own Wi-Fi fetch is unavailable. Slot i
    // matches the "teams" array order (teamN <-> slot i).
    for (int i = 0; i < 8; i++) {
      char rk[8], lk[8], hk[8];
      snprintf(rk, sizeof(rk), "rec%d", i + 1);
      snprintf(lk, sizeof(lk), "lbl%d", i + 1);
      snprintf(hk, sizeof(hk), "hl%d", i + 1);
      // The app sends "" before its own team lookup has finished; keep what
      // the panel already has rather than blanking the row.
      const char *lbl = doc[lk] | "";
      if (!lbl[0]) continue;
      const char *rec = doc[rk] | "";
      if (rec[0]) g_settings.teamRecord[i] = rec;
      g_settings.teamLabel[i] = lbl;
      g_settings.teamHL[i] = (const char *)(doc[hk] | "");
      // The phone's label is newer than any compact Wi-Fi label; drop that so
      // the display doesn't prefer a stale teamShort over it.
      g_settings.teamShort[i] = "";
      g_settings.teamTs[i] = (uint32_t)time(nullptr);
    }

  } else if (strcmp(cmd, "teamcard") == 0) {
    // One team's game-card fields from the app (Wi-Fi fallback, app 1.1.2+):
    // { i:1-8, op, ha:"h"|"a", s, o, or, st, nd, nt }. Sent per team so the
    // write stays well under the BLE attribute size limit.
    int i = (doc["i"] | 0) - 1;
    if (i < 0 || i >= 8) return;
    auto str = [&](const char *k, String &dst) { if (!doc[k].isNull()) dst = (const char *)(doc[k] | ""); };
    auto num = [&](const char *k, int16_t &dst) {
      if (!doc[k].isNull()) dst = doc[k].is<int>() ? (int16_t)doc[k].as<int>() : -1;
    };
    str("op", g_settings.teamOpp[i]);
    str("or", g_settings.teamOppRec[i]);
    str("st", g_settings.teamStatus[i]);
    str("nd", g_settings.teamNextDay[i]);
    str("nt", g_settings.teamNextTime[i]);
    num("s", g_settings.teamScore[i]);
    num("o", g_settings.teamOppScore[i]);
    if (!doc["ha"].isNull()) {
      const char *ha = doc["ha"] | "";
      g_settings.teamHome[i] = ha[0] == 'h' ? 1 : (ha[0] == 'a' ? 0 : -1);
    }
    g_settings.teamTs[i] = (uint32_t)time(nullptr);

  } else if (strcmp(cmd, "showdetails") == 0) {
    // Per-show schedule label pushed by the phone (fallback to Wi-Fi fetch).
    for (int i = 0; i < MAX_SHOWS; i++) {
      char lk[8];
      snprintf(lk, sizeof(lk), "lbl%d", i + 1);
      g_settings.showLabel[i] = (const char *)(doc[lk] | "");
    }

  } else if (strcmp(cmd, "folly") == 0) {
    // Phone-pushed Folly tides fallback (when the panel's own fetch is down).
    g_settings.follyL1    = (const char *)(doc["l1"] | "");
    g_settings.follyL2    = (const char *)(doc["l2"] | "");
    g_settings.follyWater = doc["w"] | 0;
    g_settings.follyDir   = (const char *)(doc["dir"] | "");

  } else if (strcmp(cmd, "lake") == 0) {
    // Phone-pushed Lake Norman level + water temp fallback.
    g_settings.lakeLvl    = (const char *)(doc["lvl"] | "");
    g_settings.lakeFull   = (const char *)(doc["full"] | "");
    // Optional (app with target support): keep the Wi-Fi value otherwise.
    if (!doc["tgt"].isNull()) g_settings.lakeTgt = (const char *)(doc["tgt"] | "");
    if (!doc["dt"].isNull())  g_settings.lakeTgtDiff = (const char *)(doc["dt"] | "");
    g_settings.lakeWater  = doc["w"] | 0;

  } else if (strcmp(cmd, "planes") == 0) {
    // Phone-pushed nearest overhead flight (fallback to the panel's own fetch).
    g_settings.planeLine  = (const char *)(doc["line"] | "");
    g_settings.planeCode  = (const char *)(doc["code"] | "");
    // Only used when the panel can't fetch planes itself (no Wi-Fi / backend
    // for 2+ minutes) — otherwise the panel's own full list wins.
    if (g_settings.planesFetchMs == 0 || millis() - g_settings.planesFetchMs > 120000UL) {
      PlaneInfo p;
      p.cs      = (const char *)(doc["f"] | (doc["code"] | ""));
      p.ident   = (const char *)(doc["fn"] | (doc["f"] | ""));
      p.airline = (const char *)(doc["al"] | "");
      p.logo    = (const char *)(doc["lg"] | (doc["code"] | ""));
      p.code    = (const char *)(doc["code"] | "");
      p.from    = (const char *)(doc["fr"] | "");
      p.to      = (const char *)(doc["to"] | "");
      p.type    = (const char *)(doc["typ"] | "");
      p.line    = g_settings.planeLine;
      p.alt     = doc["alt"].isNull() ? -1 : doc["alt"].as<int>();
      p.spd     = doc["spd"].isNull() ? -1 : doc["spd"].as<int>();
      p.dist    = doc["d"].isNull() ? -1.0f : doc["d"].as<float>();
      planesPushed = true;
      pushedPlane = p;
    }
    return;  // live data — no need to persist to flash

  } else if (strcmp(cmd, "settime") == 0) {
    // Phone-pushed wall clock. The phone always knows the correct time, so this
    // sets the RTC even when NTP (UDP 123) is blocked on the local network.
    // Force US-Eastern (auto-DST) so localtime() is correct regardless of how
    // (or whether) Wi-Fi connected.
    long epoch = doc["epoch"] | 0L;
    if (epoch > 1000000000L) {
      setenv("TZ", INFOWALL_TZ, 1);
      tzset();
      struct timeval tv;
      tv.tv_sec = (time_t)epoch;
      tv.tv_usec = 0;
      settimeofday(&tv, nullptr);
      Serial.printf("[BLE] clock set via phone epoch=%ld\n", epoch);
    }

  } else if (strcmp(cmd, "flight") == 0) {
    g_settings.trackFlight = doc["trackFlight"] | g_settings.trackFlight;
    g_settings.flightIdent = (const char *)(doc["flightIdent"] | g_settings.flightIdent.c_str());

  } else if (strcmp(cmd, "weather") == 0) {
    g_settings.showWeather = doc["showWeather"] | g_settings.showWeather;
    g_settings.lat = doc["lat"] | g_settings.lat;
    g_settings.lon = doc["lon"] | g_settings.lon;
    // Optional live conditions pushed by the phone so weather renders even when
    // the panel's own HTTPS fetch is unavailable.
    if (!doc["temp"].isNull()) g_settings.wxTemp = doc["temp"].as<int>();
    if (!doc["hi"].isNull()) g_settings.wxHi = doc["hi"].as<int>();
    if (!doc["lo"].isNull()) g_settings.wxLo = doc["lo"].as<int>();
    if (!doc["text"].isNull()) g_settings.wxText = (const char *)(doc["text"] | "");
    g_settings.showForecast = doc["showForecast"] | g_settings.showForecast;
    g_settings.showMoon = doc["showMoon"] | g_settings.showMoon;
    // Optional phone-pushed forecast: "fc": [{"d":"Mon","i":"sun","h":81,"l":57}, ...]
    if (doc["fc"].is<JsonArrayConst>()) applyForecast(doc["fc"].as<JsonArrayConst>());

  } else if (strcmp(cmd, "sky") == 0) {
    // App 1.4.1+: { showMoon, showIss, showMap, vipAlert } (any subset).
    g_settings.showMoon = doc["showMoon"] | g_settings.showMoon;
    g_settings.showIss  = doc["showIss"]  | g_settings.showIss;
    g_settings.showMap  = doc["showMap"]  | g_settings.showMap;
    g_settings.vipAlert = doc["vipAlert"] | g_settings.vipAlert;

  } else if (strcmp(cmd, "simple") == 0) {
    // Mom Wall (1.2.0): { simpleMode, planes, tv, born, word, cfact, ctoday,
    // math, family } (any subset). Weather/moon/map/clock use their own commands.
    g_settings.simpleMode = doc["simpleMode"] | g_settings.simpleMode;
    g_settings.smPlanes   = doc["planes"]     | g_settings.smPlanes;
    g_settings.smTv       = doc["tv"]         | g_settings.smTv;
    g_settings.smBorn     = doc["born"]       | g_settings.smBorn;
    g_settings.smWord     = doc["word"]       | g_settings.smWord;
    g_settings.smCFact    = doc["cfact"]      | g_settings.smCFact;
    g_settings.smCToday   = doc["ctoday"]     | g_settings.smCToday;
    g_settings.smMath     = doc["math"]       | g_settings.smMath;
    g_settings.smFamily   = doc["family"]     | g_settings.smFamily;
    g_settings.smLake     = doc["lake"]       | g_settings.smLake;
    // 1.2.2: a wall set up only with the Mom app never got the backend URL or
    // a location (the main app sends those), so it fetched nothing. Default
    // them when simple mode is on and they're unset.
    simpleDefaults();
    notify(String("{\"simple\":") + (g_settings.simpleMode ? 1 : 0) + "}");

  } else if (strcmp(cmd, "trivia") == 0) {
    // 1.3.0: { tvOn, born, composer, musicDay, word, origin, cfact, math } (any subset).
    g_settings.tvOn       = doc["tvOn"]     | g_settings.tvOn;
    g_settings.tvBorn     = doc["born"]     | g_settings.tvBorn;
    g_settings.tvComposer = doc["composer"] | g_settings.tvComposer;
    g_settings.tvMusicDay = doc["musicDay"] | g_settings.tvMusicDay;
    g_settings.tvWord     = doc["word"]     | g_settings.tvWord;
    g_settings.tvOrigin   = doc["origin"]   | g_settings.tvOrigin;
    g_settings.tvCFact    = doc["cfact"]    | g_settings.tvCFact;
    g_settings.tvMath     = doc["math"]     | g_settings.tvMath;
    notify(String("{\"trivia\":") + (g_settings.tvOn ? 1 : 0) + "}");

  } else if (strcmp(cmd, "autoupdate") == 0) {
    // 1.3.0: { nightly: bool }
    g_settings.autoUpdate = doc["nightly"] | g_settings.autoUpdate;
    notify(String("{\"autoupdate\":") + (g_settings.autoUpdate ? 1 : 0) + "}");

  } else if (strcmp(cmd, "clock") == 0) {
    // App 1.4.3+: { showBigClock, clockColor, clock24 } (any subset).
    g_settings.showBigClock = doc["showBigClock"] | g_settings.showBigClock;
    g_settings.clockColor   = constrain((int)(doc["clockColor"] | (int)g_settings.clockColor), 0, 9);
    g_settings.clock24      = doc["clock24"]      | g_settings.clock24;

  } else if (strcmp(cmd, "zone") == 0) {
    g_settings.trackingMode = (const char *)(doc["trackingMode"] | g_settings.trackingMode.c_str());
    // doc["polygon"] is an array of [lat,lon] pairs — parse if you use it.

  } else if (strcmp(cmd, "transitions") == 0) {
    g_settings.fadeSpeed      = doc["fadeSpeed"]      | g_settings.fadeSpeed;
    g_settings.holdDurationMs = doc["holdDurationMs"] | g_settings.holdDurationMs;
    g_settings.showLKN        = doc["showLKN"]        | g_settings.showLKN;
    g_settings.showFolly      = doc["showFolly"]      | g_settings.showFolly;
    g_settings.showMarkets    = doc["showMarkets"]    | g_settings.showMarkets;
    g_settings.showCountdown  = doc["showCountdown"]  | g_settings.showCountdown;
    g_settings.countdownLabel = (const char *)(doc["countdownLabel"] | g_settings.countdownLabel.c_str());
    g_settings.countdownDate  = (const char *)(doc["countdownDate"]  | g_settings.countdownDate.c_str());

  } else if (strcmp(cmd, "scoreflash") == 0) {
    // { team, abbr, color:"#RRGGBB" } — a tracked team just scored.
    flashAbbr = (const char *)(doc["abbr"] | "");
    const char *hex = doc["color"] | "#FF6A00";
    if (hex[0] == '#' && strlen(hex) >= 7) {
      auto hx = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return 0;
      };
      flashR = hx(hex[1]) * 16 + hx(hex[2]);
      flashG = hx(hex[3]) * 16 + hx(hex[4]);
      flashB = hx(hex[5]) * 16 + hx(hex[6]);
    }
    scoreFlashRequested = true;
    return;  // don't mark dirty / persist a transient flash

  } else if (strcmp(cmd, "flash_test") == 0) {
    // Ask loop() to flash a quick RGB test pattern (confirms the link).
    flashRequested = true;

  } else if (strcmp(cmd, "version") == 0) {
    // App asks which firmware is flashed -> notify {"fw":"x.y.z"} back.
    notify("{\"fw\":\"" INFOWALL_FW_VERSION "\"}");
    return;

  } else if (strcmp(cmd, "dog") == 0) {
    // { enabled, min, max } (minutes) and/or { now:true } for a test walk.
    if (!doc["enabled"].isNull()) g_settings.dogEnabled = doc["enabled"].as<bool>();
    if (!doc["min"].isNull()) g_settings.dogMinMin = constrain(doc["min"].as<int>(), 1, 720);
    if (!doc["max"].isNull()) g_settings.dogMaxMin = constrain(doc["max"].as<int>(), 1, 720);
    if (g_settings.dogMaxMin < g_settings.dogMinMin) g_settings.dogMaxMin = g_settings.dogMinMin;
    dogResched = true;
    if (doc["now"] | false) {
      dogNowRequested = true;
      if (doc["enabled"].isNull() && doc["min"].isNull()) return;  // test walk only
    }

  } else if (strcmp(cmd, "diag") == 0) {
    // App's diagnostics view. Built + notified from loop() (needs NetworkData).
    diagRequested = true;
    return;

  } else if (strcmp(cmd, "ota") == 0) {
    // App's "Install update" button. Runs in loop() (HTTPS + flash write must
    // not happen inside the BLE callback).
    otaRequested = true;
    return;

  } else if (strcmp(cmd, "wifiScan") == 0) {
    // App's Wi-Fi picker. Async scan started + reported from loop().
    wifiScanRequested = true;
    return;

  } else if (strcmp(cmd, "wifi") == 0) {
    // Defer the actual join to loop() (don't block the BLE callback).
    pendingSsid   = (const char *)(doc["ssid"] | "");
    pendingPass   = (const char *)(doc["password"] | "");
    wifiRequested = true;

  } else if (strlen(cmd) > 0) {
    // Unknown command from a newer app: ignore it. (Older firmware fell
    // through to the full-sync branch here and blanked teams/shows/stocks.)
    Serial.printf("[BLE] unknown command \"%s\" ignored\n", cmd);
    return;

  } else {
    // ---- No "command" => this is a FULL SYNC (flat settings object) -------
    g_settings.radius          = doc["radius"]          | g_settings.radius;
    g_settings.trackFlight     = doc["trackFlight"]     | g_settings.trackFlight;
    g_settings.flightIdent     = (const char *)(doc["flightIdent"] | g_settings.flightIdent.c_str());
    g_settings.showWeather     = doc["showWeather"]     | g_settings.showWeather;
    g_settings.showForecast    = doc["showForecast"]    | g_settings.showForecast;
    g_settings.showMoon        = doc["showMoon"]        | g_settings.showMoon;
    g_settings.showIss         = doc["showIss"]         | g_settings.showIss;
    g_settings.showMap         = doc["showMap"]         | g_settings.showMap;
    g_settings.vipAlert        = doc["vipAlert"]        | g_settings.vipAlert;
    g_settings.showBigClock    = doc["showBigClock"]    | g_settings.showBigClock;
    g_settings.clockColor      = constrain((int)(doc["clockColor"] | (int)g_settings.clockColor), 0, 9);
    g_settings.clock24         = doc["clock24"]         | g_settings.clock24;
    g_settings.lat             = doc["lat"]             | g_settings.lat;
    g_settings.lon             = doc["lon"]             | g_settings.lon;
    g_settings.trackingMode    = (const char *)(doc["trackingMode"] | g_settings.trackingMode.c_str());
    g_settings.brightness      = doc["brightness"]      | g_settings.brightness;
    g_settings.scheduleEnabled = doc["scheduleEnabled"] | g_settings.scheduleEnabled;
    g_settings.scheduleStart   = (const char *)(doc["scheduleStart"] | g_settings.scheduleStart.c_str());
    g_settings.scheduleEnd     = (const char *)(doc["scheduleEnd"]   | g_settings.scheduleEnd.c_str());
    g_settings.scheduleBrightness = doc["scheduleBrightness"] | g_settings.scheduleBrightness;
    for (int i = 0; i < 8; i++) {
      char tk[8], vk[8], sk[8];
      snprintf(tk, sizeof(tk), "team%d", i + 1);
      snprintf(vk, sizeof(vk), "tv%d", i + 1);
      snprintf(sk, sizeof(sk), "stock%d", i + 1);
      g_settings.teams[i]  = (const char *)(doc[tk] | "");
      g_settings.stocks[i] = (const char *)(doc[sk] | "");
    }
    for (int i = 0; i < MAX_SHOWS; i++) {
      char vk[8];
      snprintf(vk, sizeof(vk), "tv%d", i + 1);
      g_settings.shows[i] = (const char *)(doc[vk] | "");
    }
    // Optional read-back so the app shows "confirmed": echo the same JSON.
    store(raw);
  }

  // Persist the latest config to flash (debounced in loop) and redraw so
  // changes show instantly and survive a power cycle.
  g_settingsDirty = true;
}
