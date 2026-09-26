// ===========================================================================
// Info Wall — Persistence.h
// ---------------------------------------------------------------------------
// Saves the whole MatrixSettings to ESP32 NVS (flash) as one JSON blob and
// restores it on boot. This means the wall retains its configuration across
// power cycles and shows the last-known content INSTANTLY on power-up — the
// phone does not need to reconnect first. handleJson() sets g_settingsDirty;
// loop() calls maybeSaveSettings() to write it (debounced) so we don't wear
// the flash on every keystroke.
// ===========================================================================
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "BLEController.h"

extern volatile bool g_settingsDirty;

inline void serializeSettings(JsonDocument &d) {
  d["radius"] = g_settings.radius;
  d["trackFlight"] = g_settings.trackFlight;
  d["flightIdent"] = g_settings.flightIdent;
  d["showWeather"] = g_settings.showWeather;
  d["lat"] = g_settings.lat;
  d["lon"] = g_settings.lon;
  d["trackingMode"] = g_settings.trackingMode;
  d["brightness"] = g_settings.brightness;
  d["scheduleEnabled"] = g_settings.scheduleEnabled;
  d["scheduleStart"] = g_settings.scheduleStart;
  d["scheduleEnd"] = g_settings.scheduleEnd;
  d["scheduleBrightness"] = g_settings.scheduleBrightness;
  d["fadeSpeed"] = g_settings.fadeSpeed;
  d["holdDurationMs"] = g_settings.holdDurationMs;
  d["showLKN"] = g_settings.showLKN;
  d["showFolly"] = g_settings.showFolly;
  d["showCountdown"] = g_settings.showCountdown;
  d["countdownLabel"] = g_settings.countdownLabel;
  d["countdownDate"] = g_settings.countdownDate;
  d["showCustomMessage"] = g_settings.showCustomMessage;
  d["msg1"] = g_settings.msgLine1;
  d["msg2"] = g_settings.msgLine2;
  d["msg3"] = g_settings.msgLine3;
  d["apiBase"] = g_settings.apiBase;
  for (int i = 0; i < 8; i++) {
    d["team"][i] = g_settings.teams[i];
    d["tc"][i] = g_settings.teamColor[i];
    d["show"][i] = g_settings.shows[i];
    d["stk"][i] = g_settings.stocks[i];
    d["pr"][i] = g_settings.stockPrice[i];
    d["chg"][i] = g_settings.stockChg[i];
  }
  for (int i = 0; i < 4; i++) {
    d["sc"][i] = g_settings.scores[i];
    d["rem"][i] = g_settings.reminders[i];
  }
}

inline void applySettings(JsonDocument &d) {
  g_settings.radius = d["radius"] | g_settings.radius;
  g_settings.trackFlight = d["trackFlight"] | g_settings.trackFlight;
  g_settings.flightIdent = (const char *)(d["flightIdent"] | "");
  g_settings.showWeather = d["showWeather"] | g_settings.showWeather;
  g_settings.lat = d["lat"] | g_settings.lat;
  g_settings.lon = d["lon"] | g_settings.lon;
  g_settings.trackingMode = (const char *)(d["trackingMode"] | "radius");
  g_settings.brightness = d["brightness"] | g_settings.brightness;
  g_settings.scheduleEnabled = d["scheduleEnabled"] | g_settings.scheduleEnabled;
  g_settings.scheduleStart = (const char *)(d["scheduleStart"] | "19:00");
  g_settings.scheduleEnd = (const char *)(d["scheduleEnd"] | "07:00");
  g_settings.scheduleBrightness = d["scheduleBrightness"] | g_settings.scheduleBrightness;
  g_settings.fadeSpeed = d["fadeSpeed"] | g_settings.fadeSpeed;
  g_settings.holdDurationMs = d["holdDurationMs"] | g_settings.holdDurationMs;
  g_settings.showLKN = d["showLKN"] | g_settings.showLKN;
  g_settings.showFolly = d["showFolly"] | g_settings.showFolly;
  g_settings.showCountdown = d["showCountdown"] | g_settings.showCountdown;
  g_settings.countdownLabel = (const char *)(d["countdownLabel"] | "");
  g_settings.countdownDate = (const char *)(d["countdownDate"] | "");
  g_settings.showCustomMessage = d["showCustomMessage"] | g_settings.showCustomMessage;
  g_settings.msgLine1 = (const char *)(d["msg1"] | "");
  g_settings.msgLine2 = (const char *)(d["msg2"] | "");
  g_settings.msgLine3 = (const char *)(d["msg3"] | "");
  g_settings.apiBase = (const char *)(d["apiBase"] | "");
  for (int i = 0; i < 8; i++) {
    g_settings.teams[i] = (const char *)(d["team"][i] | "");
    g_settings.teamColor[i] = (const char *)(d["tc"][i] | "");
    g_settings.shows[i] = (const char *)(d["show"][i] | "");
    g_settings.stocks[i] = (const char *)(d["stk"][i] | "");
    g_settings.stockPrice[i] = d["pr"][i] | 0.0f;
    g_settings.stockChg[i] = d["chg"][i] | 0.0f;
  }
  for (int i = 0; i < 4; i++) {
    g_settings.scores[i] = (const char *)(d["sc"][i] | "");
    g_settings.reminders[i] = (const char *)(d["rem"][i] | "");
  }
}

// Load saved settings on boot (call once in setup() BEFORE the display starts).
inline void loadSettings() {
  Preferences prefs;
  prefs.begin("infowall", true);  // read-only
  String blob = prefs.getString("cfg", "");
  prefs.end();
  if (blob.length() == 0) {
    Serial.println("[NVS] no saved config — using defaults");
    return;
  }
  StaticJsonDocument<4096> d;
  if (deserializeJson(d, blob) == DeserializationError::Ok) {
    applySettings(d);
    Serial.println("[NVS] restored saved config");
  }
}

// Debounced save: writes ~1.5s after the last change so rapid edits coalesce.
inline void maybeSaveSettings() {
  static unsigned long lastChange = 0;
  static bool pending = false;
  if (g_settingsDirty) {
    g_settingsDirty = false;
    pending = true;
    lastChange = millis();
    return;
  }
  if (pending && millis() - lastChange > 1500) {
    pending = false;
    StaticJsonDocument<4096> d;
    serializeSettings(d);
    String blob;
    serializeJson(d, blob);
    Preferences prefs;
    prefs.begin("infowall", false);  // read-write
    prefs.putString("cfg", blob);
    prefs.end();
    Serial.println("[NVS] settings saved");
  }
}
