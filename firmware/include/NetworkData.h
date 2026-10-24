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
//   - flight  : every 60s   -> /api/device/flight (only when a flight is pinned)
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
#include <sys/time.h>
#include "BLEController.h"
#include "PsramJson.h"
#include "Version.h"
#include "DisplayManager.h"
#include "WifiKeeper.h"
#include "Persistence.h"

extern DisplayManager g_display;

// Endpoints the panel fetches, for retry bookkeeping and the BLE "diag" reply.
enum Endpoint { EP_TIME, EP_SCORES, EP_PLANES, EP_QUOTES, EP_MARKETS, EP_WEATHER,
                EP_FOLLY, EP_LAKE, EP_TV, EP_FLIGHT, EP_SKY, EP_VIP, EP_DAILY, EP_COUNT };
static const char *const kEpNames[EP_COUNT] = {"time", "sc", "pl", "qt", "mk",
                                               "wx", "fo", "lk", "tv", "fl",
                                               "sky", "vip", "dy"};
// Result codes besides HTTP status: -1 connection/TLS error, -2 skipped (low
// internal heap), -3 JSON parse error, 0 never attempted.
struct EpStat {
  int16_t code = 0;
  unsigned long atMs = 0;   // last attempt
  unsigned long okMs = 0;   // last success
};

class NetworkData {
 public:
  void tick() {
    if (WiFi.status() != WL_CONNECTED) {
      // Next time the link is up, start SNTP again (it may have been lost).
      if (!clockValid_) clockSynced_ = false;
      return;
    }
    // Sync the clock the first time Wi-Fi comes up — regardless of HOW it
    // connected. The ESP32 silently auto-reconnects to stored creds on boot
    // (no BLE join), so without this the weather clock + evening schedule
    // would never get an NTP time. Cheap + idempotent to call once.
    // (Re)start SNTP whenever the link comes (back) up, and again every 5 min
    // while the clock is still unset, so a missed first sync isn't permanent.
    unsigned long nowMs = millis();
    if (!clockSynced_ || (!clockValid_ && nowMs - tNtp_ > 300000UL)) {
      configTzTime(INFOWALL_TZ, "pool.ntp.org", "time.nist.gov", "time.google.com");
      clockSynced_ = true;
      tNtp_ = nowMs | 1;
    }
    if (g_settings.apiBase.length() == 0)
      return;
    unsigned long now = millis();
    // Only ONE HTTPS fetch at a time, with a minimum gap between any two.
    // Doing 5 TLS handshakes back-to-back (which is what happens on the first
    // tick after Wi-Fi connects, when every feed is "due") fragments the heap
    // and makes later handshakes EOF (-29312). Spacing them lets RAM recover.
    if (now - tLastFetch_ < kFetchGapMs) return;
    // A fetch blocks the loop for up to several seconds; don't start one while
    // the dog is crossing the screen (it would freeze mid-step).
    if (g_display.dogActive()) return;

    // Clock fallback: some networks block NTP (UDP 123) while allowing HTTPS,
    // so getLocalTime() may never succeed. If the clock still isn't valid,
    // fetch the current epoch over HTTPS (proven to work) and set the RTC.
    if (!clockValid_) {
      struct tm t;
      if (getLocalTime(&t, 5)) {
        clockValid_ = true;
      } else if (due(now, tTimeHttp_, 15000)) {
        httpSyncTime();
        tLastFetch_ = now;
        return;
      }
    }

    // Mom Wall simple mode (1.2.0): its own, smaller schedule. Teams, stocks,
    // markets, VIP, lake and tides are never fetched; planes only while the
    // Planes toggle is on (locked to 3 mi around 28117 in fetchPlanes).
    if (g_settings.simpleMode) {
      if (g_settings.smPlanes && due(now, tPlanes_, 30000)) { settle(now, tPlanes_, 30000, fetchPlanes()); tLastFetch_ = now; return; }
      if (due(now, tWeather_, 900000)) { settle(now, tWeather_, 900000, fetchWeather());  tLastFetch_ = now; return; }
      if (dailyDue(now)) { settle(now, tDaily_, 1800000, fetchDaily()); tLastFetch_ = now; return; }
      if (g_settings.showMoon && due(now, tSky_, 900000)) { settle(now, tSky_, 900000, fetchSky()); tLastFetch_ = now; return; }
      if (g_settings.smTv && due(now, tTv_, 3600000)) { settle(now, tTv_, 3600000, fetchTv()); tLastFetch_ = now; return; }
      return;
    }
    // A fetch only counts as done when it SUCCEEDS. On a skip (low heap) or a
    // failure it is retried in ~30s instead of waiting its full interval
    // (an hour for lake/TV), which is what left the lake page blank.
    if (due(now, tScores_, 30000))   { settle(now, tScores_, 30000, fetchScores());     tLastFetch_ = now; return; }
    // VIP alert (interrupt-only): light 60 s poll, server caches adsb.lol 30 s.
    if (g_settings.vipAlert && due(now, tVip_, 60000)) { settle(now, tVip_, 60000, fetchVip()); tLastFetch_ = now; return; }
    if (due(now, tPlanes_, 30000))   { settle(now, tPlanes_, 30000, fetchPlanes());     tLastFetch_ = now; return; }
    if (due(now, tQuotes_, 120000))  { settle(now, tQuotes_, 120000, fetchQuotes());    tLastFetch_ = now; return; }
    if (g_settings.showMarkets && due(now, tMarkets_, 60000)) { settle(now, tMarkets_, 60000, fetchMarkets()); tLastFetch_ = now; return; }
    if (due(now, tWeather_, 900000)) { settle(now, tWeather_, 900000, fetchWeather());  tLastFetch_ = now; return; }
    if (due(now, tFolly_, 1800000))  { settle(now, tFolly_, 1800000, fetchFolly());     tLastFetch_ = now; return; }
    if (due(now, tLake_, 3600000))   { settle(now, tLake_, 3600000, fetchLake());       tLastFetch_ = now; return; }
    if ((g_settings.showMoon || g_settings.showIss) && due(now, tSky_, 900000)) { settle(now, tSky_, 900000, fetchSky()); tLastFetch_ = now; return; }
    if (due(now, tTv_, 3600000))     { settle(now, tTv_, 3600000, fetchTv());           tLastFetch_ = now; return; }
    if (g_settings.trackFlight && g_settings.flightIdent.length()) {
      if (g_settings.flightIdent != flightFor_) { flightFor_ = g_settings.flightIdent; tFlight_ = 0; g_settings.flightOk = -1; }
      if (due(now, tFlight_, 60000)) { settle(now, tFlight_, 60000, fetchFlight()); tLastFetch_ = now; return; }
    }
  }

