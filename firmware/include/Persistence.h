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

// /api/device/daily payload (also the persisted "dy" copy) -> settings.
inline void applyDaily(JsonObjectConst y) {
  auto s = [&](const char *k) { return String((const char *)(y[k] | "")); };
  g_settings.dyDate = s("d"); g_settings.dyWord = s("w"); g_settings.dyPron = s("wp"); g_settings.dyPos = s("ws");
  g_settings.dyDef = s("wd"); g_settings.dyOrigin = s("wo"); g_settings.dyEx = s("wx");
  g_settings.dyBorn = s("bn"); g_settings.dyBornDesc = s("bd"); g_settings.dyBornYear = y["by"] | 0;
  g_settings.dyCFact = s("cf"); g_settings.dyCToday = s("ct"); g_settings.dyCDesc = s("cx");
  g_settings.dyCKind = s("ck"); g_settings.dyCTYear = y["cy"] | 0;
  g_settings.dyMathBig = s("mb"); g_settings.dyMathText = s("mt");
  g_settings.dyEarthT = s("gt"); g_settings.dyEarthTopic = s("gs"); g_settings.dyEarthText = s("gx");
  g_settings.dySpT = s("pt"); g_settings.dySpTopic = s("ps"); g_settings.dySpText = s("px");
  g_settings.dyYidT = s("yt"); g_settings.dyYidWord = s("ys"); g_settings.dyYidText = s("yx");
  g_settings.dyHisT = s("ht"); g_settings.dyHisYear = s("hs"); g_settings.dyHisText = s("hx");
  g_settings.dyFam = s("fm"); g_settings.dyFamFrom = s("ff");
}

// The daily payload lives in its own NVS key ("dy", ~0.5 KB) so the main
// "cfg" blob stays well under the NVS string limit. Written when a new day's
// content arrives (about once a day), read on boot in simple mode.
inline void saveDaily(const String &json) {
  Preferences prefs;
  prefs.begin("infowall", false);
  prefs.putString("dy", json);
  prefs.end();
}
inline void loadDaily() {
  Preferences prefs;
  prefs.begin("infowall", true);
  String blob = prefs.getString("dy", "");
  prefs.end();
  if (!blob.length()) return;
  PSRAM_JSON(d);
  if (deserializeJson(d, blob) == DeserializationError::Ok) applyDaily(d.as<JsonObjectConst>());
}

