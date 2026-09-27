// ===========================================================================
// Info Wall — NetworkData.h
// ---------------------------------------------------------------------------
// Makes the panel SELF-SUFFICIENT: it pulls its own live data over Wi-Fi from
// the Info Wall backend (set via the BLE "server" command) and updates the
// display fields directly — no phone required once configured.
//
// Feeds + intervals (per product spec):
//   - scores  : every 30s   -> /api/device/scores  (+ on-device SCORE flash)
//   - quotes  : every 120s  -> /api/device/quotes
//   - weather : every 900s  -> /api/weather/current
//   - planes  : every 30s   -> /api/device/planes
//   - tv      : every 3600s -> /api/device/tv
//
// HTTPS via WiFiClientSecure (setInsecure — no cert pinning). Uses ArduinoJson
// with small documents since the /device/* payloads are compact.
// ===========================================================================
#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "BLEController.h"
#include "DisplayManager.h"

extern DisplayManager g_display;

class NetworkData {
 public:
  void tick() {
    if (WiFi.status() != WL_CONNECTED || g_settings.apiBase.length() == 0)
      return;
    unsigned long now = millis();
    if (due(now, tScores_, 30000))   fetchScores();
    if (due(now, tQuotes_, 120000))  fetchQuotes();
    if (due(now, tWeather_, 900000)) fetchWeather();
    if (due(now, tPlanes_, 30000))   fetchPlanes();
    if (due(now, tTv_, 3600000))     fetchTv();
  }

 private:
  unsigned long tScores_ = 0, tQuotes_ = 0, tWeather_ = 0, tPlanes_ = 0, tTv_ = 0;

  static bool due(unsigned long now, unsigned long &last, unsigned long every) {
    if (last != 0 && now - last < every) return false;
    last = now == 0 ? 1 : now;
    return true;
  }

  static String enc(const String &s) {
    String o;
    for (char c : s) {
      if (c == ' ') o += "%20";
      else if (c == ':') o += "%3A";
      else if (c == '|') o += "%7C";
      else if (c == ',') o += "%2C";
      else o += c;
    }
    return o;
  }

  // Perform a GET and deserialize into doc. Returns true on success.
  bool getJson(const String &path, JsonDocument &doc) {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    String url = g_settings.apiBase + path;
    if (!http.begin(client, url)) return false;
    http.setTimeout(9000);
    int code = http.GET();
    bool ok = false;
    if (code == 200) {
      ok = deserializeJson(doc, http.getStream()) == DeserializationError::Ok;
    } else {
      Serial.printf("[NET] %s -> HTTP %d\n", path.c_str(), code);
    }
    http.end();
    return ok;
  }

  String csvTeams() {
    String s;
    for (int i = 0; i < 8; i++)
      if (g_settings.teams[i].length()) {
        if (s.length()) s += "|";
        s += g_settings.teams[i];
      }
    return s;
  }

  void fetchScores() {
    String teams = csvTeams();
    if (!teams.length()) return;
    JsonDocument doc;
    if (!getJson("/api/device/scores?teams=" + enc(teams), doc)) return;
    // Store per-team (aligned to g_settings.teams[]) so the display can show
    // the team abbr with its own record + next game / live score.
    for (JsonVariant e : doc["t"].as<JsonArray>()) {
      const char *code = e["c"] | "";
      int slot = teamSlot(code);
      if (slot < 0) continue;
      g_settings.teamLabel[slot]  = (const char *)(e["l"] | "");
      g_settings.teamRecord[slot] = (const char *)(e["r"] | "");
      g_settings.teamHL[slot]     = (const char *)(e["h"] | "");
      // On-device SCORE flash: a live team's score went up since last check.
      if (strcmp(g_settings.teamHL[slot].c_str(), "live") == 0 && !e["s"].isNull()) {
        float sc = e["s"].as<float>();
        if (g_settings.prevScore[slot] > 0 && sc > g_settings.prevScore[slot]) {
          uint8_t r, gg, b;
          teamRGB(code, r, gg, b);
          g_display.scoreFlash(abbrOf(code), r, gg, b);
        }
        g_settings.prevScore[slot] = sc;
      }
    }
  }