  // Compact status for the app's diagnostics (BLE "diag"). Per endpoint:
  // [last result code, seconds since last attempt, seconds since last OK]
  // (-1 = never).
  String diagJson() {
    unsigned long now = millis();
    auto ago = [now](unsigned long t) -> long { return t ? (long)((now - t) / 1000) : -1L; };
    bool up = WiFi.status() == WL_CONNECTED;
    String j = "{\"diag\":1,\"fw\":\"" INFOWALL_FW_VERSION "\",\"url\":\"";
    j += g_settings.apiBase;
    j += "\",\"wifi\":";
    j += up ? "1" : "0";
    j += ",\"ip\":\"";
    j += up ? WiFi.localIP().toString() : String("");
    j += "\",\"rssi\":" + String(up ? WiFi.RSSI() : 0);
    j += ",\"heap\":" + String((unsigned)ESP.getFreeHeap());
    j += ",\"minHeap\":" + String((unsigned)ESP.getMinFreeHeap());
    j += ",\"blk\":" + String((unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));
    j += ",\"psram\":" + String((unsigned)ESP.getFreePsram());
    j += ",\"clock\":" + String(clockValid_ ? 1 : 0);
    j += ",\"up\":" + String(now / 1000);
    j += g_wifi.diagFields();
    j += ",\"ep\":{";
    for (int i = 0; i < EP_COUNT; i++) {
      if (i) j += ",";
      j += "\""; j += kEpNames[i]; j += "\":[";
      j += String(stat_[i].code) + "," + String(ago(stat_[i].atMs)) + "," + String(ago(stat_[i].okMs)) + "]";
    }
    j += "}}";
    return j;
  }

 private:
  EpStat stat_[EP_COUNT];
  static const unsigned long kRetryMs = 30000;

