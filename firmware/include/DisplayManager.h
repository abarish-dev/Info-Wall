// ===========================================================================
// Info Wall — DisplayManager.h  (Adafruit MatrixPortal S3 / 128x64 HUB75)
// ---------------------------------------------------------------------------
// Drives the LED matrix using the ESP32-HUB75-MatrixPanel-DMA library. It
// builds a carousel of the modules currently enabled in g_settings and rotates
// through them, honoring:
//   - brightness (+ the evening display schedule that dims / blanks it)
//   - the PIN toggle (freezes on the current frame)
//   - hold duration + fade speed (cross-fade between frames)
//   - module visibility toggles (LKN / Folly / Countdown / custom message)
//
// Text is drawn with the built-in Adafruit_GFX font. Team logos are shown as
// abbreviations by default; to use real bitmaps, drop your `generated_logos.h`
// into include/ and swap the marked block in drawTeams() to blit the bitmap.
// ===========================================================================
#pragma once

#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <time.h>
#include "BLEController.h"

// --- Panel geometry: two chained 64x64 tiles = 128 wide x 64 tall ----------
#ifndef PANEL_RES_X
#define PANEL_RES_X 64
#endif
#ifndef PANEL_RES_Y
#define PANEL_RES_Y 64
#endif
#ifndef PANEL_CHAIN
#define PANEL_CHAIN 2
#endif

class DisplayManager {
 public:
  void begin() {
    HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN);
    // MatrixPortal S3 pin map. Adjust here if your wiring differs.
    mxconfig.gpio.r1 = 42; mxconfig.gpio.g1 = 41; mxconfig.gpio.b1 = 40;
    mxconfig.gpio.r2 = 38; mxconfig.gpio.g2 = 39; mxconfig.gpio.b2 = 37;
    mxconfig.gpio.a  = 45; mxconfig.gpio.b  = 36; mxconfig.gpio.c  = 48;
    mxconfig.gpio.d  = 35; mxconfig.gpio.e  = 21;
    mxconfig.gpio.lat = 47; mxconfig.gpio.oe = 14; mxconfig.gpio.clk = 2;
    mxconfig.clkphase = false;