  void fetchQuotes() {
    String syms;
    for (int i = 0; i < 8; i++)
      if (g_settings.stocks[i].length()) {
        if (syms.length()) syms += ",";
        syms += g_settings.stocks[i];
      }
    if (!syms.length()) return;
    JsonDocument doc;
    if (!getJson("/api/device/quotes?symbols=" + enc(syms), doc)) return;
    // Track which configured symbols the feed actually priced this cycle.
    bool present[8] = {false, false, false, false, false, false, false, false};
    for (JsonVariant q : doc["q"].as<JsonArray>()) {
      const char *sym = q["s"] | "";
      float price = q["p"] | 0.0f;
      for (int i = 0; i < 8; i++) {
        if (g_settings.stocks[i] == sym) {
          g_settings.stockPrice[i] = price;
          g_settings.stockChg[i] = q["c"] | 0.0f;
          if (price > 0) present[i] = true;
        }
      }
    }
    // A configured symbol the feed didn't price (or priced <= 0) has no live
    // data — flag it so the panel can mark it instead of showing it stale.
    for (int i = 0; i < 8; i++)
      if (g_settings.stocks[i].length())
        g_settings.stockOk[i] = present[i];
  }

  void fetchWeather() {
    if (!g_settings.showWeather) return;
    char path[64];
    snprintf(path, sizeof(path), "/api/weather/current?lat=%.4f&lon=%.4f",
             g_settings.lat, g_settings.lon);
    JsonDocument doc;
    if (!getJson(path, doc)) return;
    if (!doc["temp"].isNull()) g_settings.wxTemp = doc["temp"].as<int>();
    if (!doc["hi"].isNull()) g_settings.wxHi = doc["hi"].as<int>();
    if (!doc["lo"].isNull()) g_settings.wxLo = doc["lo"].as<int>();
    g_settings.wxText = (const char *)(doc["text"] | "");
  }

  void fetchPlanes() {
    char path[80];
    snprintf(path, sizeof(path), "/api/device/planes?lat=%.4f&lon=%.4f&radius=%d",
             g_settings.lat, g_settings.lon, g_settings.radius);
    JsonDocument doc;
    if (!getJson(path, doc)) return;
    JsonArray p = doc["p"].as<JsonArray>();
    if (p.size() > 0) {
      JsonVariant f = p[0];
      String al = (const char *)(f["al"] | "");
      String cs = (const char *)(f["f"] | "");
      g_settings.planeLine = (al.length() ? al : cs);
      if (!f["d"].isNull())
        g_settings.planeLine += " " + String(f["d"].as<float>(), 1) + "mi";
    } else {
      g_settings.planeLine = "";
    }
  }

  void fetchTv() {
    String names;
    for (int i = 0; i < 8; i++)
      if (g_settings.shows[i].length()) {
        if (names.length()) names += "|";
        names += g_settings.shows[i];
      }
    if (!names.length()) return;
    JsonDocument doc;
    if (!getJson("/api/device/tv?names=" + enc(names), doc)) return;
    // Store each show's schedule label (next episode / season start) aligned
    // to shows[] so the panel can show WHEN, not just the show name.
    for (JsonVariant v : doc["v"].as<JsonArray>()) {
      const char *nm = v["n"] | "";
      const char *lbl = v["l"] | "";
      for (int i = 0; i < 8; i++)
        if (g_settings.shows[i] == nm) g_settings.showLabel[i] = lbl;
    }
  }

  int teamSlot(const char *code) {
    for (int i = 0; i < 8; i++)
      if (g_settings.teams[i] == code) return i;
    return -1;
  }

  String abbrOf(const char *code) {
    String c = code;
    int colon = c.indexOf(':');
    return colon >= 0 ? c.substring(colon + 1) : c;
  }

  void teamRGB(const char *code, uint8_t &r, uint8_t &g, uint8_t &b) {
    r = 255; g = 106; b = 0;  // default ember
    int slot = teamSlot(code);
    if (slot < 0) return;
    String hex = g_settings.teamColor[slot];
    if (hex.length() >= 7 && hex[0] == '#') {
      auto hx = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return 0;
      };
      r = hx(hex[1]) * 16 + hx(hex[2]);
      g = hx(hex[3]) * 16 + hx(hex[4]);
      b = hx(hex[5]) * 16 + hx(hex[6]);
    }
  }
};