  // After a due() slot ran: on failure, pull the next attempt in to ~30s.
  static void settle(unsigned long now, unsigned long &last, unsigned long every, bool ok) {
    if (ok || every <= kRetryMs) return;
    last = now - (every - kRetryMs);
    if (last == 0) last = 1;
  }
  unsigned long tScores_ = 0, tQuotes_ = 0, tWeather_ = 0, tPlanes_ = 0, tTv_ = 0;
  unsigned long tFlight_ = 0, tSky_ = 0, tVip_ = 0, tDaily_ = 0;
  String flightFor_;
  unsigned long tFolly_ = 0, tLake_ = 0, tMarkets_ = 0;
  unsigned long tLastFetch_ = 0;
  bool clockSynced_ = false;   // NTP started once Wi-Fi is up (any path)
  unsigned long tNtp_ = 0;     // last SNTP (re)start
  bool clockValid_ = false;    // RTC actually holds a real time (NTP or HTTP)
  unsigned long tTimeHttp_ = 0;  // last HTTP time-sync attempt
  static const unsigned long kFetchGapMs = 2500;  // min spacing between fetches

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
  // Retries a few times — the ESP32 TLS handshake can transiently EOF
  // (-29312) under BLE + Wi-Fi memory pressure / Cloudflare. Guards against
  // low heap and gives the socket time to fully reset between attempts.
  bool getJson(const String &path, JsonDocument &doc, Endpoint ep,
               const JsonDocument *filter = nullptr) {
    EpStat &st = stat_[ep];
    st.atMs = millis() | 1;
    String url = g_settings.apiBase + path;
    for (int attempt = 0; attempt < 3; attempt++) {
      // A TLS handshake needs a large contiguous INTERNAL allocation. If the
      // heap is too low the handshake will EOF, so skip; tick() retries in ~30s.
      if (ESP.getFreeHeap() < 45000) {
        Serial.printf("[NET] %s skip — low heap %u\n", path.c_str(),
                      (unsigned)ESP.getFreeHeap());
        st.code = -2;
        return false;
      }
      WiFiClientSecure client;
      client.setInsecure();
      client.setHandshakeTimeout(20);
      HTTPClient http;
      if (!http.begin(client, url)) {
        http.end();
        client.stop();
        st.code = -1;
        delay(600);
        continue;
      }
      http.setReuse(false);
      http.setTimeout(12000);
      int code = http.GET();
      if (code == 200) {
        // Parse straight from the socket into a PSRAM-backed document, keeping
        // only the fields the panel actually uses.
        DeserializationError err =
            filter ? deserializeJson(doc, http.getStream(), DeserializationOption::Filter(*filter))
                   : deserializeJson(doc, http.getStream());
        http.end();
        client.stop();
        if (!err) {
          Serial.printf("[NET] %s OK (heap %u)\n", path.c_str(),
                        (unsigned)ESP.getFreeHeap());
          st.code = 200;
          st.okMs = millis() | 1;
          return true;
        }
        Serial.printf("[NET] %s parse error: %s\n", path.c_str(), err.c_str());
        st.code = -3;
      } else {
        Serial.printf("[NET] %s -> HTTP %d (heap %u, try %d)\n", path.c_str(),
                      code, (unsigned)ESP.getFreeHeap(), attempt + 1);
        st.code = code < 0 ? -1 : code;
        http.end();
        client.stop();
      }
      delay(700);  // let the socket + TLS state fully reset before retry
    }
    return false;
  }

