// ===========================================================================
// Info Wall — BLEController.h  (ESP32 / Arduino, PlatformIO)
// ---------------------------------------------------------------------------
// Sets up the BLE service + characteristic with the app's exact UUIDs,
// advertises as "FlightWall-XXXX", receives writes, parses the JSON the app
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

// --- Must match the app exactly -------------------------------------------
static const char *SERVICE_UUID        = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
static const char *CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

// --- Global settings the rest of your firmware reads ----------------------
struct MatrixSettings {
  // Flight / weather / zone
  int   radius          = 3;
  bool  trackFlight     = false;
  String flightIdent    = "";
  bool  showWeather     = true;
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
  float  prevScore[8] = {0};    // last seen live score (score-flash detection)
  String shows[8];
  String stocks[8];
  float  stockPrice[8] = {0};
  float  stockChg[8]   = {0};   // daily % change
  String scores[4];             // live/final game score lines
  String reminders[4];          // episodes airing today

  // Wi-Fi self-fetch (panel pulls its own live data; no phone required)
  String apiBase        = "";   // e.g. "https://<host>"  (set via BLE "server")
  int    wxTemp         = 0;
  int    wxHi           = 0;
  int    wxLo           = 0;
  String wxText         = "";
  String planeLine      = "";   // nearest overhead flight
  String tvNewLine      = "";   // a show with a new episode
};

extern MatrixSettings g_settings;
extern volatile bool g_settingsDirty;

// ===========================================================================
class BLEController {
 public:
  void begin();
  // Push a JSON status string back to the app (e.g. Wi-Fi result).
  void notify(const String &json);

  // Set by the characteristic callback; call in loop() to run Wi-Fi joins
  // outside the BLE callback context.
  volatile bool wifiRequested = false;
  volatile bool flashRequested = false;
  volatile bool scoreFlashRequested = false;
  String flashAbbr;
  uint8_t flashR = 255, flashG = 106, flashB = 0;
  String pendingSsid;
  String pendingPass;

 private:
  BLEServer         *server_ = nullptr;
  BLECharacteristic *ch_     = nullptr;
  bool               connected_ = false;

  void handleJson(const String &raw);
  friend class CharCallbacks;
  friend class ServerCallbacks;
};

extern BLEController g_ble;

// ---------------------------------------------------------------------------
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *s) override {
    g_ble.connected_ = true;
    Serial.println("[BLE] app connected");
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
    String raw = String(c->getValue().c_str());
    if (raw.length() == 0) return;
    Serial.print("[BLE] rx: ");
    Serial.println(raw);
    g_ble.handleJson(raw);
  }
};

// ---------------------------------------------------------------------------
inline void BLEController::begin() {
  // Advertise a name the app scans for (prefix "FlightWall-").
  uint64_t chip = ESP.getEfuseMac();
  char name[24];
  snprintf(name, sizeof(name), "FlightWall-%04X", (uint16_t)(chip & 0xFFFF));

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

  service->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.print("[BLE] advertising as ");
  Serial.println(name);
}

inline void BLEController::notify(const String &json) {
  if (!ch_ || !connected_) return;
  ch_->setValue((uint8_t *)json.c_str(), json.length());
  ch_->notify();
  Serial.print("[BLE] tx: ");
  Serial.println(json);
}

// ---------------------------------------------------------------------------
// Parse one incoming JSON object and update g_settings. No reboot required.
inline void BLEController::handleJson(const String &raw) {
  StaticJsonDocument<2048> doc;
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
    for (int i = 0; i < 8; i++) { g_settings.teams[i] = ""; g_settings.teamColor[i] = ""; }
    JsonArray arr = doc["teams"].as<JsonArray>();
    int i = 0;
    for (JsonVariant v : arr) { if (i < 8) g_settings.teams[i++] = v.as<const char *>(); }
    JsonArray col = doc["colors"].as<JsonArray>();
    int j = 0;
    for (JsonVariant v : col) { if (j < 8) g_settings.teamColor[j++] = v.as<const char *>(); }

  } else if (strcmp(cmd, "server") == 0) {
    // Base URL of the app backend so the panel can fetch its own live data.
    g_settings.apiBase = (const char *)(doc["url"] | "");

  } else if (strcmp(cmd, "shows") == 0) {
    for (int i = 0; i < 8; i++) g_settings.shows[i] = "";
    JsonArray arr = doc["shows"].as<JsonArray>();
    int i = 0;
    for (JsonVariant v : arr) { if (i < 8) g_settings.shows[i++] = v.as<const char *>(); }

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

  } else if (strcmp(cmd, "flight") == 0) {
    g_settings.trackFlight = doc["trackFlight"] | g_settings.trackFlight;
    g_settings.flightIdent = (const char *)(doc["flightIdent"] | g_settings.flightIdent.c_str());

  } else if (strcmp(cmd, "weather") == 0) {
    g_settings.showWeather = doc["showWeather"] | g_settings.showWeather;
    g_settings.lat = doc["lat"] | g_settings.lat;
    g_settings.lon = doc["lon"] | g_settings.lon;

  } else if (strcmp(cmd, "zone") == 0) {
    g_settings.trackingMode = (const char *)(doc["trackingMode"] | g_settings.trackingMode.c_str());
    // doc["polygon"] is an array of [lat,lon] pairs — parse if you use it.

  } else if (strcmp(cmd, "transitions") == 0) {
    g_settings.fadeSpeed      = doc["fadeSpeed"]      | g_settings.fadeSpeed;
    g_settings.holdDurationMs = doc["holdDurationMs"] | g_settings.holdDurationMs;
    g_settings.showLKN        = doc["showLKN"]        | g_settings.showLKN;
    g_settings.showFolly      = doc["showFolly"]      | g_settings.showFolly;
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

  } else if (strcmp(cmd, "wifi") == 0) {
    // Defer the actual join to loop() (don't block the BLE callback).
    pendingSsid   = (const char *)(doc["ssid"] | "");
    pendingPass   = (const char *)(doc["password"] | "");
    wifiRequested = true;

  } else {
    // ---- No "command" => this is a FULL SYNC (flat settings object) -------
    g_settings.radius          = doc["radius"]          | g_settings.radius;
    g_settings.trackFlight     = doc["trackFlight"]     | g_settings.trackFlight;
    g_settings.flightIdent     = (const char *)(doc["flightIdent"] | g_settings.flightIdent.c_str());
    g_settings.showWeather     = doc["showWeather"]     | g_settings.showWeather;
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
      g_settings.shows[i]  = (const char *)(doc[vk] | "");
      g_settings.stocks[i] = (const char *)(doc[sk] | "");
    }
    // Optional read-back so the app shows "confirmed": echo the same JSON.
    if (ch_) ch_->setValue((uint8_t *)raw.c_str(), raw.length());
  }

  // Persist the latest config to flash (debounced in loop) and redraw so
  // changes show instantly and survive a power cycle.
  g_settingsDirty = true;
}