inline void serializeSettings(JsonDocument &d) {
  d["radius"] = g_settings.radius;
  d["trackFlight"] = g_settings.trackFlight;
  d["flightIdent"] = g_settings.flightIdent;
  d["showWeather"] = g_settings.showWeather;
  d["showForecast"] = g_settings.showForecast;
  d["sMoon"] = g_settings.showMoon;
  d["sIss"] = g_settings.showIss;
  d["sMap"] = g_settings.showMap;
  d["sClk"] = g_settings.showBigClock;
  d["cClr"] = g_settings.clockColor;
  d["c24"]  = g_settings.clock24;
  d["sVip"] = g_settings.vipAlert;
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
  d["showMkts"] = g_settings.showMarkets;
  d["showCountdown"] = g_settings.showCountdown;
  d["dog"] = g_settings.dogEnabled;
  // 1.2.0 simple mode (absent in older saves -> off / defaults)
  d["simple"] = g_settings.simpleMode;
  d["smF"] = (g_settings.smPlanes ? 1 : 0) | (g_settings.smTv ? 2 : 0) | (g_settings.smBorn ? 4 : 0) |
             (g_settings.smWord ? 8 : 0) | (g_settings.smCFact ? 16 : 0) | (g_settings.smCToday ? 32 : 0) |
             (g_settings.smMath ? 64 : 0) | (g_settings.smFamily ? 128 : 0);
  d["smL"] = g_settings.smLake;
  d["smX"] = (g_settings.smEarth ? 1 : 0) | (g_settings.smYid ? 2 : 0) | (g_settings.smHist ? 4 : 0);   // 1.2.23
  // 1.3.0 Trivia toggles + nightly update (absent in older saves -> defaults)
  d["tvF"] = (g_settings.tvOn ? 1 : 0) | (g_settings.tvBorn ? 2 : 0) | (g_settings.tvComposer ? 4 : 0) |
             (g_settings.tvMusicDay ? 8 : 0) | (g_settings.tvWord ? 16 : 0) | (g_settings.tvOrigin ? 32 : 0) |
             (g_settings.tvCFact ? 64 : 0) | (g_settings.tvMath ? 128 : 0);
  d["tvX"] = (g_settings.tvYid ? 1 : 0) | (g_settings.tvHist ? 2 : 0);   // 1.3.3, own key so old saves default on
  d["auU"] = g_settings.autoUpdate;
  d["dogMin"] = g_settings.dogMinMin;
  d["dogMax"] = g_settings.dogMaxMin;
  d["countdownLabel"] = g_settings.countdownLabel;
  d["countdownDate"] = g_settings.countdownDate;
  d["showCustomMessage"] = g_settings.showCustomMessage;
  d["msg1"] = g_settings.msgLine1;
  d["msg2"] = g_settings.msgLine2;
  d["msg3"] = g_settings.msgLine3;
  d["apiBase"] = g_settings.apiBase;
  d["wxTemp"] = g_settings.wxTemp;
  d["wxHi"] = g_settings.wxHi;
  d["wxLo"] = g_settings.wxLo;
  d["wxText"] = g_settings.wxText;
  d["follyL1"] = g_settings.follyL1;
  d["follyL2"] = g_settings.follyL2;
  d["follyW"] = g_settings.follyWater;
  d["follyDir"] = g_settings.follyDir;
  d["lakeLvl"] = g_settings.lakeLvl;
  d["lakeFull"] = g_settings.lakeFull;
  d["lakeTgt"] = g_settings.lakeTgt;
  d["lakeTgtD"] = g_settings.lakeTgtDiff;
  d["lakeW"] = g_settings.lakeWater;
  // Older saves hold 8 shows; missing slots load as "".
  for (int i = 0; i < MAX_SHOWS; i++) {
    d["show"][i] = g_settings.shows[i];
    d["slbl"][i] = g_settings.showLabel[i];
  }
  for (int i = 0; i < 8; i++) {
    d["team"][i] = g_settings.teams[i];
    d["tc"][i] = g_settings.teamColor[i];
    d["stk"][i] = g_settings.stocks[i];
    d["pr"][i] = g_settings.stockPrice[i];
    d["chg"][i] = g_settings.stockChg[i];
    d["trec"][i] = g_settings.teamRecord[i];
    d["tlbl"][i] = g_settings.teamLabel[i];
    d["thl"][i] = g_settings.teamHL[i];
    d["tts"][i] = g_settings.teamTs[i];
    d["top"][i] = g_settings.teamOpp[i];
    d["tor"][i] = g_settings.teamOppRec[i];
    d["tst"][i] = g_settings.teamStatus[i];
    d["tnd"][i] = g_settings.teamNextDay[i];
    d["tnt"][i] = g_settings.teamNextTime[i];
    d["tha"][i] = g_settings.teamHome[i];
    d["tsc"][i] = g_settings.teamScore[i];
    d["tos"][i] = g_settings.teamOppScore[i];
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
  g_settings.showForecast = d["showForecast"] | g_settings.showForecast;
  // 1.1.17 keys: absent in older saves -> keep the struct defaults (ON).
  g_settings.showMoon = d["sMoon"] | g_settings.showMoon;
  g_settings.showIss  = d["sIss"]  | g_settings.showIss;
  g_settings.showMap  = d["sMap"]  | g_settings.showMap;
  g_settings.showBigClock = d["sClk"] | g_settings.showBigClock;
  g_settings.clockColor   = constrain((int)(d["cClr"] | (int)g_settings.clockColor), 0, 9);
  g_settings.clock24      = d["c24"]  | g_settings.clock24;
  g_settings.vipAlert = d["sVip"]  | g_settings.vipAlert;
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
  g_settings.showMarkets = d["showMkts"] | g_settings.showMarkets;
  g_settings.showCountdown = d["showCountdown"] | g_settings.showCountdown;
  g_settings.dogEnabled = d["dog"] | g_settings.dogEnabled;
  g_settings.simpleMode = d["simple"] | false;
  {
    int f = d["smF"] | 255;
    g_settings.smPlanes = f & 1; g_settings.smTv = f & 2; g_settings.smBorn = f & 4; g_settings.smWord = f & 8;
    g_settings.smCFact = f & 16; g_settings.smCToday = f & 32; g_settings.smMath = f & 64; g_settings.smFamily = f & 128;
  }
  g_settings.smLake = d["smL"] | true;   // 1.2.4, default on
  { int x = d["smX"] | 7; g_settings.smEarth = x & 1; g_settings.smYid = x & 2; g_settings.smHist = x & 4; }   // 1.2.23
  {
    int f = d["tvF"] | 127;   // 1.3.0 default: all on except Math (128)
    g_settings.tvOn = f & 1; g_settings.tvBorn = f & 2; g_settings.tvComposer = f & 4; g_settings.tvMusicDay = f & 8;
    g_settings.tvWord = f & 16; g_settings.tvOrigin = f & 32; g_settings.tvCFact = f & 64; g_settings.tvMath = f & 128;
  }
  { int x = d["tvX"] | 3; g_settings.tvYid = x & 1; g_settings.tvHist = x & 2; }
  g_settings.autoUpdate = d["auU"] | true;
  g_settings.dogMinMin = d["dogMin"] | g_settings.dogMinMin;
  g_settings.dogMaxMin = d["dogMax"] | g_settings.dogMaxMin;
  g_settings.countdownLabel = (const char *)(d["countdownLabel"] | "");
  g_settings.countdownDate = (const char *)(d["countdownDate"] | "");
  g_settings.showCustomMessage = d["showCustomMessage"] | g_settings.showCustomMessage;
  g_settings.msgLine1 = (const char *)(d["msg1"] | "");
  g_settings.msgLine2 = (const char *)(d["msg2"] | "");
  g_settings.msgLine3 = (const char *)(d["msg3"] | "");
  g_settings.apiBase = (const char *)(d["apiBase"] | "");
  g_settings.wxTemp = d["wxTemp"] | g_settings.wxTemp;
  g_settings.wxHi = d["wxHi"] | g_settings.wxHi;
  g_settings.wxLo = d["wxLo"] | g_settings.wxLo;
  g_settings.wxText = (const char *)(d["wxText"] | "");
  g_settings.follyL1 = (const char *)(d["follyL1"] | "");
  g_settings.follyL2 = (const char *)(d["follyL2"] | "");
  g_settings.follyWater = d["follyW"] | 0;
  g_settings.follyDir = (const char *)(d["follyDir"] | "");
  g_settings.lakeLvl = (const char *)(d["lakeLvl"] | "");
  g_settings.lakeFull = (const char *)(d["lakeFull"] | "");
  g_settings.lakeTgt = (const char *)(d["lakeTgt"] | "");
  g_settings.lakeTgtDiff = (const char *)(d["lakeTgtD"] | "");
  g_settings.lakeWater = d["lakeW"] | 0;
  for (int i = 0; i < MAX_SHOWS; i++) {
    g_settings.shows[i] = (const char *)(d["show"][i] | "");
    g_settings.showLabel[i] = (const char *)(d["slbl"][i] | "");
  }
  for (int i = 0; i < 8; i++) {
    g_settings.teams[i] = (const char *)(d["team"][i] | "");
    g_settings.teamColor[i] = (const char *)(d["tc"][i] | "");
    g_settings.stocks[i] = (const char *)(d["stk"][i] | "");
    g_settings.stockPrice[i] = d["pr"][i] | 0.0f;
    g_settings.stockChg[i] = d["chg"][i] | 0.0f;
    g_settings.teamRecord[i] = (const char *)(d["trec"][i] | "");
    g_settings.teamLabel[i] = (const char *)(d["tlbl"][i] | "");
    g_settings.teamHL[i] = (const char *)(d["thl"][i] | "");
    g_settings.teamTs[i] = d["tts"][i] | (uint32_t)0;
    g_settings.teamOpp[i] = (const char *)(d["top"][i] | "");
    g_settings.teamOppRec[i] = (const char *)(d["tor"][i] | "");
    g_settings.teamStatus[i] = (const char *)(d["tst"][i] | "");
    g_settings.teamNextDay[i] = (const char *)(d["tnd"][i] | "");
    g_settings.teamNextTime[i] = (const char *)(d["tnt"][i] | "");
    g_settings.teamHome[i] = d["tha"][i] | (int8_t)-1;
    g_settings.teamScore[i] = d["tsc"][i] | (int16_t)-1;
    g_settings.teamOppScore[i] = d["tos"][i] | (int16_t)-1;
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
  PSRAM_JSON(d);
  if (deserializeJson(d, blob) == DeserializationError::Ok) {
    applySettings(d);
    Serial.println("[NVS] restored saved config");
    if (g_settings.simpleMode) { loadDaily(); simpleDefaults(); }
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
    PSRAM_JSON(d);
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