  // Set the RTC from the backend's epoch (used when NTP is blocked). The TZ
  // env is already configured by configTzTime(), so localtime() stays Eastern.
  void httpSyncTime() {
    PSRAM_JSON(doc);
    if (!getJson("/api/device/time", doc, EP_TIME)) return;
    long epoch = doc["epoch"] | 0L;
    if (epoch < 1000000000L) return;  // sanity: must be after 2001
    struct timeval tv;
    tv.tv_sec = (time_t)epoch;
    tv.tv_usec = 0;
    settimeofday(&tv, nullptr);
    clockValid_ = true;
    Serial.printf("[NET] clock set via HTTP epoch=%ld\n", epoch);
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

  bool fetchScores() {
    String teams = csvTeams();
    if (!teams.length()) return true;
    PSRAM_JSON(doc);
    PSRAM_JSON(filter);
    JsonObject ft = filter["t"].add<JsonObject>();
    for (const char *k : {"c", "s", "h", "l", "r", "k", "o", "op", "ha", "or", "st", "nd", "nt", "wn"}) ft[k] = true;
    if (!getJson("/api/device/scores?teams=" + enc(teams), doc, EP_SCORES, &filter)) return false;
    const uint32_t nowEpoch = (uint32_t)time(nullptr);
    // Store per-team (aligned to g_settings.teams[]) so the display can show
    // the team abbr with its own record + next game / live score.
    for (JsonVariant e : doc["t"].as<JsonArray>()) {
      const char *code = e["c"] | "";
      int slot = teamSlot(code);
      if (slot < 0) continue;
      g_settings.teamLabel[slot]  = (const char *)(e["l"] | "");
      g_settings.teamRecord[slot] = (const char *)(e["r"] | "");
      g_settings.teamHL[slot]     = (const char *)(e["h"] | "");
      g_settings.teamShort[slot]  = (const char *)(e["k"] | "");
      g_settings.teamTs[slot]     = nowEpoch;  // label freshness (display dims stale ones)
      // One-team-per-page card (backend 1.1.2 fields; older backend: absent).
      g_settings.teamOpp[slot]      = (const char *)(e["op"] | "");
      g_settings.teamOppRec[slot]   = (const char *)(e["or"] | "");
      g_settings.teamStatus[slot]   = (const char *)(e["st"] | "");
      g_settings.teamNextDay[slot]  = (const char *)(e["nd"] | "");
      g_settings.teamNextTime[slot] = (const char *)(e["nt"] | "");
      {
        const char *ha = e["ha"] | "";
        g_settings.teamHome[slot] = ha[0] == 'h' ? 1 : (ha[0] == 'a' ? 0 : -1);
      }
      g_settings.teamScore[slot]    = e["s"].isNull() ? -1 : (int16_t)e["s"].as<float>();
      g_settings.teamOppScore[slot] = e["o"].isNull() ? -1 : (int16_t)e["o"].as<float>();
      // On-device score flash: a live team's score went up since last check.
      // Hockey says GOAL!, football says TOUCHDOWN / FIELD GOAL, others SCORE!.
      if (strcmp(g_settings.teamHL[slot].c_str(), "live") == 0 && !e["s"].isNull()) {
        float sc = e["s"].as<float>();
        float prev = g_settings.prevScore[slot];
        if (prev >= 0 && sc > prev) {
          int d = (int)(sc - prev);
          String lg = code;
          bool nfl = lg.startsWith("NFL:") || lg.startsWith("CFB:") || lg.startsWith("NCAAF:");
          const char *msg = "SCORE!";
          bool show = true;
          if (lg.startsWith("NHL:")) msg = "GOAL!";
          else if (nfl) {
            if (d >= 6) msg = "TOUCHDOWN";
            else if (d == 3) msg = "FIELD GOAL";
            else if (d == 1) show = false;  // extra point after a TD we just showed
          }
          if (show) {
            uint8_t r, gg, b;
            teamRGB(code, r, gg, b);
            g_display.scoreFlash(abbrOf(code), r, gg, b, msg);
          }
        }
        g_settings.prevScore[slot] = sc;
      } else {
        // Live -> final with our team ahead: celebrate the win.
        if (g_settings.prevScore[slot] >= 0 && strcmp(g_settings.teamHL[slot].c_str(), "recent") == 0 &&
            g_settings.teamScore[slot] > g_settings.teamOppScore[slot] && g_settings.teamOppScore[slot] >= 0) {
          uint8_t r, gg, b;
          teamRGB(code, r, gg, b);
          String wn = (const char *)(e["wn"] | "");
          if (!wn.length()) wn = abbrOf(code);
          g_display.scoreFlash(wn, r, gg, b, "WIN!");
        }
        g_settings.prevScore[slot] = -1;  // not live: next live score is a fresh baseline
      }
    }
    return true;
  }

  bool fetchQuotes() {
    String syms;
    for (int i = 0; i < 8; i++)
      if (g_settings.stocks[i].length()) {
        if (syms.length()) syms += ",";
        syms += g_settings.stocks[i];
      }
    if (!syms.length()) return true;
    PSRAM_JSON(doc);
    if (!getJson("/api/device/quotes?symbols=" + enc(syms), doc, EP_QUOTES)) return false;
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
    return true;
  }

  bool fetchWeather() {
    if (!g_settings.showWeather) return true;
    char path[64];
    snprintf(path, sizeof(path), "/api/weather/current?lat=%.4f&lon=%.4f",
             g_settings.lat, g_settings.lon);
    PSRAM_JSON(doc);
    PSRAM_JSON(filter);
    for (const char *k : {"temp", "hi", "lo", "text"}) filter[k] = true;
    if (g_settings.showForecast) {
      JsonObject ff = filter["fc"].add<JsonObject>();
      for (const char *k : {"d", "i", "h", "l"}) ff[k] = true;
    }
    if (!getJson(path, doc, EP_WEATHER, &filter)) return false;
    if (!doc["temp"].isNull()) g_settings.wxTemp = doc["temp"].as<int>();
    if (!doc["hi"].isNull()) g_settings.wxHi = doc["hi"].as<int>();
    if (!doc["lo"].isNull()) g_settings.wxLo = doc["lo"].as<int>();
    g_settings.wxText = (const char *)(doc["text"] | "");
    if (g_settings.showForecast && doc["fc"].is<JsonArrayConst>())
      applyForecast(doc["fc"].as<JsonArrayConst>());
    return true;
  }

  // Simple mode: every 30 min, and right away once the ET date has changed
  // (the family message can change during the day, so 30 min not 24 h).
  bool dailyDue(unsigned long now) {
    struct tm t;
    if (getLocalTime(&t, 0) && g_settings.dyDate.length()) {
      char today[12];
      strftime(today, sizeof(today), "%Y-%m-%d", &t);
      if (g_settings.dyDate != today && (tDaily_ == 0 || now - tDaily_ > 60000)) { tDaily_ = now | 1; return true; }
    }
    return due(now, tDaily_, 1800000);
  }

  bool fetchDaily() {
    PSRAM_JSON(doc);
    if (!getJson("/api/device/daily", doc, EP_DAILY)) return false;
    if (!doc["d"].is<const char *>()) return false;
    String before = g_settings.dyDate + g_settings.dyFam + g_settings.dyFamFrom + g_settings.dyBorn;
    applyDaily(doc.as<JsonObjectConst>());
    String after = g_settings.dyDate + g_settings.dyFam + g_settings.dyFamFrom + g_settings.dyBorn;
    if (before != after) {
      String blob;
      serializeJson(doc, blob);
      saveDaily(blob);
      g_display.invalidate();
    }
    return true;
  }

  bool fetchPlanes() {
    char path[80];
    // Simple mode locks the flights page to 3 mi around Mooresville, NC 28117.
    float la = g_settings.simpleMode ? 35.58f : g_settings.lat;
    float lo = g_settings.simpleMode ? -80.82f : g_settings.lon;
    int rad = g_settings.simpleMode ? 3 : g_settings.radius;
    snprintf(path, sizeof(path), "/api/device/planes?lat=%.4f&lon=%.4f&radius=%d", la, lo, rad);
    PSRAM_JSON(doc);
    PSRAM_JSON(filter);
    JsonObject fp = filter["p"].add<JsonObject>();
    for (const char *k : {"f", "fn", "al", "ia", "lg", "fr", "to", "typ", "alt", "spd", "d"}) fp[k] = true;
    if (!getJson(path, doc, EP_PLANES, &filter)) return false;
    PlaneInfo list[6];
    int n = 0;
    for (JsonVariant f : doc["p"].as<JsonArray>()) {
      if (n >= 6) break;
      PlaneInfo &p = list[n];
      p.cs = (const char *)(f["f"] | "");
      if (!p.cs.length()) continue;
      p.ident   = (const char *)(f["fn"] | (f["f"] | ""));
      p.airline = (const char *)(f["al"] | "");
      p.code    = (const char *)(f["ia"] | "");
      p.logo    = (const char *)(f["lg"] | (f["ia"] | ""));
      p.from    = (const char *)(f["fr"] | "");
      p.to      = (const char *)(f["to"] | "");
      p.type    = (const char *)(f["typ"] | "");
      p.alt     = f["alt"].isNull() ? -1 : f["alt"].as<int>();
      p.spd     = f["spd"].isNull() ? -1 : f["spd"].as<int>();
      p.dist    = f["d"].isNull() ? -1.0f : f["d"].as<float>();
      p.line    = (p.airline.length() ? p.airline : p.cs);
      if (p.dist >= 0) p.line += " " + String(p.dist, 1) + "mi";
      n++;
    }
    g_settings.planesFetchMs = millis() | 1;
    // Replaces the in-range list; new callsigns interrupt the rotation once,
    // gone ones drop out of the cycle immediately.
    g_display.notePlanes(list, n);
    return true;
  }

  bool fetchMarkets() {
    PSRAM_JSON(doc);
    PSRAM_JSON(filter);
    filter["st"] = true;
    JsonObject fm = filter["m"].add<JsonObject>();
    for (const char *k : {"n", "v", "c", "b", "sp"}) fm[k] = true;
    if (!getJson("/api/device/markets", doc, EP_MARKETS, &filter)) return false;
    int n = 0;
    for (JsonVariant m : doc["m"].as<JsonArray>()) {
      if (n >= 3) break;
      MarketInfo &mi = g_settings.markets[n];
      mi.name = (const char *)(m["n"] | "");
      if (m["v"].isNull()) continue;
      mi.value = m["v"].as<float>();
      mi.hasPct = !m["c"].isNull();
      mi.pct = mi.hasPct ? m["c"].as<float>() : 0.0f;
      mi.base = m["b"].isNull() ? -1 : m["b"].as<int>();
      mi.sparkLen = 0;
      for (JsonVariant v : m["sp"].as<JsonArray>()) {
        if (mi.sparkLen >= 34) break;
        mi.spark[mi.sparkLen++] = (int8_t)(v.as<int>());
      }
      n++;
    }
    g_settings.marketCount = n;
    g_settings.marketStatus = (const char *)(doc["st"] | "");
    return true;
  }

  bool fetchFolly() {
    if (!g_settings.showFolly) return true;
    PSRAM_JSON(doc);
    if (!getJson("/api/device/folly", doc, EP_FOLLY)) return false;
    String lines[2];
    int i = 0;
    for (JsonVariant ev : doc["e"].as<JsonArray>()) {
      if (i >= 2) break;
      String y = (const char *)(ev["y"] | "");
      String t = (const char *)(ev["t"] | "");
      float v = ev["v"] | 0.0f;
      lines[i++] = y + " " + t + " " + String(v, 1) + "ft";
    }
    g_settings.follyL1 = lines[0];
    g_settings.follyL2 = lines[1];
    g_settings.follyWater = doc["w"] | 0;
    g_settings.follyDir = (const char *)(doc["dir"] | "");
    return true;
  }

  bool fetchLake() {
    if (!g_settings.showLKN) return true;
    PSRAM_JSON(doc);
    if (!getJson("/api/device/lake", doc, EP_LAKE)) return false;
    if (!doc["lvl"].isNull()) {
      float lvl = doc["lvl"].as<float>();
      g_settings.lakeLvl = String(lvl, 1);
      auto signedFt = [](float d) { return (d >= 0 ? String("+") : String("")) + String(d, 1); };
      // Prefer the backend's differences (computed from unrounded levels).
      if (!doc["df"].isNull()) g_settings.lakeFull = signedFt(doc["df"].as<float>());
      else if (!doc["full"].isNull()) g_settings.lakeFull = signedFt(lvl - doc["full"].as<float>());
      // Duke's guide-curve target for today, and the level's distance from it.
      if (!doc["tgt"].isNull()) {
        float tgt = doc["tgt"].as<float>();
        g_settings.lakeTgt = String(tgt, 1);
        g_settings.lakeTgtDiff = signedFt(doc["dt"].isNull() ? lvl - tgt : doc["dt"].as<float>());
      }
    }
    g_settings.lakeWater = doc["w"] | 0;
    return true;
  }

  bool fetchFlight() {
    PSRAM_JSON(doc);
    if (!getJson("/api/device/flight?ident=" + enc(g_settings.flightIdent), doc, EP_FLIGHT)) return false;
    if (!(doc["ok"] | false)) {
      g_settings.flightOk = 0;
      g_settings.flightAl = ""; g_settings.flightRoute = ""; g_settings.flightAir = false;
      return true;
    }
    g_settings.flightOk = 1;
    g_settings.flightNo = (const char *)(doc["fn"] | g_settings.flightIdent.c_str());
    String al = (const char *)(doc["al"] | "");
    al.replace(" Airlines", ""); al.replace(" Air Lines", ""); al.replace(" Airways", "");
    g_settings.flightAl = al;
    g_settings.flightAir = doc["air"] | false;
    g_settings.flightAlt = doc["alt"] | 0L;
    const char *fr = doc["fr"] | "";
    const char *to = doc["to"] | "";
    g_settings.flightRoute = (*fr && *to) ? String(fr) + " > " + to : String("");
    g_settings.flightTo = to;
    g_settings.flightDmi = doc["dmi"] | -1L;
    g_settings.flightEta = (const char *)(doc["eta"] | "");
    return true;
  }

  bool fetchSky() {
    char path[72];
    snprintf(path, sizeof(path), "/api/device/sky?lat=%.4f&lon=%.4f", g_settings.lat, g_settings.lon);
    PSRAM_JSON(doc);
    if (!getJson(path, doc, EP_SKY)) return false;
    JsonObjectConst m = doc["moon"];
    if (!m.isNull() && !m["il"].isNull()) {
      g_settings.moonIl   = (int8_t)m["il"].as<int>();
      g_settings.moonWax  = (m["wx"] | 1) != 0;
      g_settings.moonPh   = (const char *)(m["ph"] | "");
      g_settings.sunRise  = (const char *)(m["sr"] | "");
      g_settings.sunSet   = (const char *)(m["ss"] | "");
      g_settings.moonRise = (const char *)(m["mr"] | "");
      g_settings.moonRiseTmw = strcmp(m["mrd"] | "", "tmw") == 0;
    }
    JsonObjectConst s = doc["iss"];
    if (!s.isNull() && !s["mi"].isNull()) {
      g_settings.issOk = true;
      g_settings.issMi = s["mi"] | 0;
      JsonObjectConst v = s["nv"];
      g_settings.issNvR    = v["r"] | 0UL;
      g_settings.issNvDay  = (const char *)(v["d"] | "");
      g_settings.issNvTime = (const char *)(v["t"] | "");
      g_settings.issNvFr   = (const char *)(v["fr"] | "");
      g_settings.issNvTo   = (const char *)(v["to"] | "");
      g_settings.issNvEl   = v["el"] | 0;
      g_settings.issNvMin  = v["m"] | 0;
      JsonObjectConst p = s["np"];
      g_settings.issPR  = p["r"] | 0UL;
      g_settings.issPE  = p["e"] | 0UL;
      g_settings.issPEl = p["el"] | 0;
      g_settings.issPFr = (const char *)(p["fr"] | "");
      g_settings.issPTo = (const char *)(p["to"] | "");
    }
    return true;
  }

  bool fetchVip() {
    char path[72];
    snprintf(path, sizeof(path), "/api/device/vip?lat=%.4f&lon=%.4f&r=60", g_settings.lat, g_settings.lon);
    PSRAM_JSON(doc);
    if (!getJson(path, doc, EP_VIP)) return false;
    int n = 0;
    for (JsonObjectConst a : doc["a"].as<JsonArrayConst>()) {
      if (n >= 2) break;
      VipInfo &v = g_settings.vip[n++];
      v.key = (const char *)(a["k"] | "");
      v.label = (const char *)(a["l"] | "");
      v.cs = (const char *)(a["cs"] | "");
      v.hex = (const char *)(a["hex"] | "");
      v.type = (const char *)(a["t"] | "");
      v.reg = (const char *)(a["reg"] | "");
      v.dir = (const char *)(a["b"] | "");
      v.dist = a["d"] | -1.0f;
      v.alt = a["alt"] | 0L;
      v.vr = (int8_t)(a["vr"] | 0);
      v.hdg = a["hdg"] | 0;
      v.spd = a["spd"] | 0;
    }
    g_settings.vipN = n;
    g_display.noteVip();
    return true;
  }

  bool fetchTv() {
    String names;
    for (int i = 0; i < MAX_SHOWS; i++)
      if (g_settings.shows[i].length()) {
        if (names.length()) names += "|";
        names += g_settings.shows[i];
      }
    if (!names.length()) return true;
    PSRAM_JSON(doc);
    PSRAM_JSON(filter);
    JsonObject fv = filter["v"].add<JsonObject>();
    fv["n"] = true; fv["l"] = true;
    if (!getJson("/api/device/tv?names=" + enc(names), doc, EP_TV, &filter)) return false;
    // Store each show's schedule label (next episode / season start) aligned
    // to shows[] so the panel can show WHEN, not just the show name.
    for (JsonVariant v : doc["v"].as<JsonArray>()) {
      const char *nm = v["n"] | "";
      const char *lbl = v["l"] | "";
      for (int i = 0; i < MAX_SHOWS; i++)
        if (g_settings.shows[i] == nm) g_settings.showLabel[i] = lbl;
    }
    return true;
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
