// ===========================================================================
// Info Wall — WifiKeeper.h
// ---------------------------------------------------------------------------
// Keeps the panel on Wi-Fi without the phone.
//
// Before 1.1.3 nothing started Wi-Fi at boot: the code assumed the ESP32
// "auto-reconnects to stored creds", but with the Arduino core the radio
// stays off until WiFi.begin() runs, and that only happened when the app
// sent a "wifi" join. So after ANY reboot (power blip, crash, OTA) the wall
// was offline until someone re-joined it from the app, and every feed showed
// "not tried". The app's "Matrix joined <ip>" was just its memory of the last
// join.
//
// Now: the joined network is saved in NVS (own namespace, separate from the
// settings blob). At boot it reconnects with it (or the core's stored config).
// Then a watchdog retries with backoff (10s, 20s, 40s ... 5 min) whenever the
// link is down, alongside the core's auto-reconnect.
// ===========================================================================
#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <esp_system.h>

class WifiKeeper {
 public:
  void begin() {
    Preferences p;
    p.begin("iw-wifi", true);
    ssid_ = p.getString("ssid", "");
    pass_ = p.getString("pass", "");
    p.end();
    WiFi.persistent(true);
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    // Modem sleep stays ON (the default): it's required while BLE is active.
    if (ssid_.length()) {
      Serial.printf("[WiFi] boot: joining saved \"%s\"\n", ssid_.c_str());
      WiFi.begin(ssid_.c_str(), pass_.c_str());
    } else {
      Serial.println("[WiFi] boot: trying the core's stored network");
      WiFi.begin();   // uses the config the core saved on the last join (if any)
    }
    attempts_ = 1;
    lastTry_ = millis() | 1;
    backoff_ = kMinBackoff;
  }

  // A successful join from the app: remember it for the next boot.
  void remember(const String &ssid, const String &pass) {
    if (ssid == ssid_ && pass == pass_) return;
    ssid_ = ssid; pass_ = pass;
    Preferences p;
    p.begin("iw-wifi", false);
    p.putString("ssid", ssid_);
    p.putString("pass", pass_);
    p.end();
  }

  // Call every loop(). Cheap when connected.
  void tick() {
    if (paused_) return;                     // a Wi-Fi scan is running (1.2.1)
    unsigned long now = millis();
    bool up = WiFi.status() == WL_CONNECTED;
    if (up) {
      if (!wasUp_) {
        wasUp_ = true;
        upSince_ = now | 1;
        backoff_ = kMinBackoff;
        Serial.printf("[WiFi] up: %s\n", WiFi.localIP().toString().c_str());
      }
      return;
    }
    if (wasUp_) {
      wasUp_ = false;
      drops_++;
      downSince_ = now | 1;
      lastTry_ = now | 1;     // give the core's own auto-reconnect a first go
      Serial.println("[WiFi] link lost");
    }
    if (downSince_ == 0) downSince_ = now | 1;
    if (now - lastTry_ < backoff_) return;
    lastTry_ = now | 1;
    attempts_++;
    backoff_ = min(backoff_ * 2, kMaxBackoff);
    wl_status_t st = WiFi.status();
    Serial.printf("[WiFi] reconnect #%u (status %d)\n", (unsigned)attempts_, (int)st);
    if (WiFi.getMode() != WIFI_STA && WiFi.getMode() != WIFI_AP_STA) WiFi.mode(WIFI_STA);
    // reconnect() only works once a config is loaded; after a failed/idle
    // start (or "no SSID"), begin again from the saved credentials.
    if (ssid_.length() && (st == WL_IDLE_STATUS || st == WL_NO_SSID_AVAIL ||
                           st == WL_CONNECT_FAILED || attempts_ % 3 == 0)) {
      WiFi.disconnect(false, false);
      WiFi.begin(ssid_.c_str(), pass_.c_str());
    } else if (!WiFi.reconnect()) {
      WiFi.begin();
    }
  }

  // Joined by the app just now (tryJoinWifi): reset the backoff.
  // Hold off reconnect attempts while the app's network scan runs.
  void pause(bool p) { paused_ = p; if (!p) { lastTry_ = millis() | 1; backoff_ = kMinBackoff; } }

  void noteManualJoin() { lastTry_ = millis() | 1; backoff_ = kMinBackoff; }

  bool hasCreds() const { return ssid_.length() > 0; }

  // Extra diag fields (JSON fragment, leading comma).
  String diagFields() const {
    unsigned long now = millis();
    String j = ",\"wst\":" + String((int)WiFi.status());
    j += ",\"saved\":" + String(ssid_.length() ? 1 : 0);
    j += ",\"wtries\":" + String((unsigned)attempts_);
    j += ",\"wdrops\":" + String((unsigned)drops_);
    j += ",\"wup\":" + String(wasUp_ && upSince_ ? (long)((now - upSince_) / 1000) : -1L);
    j += ",\"wdown\":" + String(!wasUp_ && downSince_ ? (long)((now - downSince_) / 1000) : -1L);
    j += ",\"rst\":" + String((int)esp_reset_reason());
    return j;
  }

 private:
  bool paused_ = false;
  static const unsigned long kMinBackoff = 10000, kMaxBackoff = 300000;
  String ssid_, pass_;
  bool wasUp_ = false;
  unsigned long upSince_ = 0, downSince_ = 0, lastTry_ = 0, backoff_ = kMinBackoff;
  uint32_t attempts_ = 0, drops_ = 0;
};

extern WifiKeeper g_wifi;
