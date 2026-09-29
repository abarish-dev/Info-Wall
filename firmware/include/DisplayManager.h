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
  enum Module { M_MESSAGE, M_FLIGHT, M_PLANES, M_WEATHER, M_SPORTS, M_SCORES,
                M_TV, M_STOCKS, M_COUNTDOWN, M_REMINDERS, M_LKN, M_FOLLY };

  MatrixPanel_I2S_DMA *dma_ = nullptr;
  int width_ = 128, height_ = 64;
  static const int SHOWS_PER_PAGE = 4;   // Shows module paginates in the carousel
  static const int MAX_FRAMES = 20;
  Module frames_[MAX_FRAMES];
  int  frameCount_ = 0;
  int  current_ = 0;
  int  tvFirstFrame_ = 0;   // index of the first Shows page in frames_
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
  uint16_t dim()   { return dma_->color565(90, 90, 90); }

  // A cheap signature of the enabled-module set; rebuild the carousel only
  // when it changes so `current_` isn't reset every frame.
  void rebuildFramesIfNeeded() {
    String sig;
    sig += g_settings.showCustomMessage && msgHasText() ? "M" : "";
    sig += (g_settings.trackFlight && g_settings.flightIdent.length()) ? "F" : "";
    sig += g_settings.planeLine.length() ? "P" : "";
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
    if (g_settings.planeLine.length()) frames_[frameCount_++] = M_PLANES;
    if (g_settings.showWeather) frames_[frameCount_++] = M_WEATHER;
    if (anyTeam())  frames_[frameCount_++] = M_SPORTS;
    if (anyScore()) frames_[frameCount_++] = M_SCORES;
    if (anyShow()) {
      // Paginate: one carousel frame per page of shows so ANY number of shows
      // displays cleanly (4 fit per 64px screen). Pages are consecutive, so all
      // shows scroll by, 4 at a time, within one carousel rotation.
      tvFirstFrame_ = frameCount_;
      int pages = (showCount() + SHOWS_PER_PAGE - 1) / SHOWS_PER_PAGE;
      for (int k = 0; k < pages && frameCount_ < MAX_FRAMES; k++)
        frames_[frameCount_++] = M_TV;
    }
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
  int  showCount(){ int n=0; for (int i=0;i<8;i++) if (g_settings.shows[i].length()) n++; return n; }
  bool anyStock() { for (int i=0;i<8;i++) if (g_settings.stocks[i].length()) return true; return false; }
  bool anyScore() { for (int i=0;i<8;i++) if (g_settings.teams[i].length() && (g_settings.teamHL[i]=="live"||g_settings.teamHL[i]=="recent")) return true; return false; }
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
      case M_PLANES:    drawPlanes();    break;
      case M_WEATHER:   drawWeather();   break;
      case M_SPORTS:    drawTeams();     break;
      case M_SCORES:    drawScores();    break;
      case M_TV:        drawShows();     break;
      case M_STOCKS:    drawStocks();    break;
      case M_COUNTDOWN: drawCountdown(); break;
      case M_REMINDERS: drawReminders(); break;
      case M_LKN:       drawLake();  break;
      case M_FOLLY:     drawFolly(); break;
    }
  }

  void drawLabel(const String &s, uint16_t c) { centerText(s, height_/2 - 4, c, 1); }

  void drawFolly() {
    centerText("FOLLY TIDES", 4, amber());
    if (g_settings.follyL1.length()) {
      // Tide direction: up-arrow (\x18) rising/incoming, down-arrow (\x19)
      // falling/outgoing — from the classic GFX code-page-437 glyphs.
      if (g_settings.follyDir == "in")
        centerText("\x18 INCOMING", 16, green());
      else if (g_settings.follyDir == "out")
        centerText("\x19 OUTGOING", 16, amber());
      centerText(g_settings.follyL1, 28, cyan());
      if (g_settings.follyL2.length()) centerText(g_settings.follyL2, 39, white());
      if (g_settings.follyWater > 0) {
        char w[16];
        snprintf(w, sizeof(w), "WATER %d\xF7", g_settings.follyWater);
        centerText(w, 51, green());
      }
    } else {
      centerText("Hwy 171 bridge", 30, white());
    }
  }

  void drawLake() {
    centerText("LAKE NORMAN", 6, cyan());
    if (g_settings.lakeLvl.length()) {
      centerText(String("LEVEL ") + g_settings.lakeLvl + "ft", 22, white());
      if (g_settings.lakeFull.length())
        centerText(String("FULL ") + g_settings.lakeFull + "ft", 34, amber());
      if (g_settings.lakeWater > 0) {
        char w[16];
        snprintf(w, sizeof(w), "WATER %d\xF7", g_settings.lakeWater);
        centerText(w, 48, green());
      }
    } else {
      centerText("Duke Energy", 30, white());
    }
  }

  void drawMessage() {
    centerText(g_settings.msgLine1, 12, green());
    centerText(g_settings.msgLine2, 28, white());
    centerText(g_settings.msgLine3, 44, amber());
  }

  void drawFlight() {
    centerText("FLIGHT", 14, cyan());
    centerText(g_settings.flightIdent, 34, white(), 2);
  }

  void drawPlanes() {
    centerText("OVERHEAD", 4, cyan());
    String code = g_settings.planeCode;
    uint16_t ink = dma_->color565(15, 15, 15);
    if (code.length()) {
      // Airline badge: a colored pill with a plane glyph + the airline code.
      int textW = code.length() * 6;
      int iconW = 10;
      int padX = 5;
      int pillW = iconW + textW + padX * 2;
      int pillH = 15;
      int px = (width_ - pillW) / 2;
      if (px < 0) px = 0;
      int py = 19;
      dma_->fillRoundRect(px, py, pillW, pillH, 4, amber());
      int ix = px + padX;
      int iy = py + pillH / 2;
      // Simple stylized jet pointing right.
      dma_->fillTriangle(ix, iy - 4, ix, iy + 4, ix + 8, iy, ink);
      dma_->fillTriangle(ix + 2, iy, ix + 5, iy - 5, ix + 5, iy, ink);
      dma_->setTextSize(1);
      dma_->setTextColor(ink);
      dma_->setCursor(ix + iconW, py + 4);
      dma_->print(code);
    } else {
      // No airline code (private tail number) — a plain plane glyph.
      int cx = width_ / 2;
      dma_->fillTriangle(cx - 7, 21, cx - 7, 31, cx + 7, 26, cyan());
    }
    // Airline name + distance below the badge.
    centerText(g_settings.planeLine, 42, white());
  }

  void drawWeather() {
    if (g_settings.wxText.length()) {
      // Current local time (once NTP has synced over Wi-Fi) above the temp.
      bool haveClock = false;
      struct tm now;
      if (getLocalTime(&now, 5)) {
        int h12 = now.tm_hour % 12;
        if (h12 == 0) h12 = 12;
        char clk[12];
        snprintf(clk, sizeof(clk), "%d:%02d%s", h12, now.tm_min,
                 now.tm_hour < 12 ? "a" : "p");
        centerText(clk, 5, cyan());   // padded off the top edge, readable color
        haveClock = true;
      }
      // Shift the rest down a touch when the clock is shown so nothing crowds.
      int base = haveClock ? 17 : 10;
      char t[16];
      snprintf(t, sizeof(t), "%d\xF7", g_settings.wxTemp);  // temp
      centerText(t, base, amber(), 2);
      centerText(g_settings.wxText, base + 21, white());
      char hl[20];
      snprintf(hl, sizeof(hl), "H%d  L%d", g_settings.wxHi, g_settings.wxLo);
      centerText(hl, base + 34, cyan());
    } else {
      // Not fetched yet (no Wi-Fi/apiBase) — show the module is active.
      centerText("WEATHER", 12, amber());
      char buf[24];
      snprintf(buf, sizeof(buf), "%.2f,%.2f", g_settings.lat, g_settings.lon);
      centerText(buf, 34, white());
    }
  }

  void drawTeams() {
    int n = 0;
    for (int i = 0; i < 8; i++) if (g_settings.teams[i].length()) n++;
    if (n == 0) return;
    int y = (height_ - (n * 20 - 3)) / 2;   // vertically center the block
    if (y < 1) y = 1;
    for (int i = 0; i < 8 && y < height_; i++) {
      String t = g_settings.teams[i];
      if (!t.length()) continue;
      // t is "LEAGUE:ABBR" (e.g. "MLB:NYY").
      int colon = t.indexOf(':');
      String abbr = colon >= 0 ? t.substring(colon + 1) : t;
      String head = abbr;
      if (g_settings.teamRecord[i].length()) head += "  " + g_settings.teamRecord[i];
      centerText(head, y, cyan());
      String sub = g_settings.teamLabel[i];
      centerText(sub.length() ? sub : String("--"), y + 9, white());
      y += 20;
    }
  }

  void drawShows() {
    int total = showCount();
    if (total == 0) return;
    int pages = (total + SHOWS_PER_PAGE - 1) / SHOWS_PER_PAGE;
    // Which page is this? Derived from the carousel position (M_TV pages are
    // consecutive), so it never flickers between redraws.
    int page = current_ - tvFirstFrame_;
    if (page < 0 || page >= pages) page = 0;

    // Balance shows evenly across pages (earlier pages take the remainder):
    // 4->[4], 5->[3,2], 6->[3,3], 7->[4,3], 8->[4,4].
    int base = total / pages;
    int rem = total % pages;
    int start = 0;
    for (int j = 0; j < page; j++) start += base + (j < rem ? 1 : 0);
    int want = base + (page < rem ? 1 : 0);

    // Build the list of show indices for this page.
    int idxs[SHOWS_PER_PAGE];
    int cnt = 0, seen = 0;
    for (int i = 0; i < 8 && cnt < want; i++) {
      if (!g_settings.shows[i].length()) continue;
      if (seen++ < start) continue;
      idxs[cnt++] = i;
    }
    if (cnt == 0) return;

    int hdr = pages > 1 ? 8 : 0;   // reserve a row for the "1/2" page tag
    if (pages > 1) {
      char tag[8];
      snprintf(tag, sizeof(tag), "%d/%d", page + 1, pages);
      centerText(tag, 1, dim());
    }
    int avail = height_ - hdr - 2;
    int rowH = avail / cnt;
    if (rowH > 20) rowH = 20;
    if (rowH < 14) rowH = 14;
    int lblOff = rowH >= 18 ? 9 : 8;
    int y = hdr + (avail - rowH * cnt) / 2;
    if (y < hdr) y = hdr;
    for (int k = 0; k < cnt; k++) {
      int i = idxs[k];
      centerText(g_settings.shows[i].substring(0, 21), y, cyan());
      String lbl = g_settings.showLabel[i];
      centerText(lbl.length() ? lbl : String("--"), y + lblOff, white());
      y += rowH;
    }
  }

  void drawStocks() {
    int n = 0;
    for (int i = 0; i < 8; i++) if (g_settings.stocks[i].length()) n++;
    int top = (height_ - (12 + n * 12)) / 2;  // center header + rows
    if (top < 1) top = 1;
    centerText("MARKETS", top, green());
    int y = top + 14;
    for (int i = 0; i < 8 && y < height_ - 6; i++) {
      if (!g_settings.stocks[i].length()) continue;
      if (!g_settings.stockOk[i]) {
        // No live data (e.g. delisted / unknown) — flag it dimly so the user
        // knows to remove it, rather than showing a stale/blank price.
        centerText(g_settings.stocks[i] + " NO DATA", y, dim());
        y += 12;
        continue;
      }
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
    int n = 0;
    for (int i = 0; i < 8; i++)
      if (g_settings.teams[i].length() &&
          (g_settings.teamHL[i] == "live" || g_settings.teamHL[i] == "recent"))
        n++;
    int top = (height_ - (12 + n * 14)) / 2;   // center header + rows
    if (top < 1) top = 1;
    centerText("SCORES", top, amber());
    int y = top + 16;
    for (int i = 0; i < 8 && y < height_ - 6; i++) {
      if (!g_settings.teams[i].length()) continue;
      if (g_settings.teamHL[i] != "live" && g_settings.teamHL[i] != "recent") continue;
      String t = g_settings.teams[i];
      int colon = t.indexOf(':');
      String abbr = colon >= 0 ? t.substring(colon + 1) : t;
      // Prefix the team's own abbr so it's clear WHICH team the score is.
      centerText(abbr + " " + g_settings.teamLabel[i], y, white());
      y += 14;
    }
  }

  void drawReminders() {
    int n = 0;
    for (int i = 0; i < 4; i++) if (g_settings.reminders[i].length()) n++;
    int top = (height_ - (12 + n * 14)) / 2;   // center header + rows
    if (top < 1) top = 1;
    centerText("NEW TONIGHT", top, green());
    int y = top + 16;
    for (int i = 0; i < 4 && y < height_ - 6; i++) {
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