    dma_ = new MatrixPanel_I2S_DMA(mxconfig);
    dma_->begin();
    dma_->setBrightness8(map(g_settings.brightness, 0, 100, 0, 255));
    dma_->clearScreen();
    width_  = PANEL_RES_X * PANEL_CHAIN;
    height_ = PANEL_RES_Y;
    lastSwitch_ = millis();
  }

  // Call every loop iteration.
  void tick() {
    if (!dma_) return;

    // 1) Effective brightness (schedule can dim / blank the wall).
    int eff = effectiveBrightness();
    if (eff <= 0) { dma_->clearScreen(); return; }

    rebuildFramesIfNeeded();
    if (frameCount_ == 0) { dma_->clearScreen(); return; }

    // 2) Advance frames on hold timeout (unless the screen is pinned).
    unsigned long now = millis();
    int hold = max(2000, g_settings.holdDurationMs);
    if (!g_settings.isPinned && !fading_ && now - lastSwitch_ >= (unsigned long)hold) {
      fading_    = true;
      fadeOut_   = true;
      fadeStart_ = now;
    }

    // 3) Cross-fade brightness ramp between frames.
    int drawBright = eff;
    if (fading_) {
      int fadeMs = (11 - constrain(g_settings.fadeSpeed, 1, 10)) * 90; // 90..900ms
      float t = fadeMs > 0 ? (float)(now - fadeStart_) / fadeMs : 1.0f;
      if (t >= 1.0f) {
        if (fadeOut_) {
          current_   = (current_ + 1) % frameCount_;
          fadeOut_   = false;
          fadeStart_ = now;
          drawBright = 0;
        } else {
          fading_     = false;
          lastSwitch_ = now;
        }
      } else {
        drawBright = fadeOut_ ? (int)(eff * (1.0f - t)) : (int)(eff * t);
      }
    }
    dma_->setBrightness8(map(drawBright, 0, 100, 0, 255));

    // 4) Draw the current module.
    dma_->clearScreen();
    drawModule(frames_[current_]);
  }

  // A quick RGB sweep so the user can confirm the BLE link is live.
  void flashTest() {
    if (!dma_) return;
    uint16_t colors[] = {red(), green(), blue(), white()};
    for (uint16_t c : colors) { dma_->fillScreen(c); delay(180); }
    dma_->clearScreen();
    lastSwitch_ = millis();
    fading_ = false;
  }

  // Celebrate a score: blink the team color with the abbr + "SCORE" (~2.4s).
  void scoreFlash(const String &abbr, uint8_t r, uint8_t g, uint8_t b) {
    if (!dma_) return;
    dma_->setBrightness8(255);
    uint16_t bg = dma_->color565(r, g, b);
    // Pick black/white text for contrast against the team color.
    uint16_t fg = (r * 299 + g * 587 + b * 114) / 1000 > 140
                      ? dma_->color565(0, 0, 0)
                      : white();
    for (int i = 0; i < 4; i++) {
      dma_->fillScreen(bg);
      centerText(abbr, height_ / 2 - 14, fg, 2);
      centerText("SCORE!", height_ / 2 + 4, fg, 2);
      delay(320);
      dma_->clearScreen();
      delay(140);
    }
    dma_->setBrightness8(map(g_settings.brightness, 0, 100, 0, 255));
    lastSwitch_ = millis();
    fading_ = false;
  }

 private:
  enum Module { M_MESSAGE, M_FLIGHT, M_WEATHER, M_SPORTS, M_SCORES, M_TV,
                M_STOCKS, M_COUNTDOWN, M_REMINDERS, M_LKN, M_FOLLY };

  MatrixPanel_I2S_DMA *dma_ = nullptr;
  int width_ = 128, height_ = 64;
  Module frames_[11];
  int  frameCount_ = 0;
  int  current_ = 0;
  unsigned long lastSwitch_ = 0;
  bool fading_ = false, fadeOut_ = false;
  unsigned long fadeStart_ = 0;
  String lastSig_;

  uint16_t red()   { return dma_->color565(255, 40, 40); }
  uint16_t green() { return dma_->color565(60, 255, 100); }
  uint16_t blue()  { return dma_->color565(40, 160, 255); }
  uint16_t amber() { return dma_->color565(255, 176, 0); }
  uint16_t cyan()  { return dma_->color565(34, 211, 238); }
  uint16_t white() { return dma_->color565(240, 240, 240); }

  // A cheap signature of the enabled-module set; rebuild the carousel only
  // when it changes so `current_` isn't reset every frame.
  void rebuildFramesIfNeeded() {
    String sig;
    sig += g_settings.showCustomMessage && msgHasText() ? "M" : "";
    sig += (g_settings.trackFlight && g_settings.flightIdent.length()) ? "F" : "";
    sig += g_settings.showWeather ? "W" : "";
    sig += anyTeam() ? "S" : "";
    sig += anyScore() ? "G" : "";
    sig += anyShow() ? "T" : "";
    sig += anyStock() ? "$" : "";
    sig += (g_settings.showCountdown && g_settings.countdownLabel.length()) ? "C" : "";
    sig += anyReminder() ? "R" : "";
    sig += g_settings.showLKN ? "L" : "";
    sig += g_settings.showFolly ? "O" : "";
    if (sig == lastSig_) return;
    lastSig_ = sig;

    frameCount_ = 0;
    if (g_settings.showCustomMessage && msgHasText()) frames_[frameCount_++] = M_MESSAGE;
    if (g_settings.trackFlight && g_settings.flightIdent.length()) frames_[frameCount_++] = M_FLIGHT;
    if (g_settings.showWeather) frames_[frameCount_++] = M_WEATHER;
    if (anyTeam())  frames_[frameCount_++] = M_SPORTS;
    if (anyScore()) frames_[frameCount_++] = M_SCORES;
    if (anyShow())  frames_[frameCount_++] = M_TV;
    if (anyStock()) frames_[frameCount_++] = M_STOCKS;
    if (g_settings.showCountdown && g_settings.countdownLabel.length()) frames_[frameCount_++] = M_COUNTDOWN;
    if (anyReminder()) frames_[frameCount_++] = M_REMINDERS;
    if (g_settings.showLKN)   frames_[frameCount_++] = M_LKN;
    if (g_settings.showFolly) frames_[frameCount_++] = M_FOLLY;
    if (current_ >= frameCount_) current_ = 0;
  }

  bool msgHasText() {
    return g_settings.msgLine1.length() || g_settings.msgLine2.length() ||
           g_settings.msgLine3.length();
  }
  bool anyTeam()  { for (int i=0;i<8;i++) if (g_settings.teams[i].length())  return true; return false; }
  bool anyShow()  { for (int i=0;i<8;i++) if (g_settings.shows[i].length())  return true; return false; }
  bool anyStock() { for (int i=0;i<8;i++) if (g_settings.stocks[i].length()) return true; return false; }
  bool anyScore() { for (int i=0;i<4;i++) if (g_settings.scores[i].length()) return true; return false; }
  bool anyReminder() { for (int i=0;i<4;i++) if (g_settings.reminders[i].length()) return true; return false; }

  // Center a size-1 GFX string (6px per char) horizontally at row y.
  void centerText(const String &s, int y, uint16_t color, uint8_t size = 1) {
    dma_->setTextSize(size);
    dma_->setTextColor(color);
    int w = s.length() * 6 * size;
    int x = (width_ - w) / 2;
    if (x < 0) x = 0;
    dma_->setCursor(x, y);
    dma_->print(s);
  }

  void drawModule(Module m) {
    switch (m) {
      case M_MESSAGE:   drawMessage();   break;
      case M_FLIGHT:    drawFlight();    break;
      case M_WEATHER:   drawWeather();   break;
      case M_SPORTS:    drawTeams();     break;
      case M_SCORES:    drawScores();    break;
      case M_TV:        drawShows();     break;
      case M_STOCKS:    drawStocks();    break;
      case M_COUNTDOWN: drawCountdown(); break;
      case M_REMINDERS: drawReminders(); break;
      case M_LKN:       drawLabel("LKN MARINE", cyan()); break;
      case M_FOLLY:     drawLabel("FOLLY TIDES", cyan()); break;
    }
  }

  void drawLabel(const String &s, uint16_t c) { centerText(s, height_/2 - 4, c, 1); }

  void drawMessage() {
    centerText(g_settings.msgLine1, 12, green());
    centerText(g_settings.msgLine2, 28, white());
    centerText(g_settings.msgLine3, 44, amber());
  }

  void drawFlight() {
    centerText("FLIGHT", 14, cyan());
    centerText(g_settings.flightIdent, 34, white(), 2);
  }

  void drawWeather() {
    if (g_settings.wxText.length()) {
      char t[16];
      snprintf(t, sizeof(t), "%d\xF7", g_settings.wxTemp);  // temp
      centerText(t, 10, amber(), 2);
      centerText(g_settings.wxText, 32, white());
      char hl[20];
      snprintf(hl, sizeof(hl), "H%d  L%d", g_settings.wxHi, g_settings.wxLo);
      centerText(hl, 46, cyan());
    } else {
      // Not fetched yet (no Wi-Fi/apiBase) — show the module is active.
      centerText("WEATHER", 12, amber());
      char buf[24];
      snprintf(buf, sizeof(buf), "%.2f,%.2f", g_settings.lat, g_settings.lon);
      centerText(buf, 34, white());
    }
  }

  void drawTeams() {
    centerText("TEAMS", 6, white());
    int y = 20;
    for (int i = 0; i < 8 && y < height_ - 8; i++) {
      String t = g_settings.teams[i];
      if (!t.length()) continue;
      // t is "LEAGUE:ABBR" (e.g. "MLB:NYY"). Show the abbreviation.
      int colon = t.indexOf(':');
      String abbr = colon >= 0 ? t.substring(colon + 1) : t;
      // --- To draw a real logo instead, blit from generated_logos.h here ---
      centerText(abbr, y, cyan());
      y += 12;
    }
  }

  void drawShows() {
    centerText("WATCHLIST", 6, cyan());
    int y = 20;
    for (int i = 0; i < 8 && y < height_ - 8; i++) {
      if (!g_settings.shows[i].length()) continue;
      centerText(g_settings.shows[i].substring(0, 20), y, white());
      y += 12;
    }
  }

  void drawStocks() {
    centerText("MARKETS", 6, green());
    int y = 20;
    for (int i = 0; i < 8 && y < height_ - 8; i++) {
      if (!g_settings.stocks[i].length()) continue;
      char line[28];
      if (g_settings.stockPrice[i] > 0) {
        char arrow = g_settings.stockChg[i] >= 0 ? '+' : '-';
        snprintf(line, sizeof(line), "%s %.2f %c%.1f%%",
                 g_settings.stocks[i].c_str(), g_settings.stockPrice[i],
                 arrow, fabsf(g_settings.stockChg[i]));
        centerText(line, y, g_settings.stockChg[i] >= 0 ? green() : red());
      } else {
        centerText(g_settings.stocks[i], y, white());
      }
      y += 12;
    }
  }

  void drawScores() {
    centerText("SCORES", 6, amber());
    int y = 22;
    for (int i = 0; i < 4 && y < height_ - 8; i++) {
      if (!g_settings.scores[i].length()) continue;
      centerText(g_settings.scores[i], y, white());
      y += 14;
    }
  }

  void drawReminders() {
    centerText("NEW TONIGHT", 6, green());
    int y = 22;
    for (int i = 0; i < 4 && y < height_ - 8; i++) {
      if (!g_settings.reminders[i].length()) continue;
      centerText(g_settings.reminders[i], y, white());
      y += 14;
    }
  }

  void drawCountdown() {
    centerText(g_settings.countdownLabel, 14, cyan());
    int days = daysUntil(g_settings.countdownDate);
    char buf[16];
    snprintf(buf, sizeof(buf), "%d DAYS", days < 0 ? 0 : days);
    centerText(buf, 34, amber(), 2);
  }

  static int daysUntil(const String &iso) {
    if (iso.length() != 10) return -1;
    struct tm tt = {};
    tt.tm_year = iso.substring(0, 4).toInt() - 1900;
    tt.tm_mon  = iso.substring(5, 7).toInt() - 1;
    tt.tm_mday = iso.substring(8, 10).toInt();
    time_t target = mktime(&tt);
    time_t now = time(nullptr);
    if (now < 100000) return -1; // clock not set yet (needs NTP)
    return (int)((target - now) / 86400L);
  }

  // Apply the evening schedule: outside hours use full brightness, inside the
  // window use scheduleBrightness (0 = wall off). Needs NTP time to be set.
  int effectiveBrightness() {
    if (!g_settings.scheduleEnabled) return g_settings.brightness;
    struct tm t;
    if (!getLocalTime(&t, 5)) return g_settings.brightness; // no clock yet
    int mins = t.tm_hour * 60 + t.tm_min;
    int s = toMins(g_settings.scheduleStart);
    int e = toMins(g_settings.scheduleEnd);
    bool inWindow = (s <= e) ? (mins >= s && mins < e)
                             : (mins >= s || mins < e); // wraps midnight
    return inWindow ? g_settings.scheduleBrightness : g_settings.brightness;
  }

  static int toMins(const String &hhmm) {
    int c = hhmm.indexOf(':');
    if (c < 0) return 0;
    return hhmm.substring(0, c).toInt() * 60 + hhmm.substring(c + 1).toInt();
  }
};
