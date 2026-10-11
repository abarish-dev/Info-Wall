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
#include "Logos.h"
#include "DogSprite.h"
#include <Fonts/FreeMono9pt7b.h>
#include <esp_system.h>

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
  // ---- Dog walk-by ---------------------------------------------------------
  bool dogActive() const { return dogActive_; }
  void dogNow() { dogForce_ = true; }
  void dogReschedule() { dogNext_ = 0; }

  void begin() {
    HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN);
    // MatrixPortal S3 pin map. Adjust here if your wiring differs.
    mxconfig.gpio.r1 = 42; mxconfig.gpio.g1 = 41; mxconfig.gpio.b1 = 40;
    mxconfig.gpio.r2 = 38; mxconfig.gpio.g2 = 39; mxconfig.gpio.b2 = 37;
    mxconfig.gpio.a  = 45; mxconfig.gpio.b  = 36; mxconfig.gpio.c  = 48;
    mxconfig.gpio.d  = 35; mxconfig.gpio.e  = 21;
    mxconfig.gpio.lat = 47; mxconfig.gpio.oe = 14; mxconfig.gpio.clk = 2;
    mxconfig.clkphase = false;
    // Library defaults we leave explicit so scanline tearing is easier to reason
    // about: single DMA buffer (writing while the panel is scanning tears),
    // 8 MHz I2S, min_refresh_rate 60 Hz, 8-bit color. Double-buffering would
    // hide tears but costs a second internal-SRAM framebuffer (~Aura left it
    // off for Wi-Fi/BLE heap). We avoid tearing by not clear+redrawing every
    // loop tick — see tick().
    mxconfig.double_buff = false;
    mxconfig.i2sspeed = HUB75_I2S_CFG::HZ_8M;
    mxconfig.min_refresh_rate = 60;

    dma_ = new MatrixPanel_I2S_DMA(mxconfig);
    dma_->begin();
    dma_->setBrightness8(map(g_settings.brightness, 0, 100, 0, 255));
    dma_->clearScreen();
    // Never wrap text onto the next row: an over-long line used to spill its
    // tail onto the line below (the stray "mi" under the flight card). Long
    // strings are now fitted/truncated or scrolled explicitly instead.
    dma_->setTextWrap(false);
    width_  = PANEL_RES_X * PANEL_CHAIN;
    height_ = PANEL_RES_Y;
    lastSwitch_ = millis();
  }

  // Call every loop iteration.
  void tick() {
    if (!dma_) return;

    // 1) Effective brightness (schedule can dim / blank the wall).
    int eff = effectiveBrightness();
    if (eff <= 0) {
      // Display off (schedule): a walk that comes due now is skipped, not
      // saved up for the moment the screen comes back on.
      if (!dogActive_ && dogNext_ && (long)(millis() - dogNext_) >= 0) scheduleDog(millis());
      dma_->clearScreen();
      return;
    }

    unsigned long now = millis();
    // First page, or the current page stopped existing (module turned off,
    // plane left range): move on right away, no fade.
    if (!hasPage_ || !pageValid(cur_)) {
      if (!advance()) { hasPage_ = false; dma_->clearScreen(); return; }
      hasPage_ = true;
      fading_ = false;
      lastSwitch_ = frameStart_ = now;
    }

    // 2) Advance on hold timeout (unless pinned). A newly seen plane cuts in
    //    immediately (an interrupt card itself is shown for a full hold).
    int hold = max(2000, g_settings.holdDurationMs);
    // Live games stay up twice as long as other pages (was 1.5x).
    if (cur_.m == M_SPORTS) {
      int slot = teamSlotAt(cur_.idx);
      if (slot >= 0 && g_settings.teamHL[slot] == "live") hold = hold * 2;
    }

    // Dog walk-by: at a random time (or on request from the app), the dog
    // walks across the bottom of whatever page is up. The page doesn't change
    // under it, and Wi-Fi fetches wait until it's gone.
    if (!dogActive_) {
      if (dogNext_ == 0) scheduleDog(now);
      bool due = g_settings.dogEnabled && (long)(now - dogNext_) >= 0;
      if ((dogForce_ || due) && !fading_ && hasPage_) {
        dogActive_ = true; dogForce_ = false; dogStart_ = now;
      }
    }

    bool cutIn = !dogActive_ && queueLen_ > 0 && !g_settings.isPinned &&
                 (!cur_.interrupt || now - lastSwitch_ >= (unsigned long)hold);
    if (!fading_ && !dogActive_ && (cutIn || (!g_settings.isPinned &&
                               now - lastSwitch_ >= (unsigned long)hold))) {
      fading_    = true;
      fadeOut_   = true;
      fadeStart_ = now;
    }

    // 3) Cross-fade brightness ramp between pages.
    int drawBright = eff;
    if (fading_) {
      int fadeMs = (11 - constrain(g_settings.fadeSpeed, 1, 10)) * 90; // 90..900ms
      float t = fadeMs > 0 ? (float)(now - fadeStart_) / fadeMs : 1.0f;
      if (t >= 1.0f) {
        if (fadeOut_) {
          if (!advance()) { hasPage_ = false; dma_->clearScreen(); return; }
          frameStart_ = now;
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
    uint8_t br8 = (uint8_t)map(drawBright, 0, 100, 0, 255);
    if (br8 != lastBright8_) {
      dma_->setBrightness8(br8);
      lastBright8_ = br8;
    }

    // 4) Draw the current page. The DMA framebuffer is single-buffered and is
    // scanned top→bottom at ~min_refresh_rate while we write it — a full
    // clearScreen()+redraw every loop (~15ms) looks like scanline flashing.
    // Only rebuild the buffer when the picture actually changes (new page,
    // fade page swap, dog walk, weather minute, or live content fingerprint).
    uint32_t fp = pageFingerprint();
    int wxMin = -1;
    if (cur_.m == M_WEATHER) {
      struct tm t;
      if (getLocalTime(&t, 0)) wxMin = t.tm_hour * 60 + t.tm_min;
    }
    bool pageChanged = !bufferValid_ || cur_.m != lastDrawnM_ || cur_.idx != lastDrawnIdx_;
    bool contentChanged = fp != lastFp_ || wxMin != lastWxMin_;
    // Marquee (TV titles that don't fit) advances with millis()-frameStart_;
    // it only moves if we keep redrawing. Static pages still hold.
    bool mustDraw = pageChanged || contentChanged || dogActive_ || pageNeedsScroll() ||
                    (fading_ && fadeOut_ == false && frameStart_ == now);
    // After advancing mid-fade, force one redraw of the new page.
    if (fading_ && !fadeOut_ && (now - fadeStart_ < 30)) mustDraw = true;

    if (mustDraw) {
      dma_->clearScreen();
      drawModule(cur_.m);
      lastDrawnM_ = cur_.m;
      lastDrawnIdx_ = cur_.idx;
      lastFp_ = fp;
      lastWxMin_ = wxMin;
      bufferValid_ = true;
    }
    if (dogActive_) {
      // Dog is animated: redraw the whole page under it each step so we don't
      // leave trails (still only while walking — a few seconds).
      if (!mustDraw) {
        dma_->clearScreen();
        drawModule(cur_.m);
      }
      if (!drawDog(now)) {
        dogActive_ = false;
        scheduleDog(now);
        bufferValid_ = false;  // restore a clean page without the dog
        if (now - lastSwitch_ > (unsigned long)hold - 2000UL) lastSwitch_ = now - (hold - 2000UL);
      }
    }
  }

  // True when the current page has at least one marquee line (text wider than
  // the panel). Those pages must redraw every tick so the scroll offset moves.
  bool pageNeedsScroll() {
    if (cur_.m == M_TV) {
      int total = showCount();
      if (total == 0) return false;
      int pages = (total + SHOWS_PER_PAGE - 1) / SHOWS_PER_PAGE;
      int page = cur_.idx;
      if (page < 0 || page >= pages) page = 0;
      int seen = 0, onPage = 0;
      for (int i = 0; i < 8 && onPage < SHOWS_PER_PAGE; i++) {
        if (!g_settings.shows[i].length()) continue;
        if (seen++ < page * SHOWS_PER_PAGE) continue;
        onPage++;
        if (textW(g_settings.shows[i]) > width_) return true;
      }
    }
    return false;
  }

  // Cheap fingerprint of the fields the current page reads, so a Wi-Fi/BLE
  // update triggers one redraw without clearing 60×/s.
  uint32_t pageFingerprint() {
    auto mix = [](uint32_t h, uint32_t v) {
      h ^= v + 0x9e3779b9u + (h << 6) + (h >> 2);
      return h;
    };
    auto mixStr = [&](uint32_t h, const String &s) {
      for (unsigned i = 0; i < s.length(); i++) h = mix(h, (uint8_t)s[i]);
      return mix(h, s.length());
    };
    uint32_t h = (uint32_t)cur_.m * 131u + (uint32_t)cur_.idx;
    switch (cur_.m) {
      case M_WEATHER:
        h = mix(h, (uint32_t)g_settings.wxTemp);
        h = mix(h, (uint32_t)g_settings.wxHi);
        h = mix(h, (uint32_t)g_settings.wxLo);
        h = mixStr(h, g_settings.wxText);
        break;
      case M_LKN:
        h = mixStr(h, g_settings.lakeLvl);
        h = mixStr(h, g_settings.lakeTgt);
        h = mixStr(h, g_settings.lakeTgtDiff);
        h = mixStr(h, g_settings.lakeFull);
        h = mix(h, (uint32_t)g_settings.lakeWater);
        break;
      case M_SPORTS: {
        int i = teamSlotAt(cur_.idx);
        if (i >= 0) {
          h = mixStr(h, g_settings.teamRecord[i]);
          h = mixStr(h, g_settings.teamLabel[i]);
          h = mixStr(h, g_settings.teamShort[i]);
          h = mixStr(h, g_settings.teamOpp[i]);
          h = mixStr(h, g_settings.teamOppRec[i]);
          h = mixStr(h, g_settings.teamStatus[i]);
          h = mixStr(h, g_settings.teamNextDay[i]);
          h = mixStr(h, g_settings.teamNextTime[i]);
          h = mixStr(h, g_settings.teamHL[i]);
          h = mix(h, (uint32_t)(uint16_t)g_settings.teamScore[i]);
          h = mix(h, (uint32_t)(uint16_t)g_settings.teamOppScore[i]);
        }
        break;
      }
      case M_FOLLY:
        h = mixStr(h, g_settings.follyL1);
        h = mixStr(h, g_settings.follyL2);
        h = mix(h, (uint32_t)g_settings.follyWater);
        h = mixStr(h, g_settings.follyDir);
        break;
      case M_STOCKS:
        for (int i = 0; i < 8; i++) {
          h = mixStr(h, g_settings.stocks[i]);
          h = mix(h, (uint32_t)(g_settings.stockPrice[i] * 100));
        }
        break;
      case M_MARKETS:
        h = mixStr(h, g_settings.marketStatus);
        h = mix(h, (uint32_t)g_settings.marketCount);
        break;
      case M_PLANES: {
        // Plane pages use DisplayManager's own list; idx is enough with notePlanes
        // forcing a redraw via bufferValid_ clear if we add that later.
        break;
      }
      case M_MESSAGE:
        h = mixStr(h, g_settings.msgLine1);
        h = mixStr(h, g_settings.msgLine2);
        h = mixStr(h, g_settings.msgLine3);
        break;
      case M_TV: {
        int i = cur_.idx;
        if (i >= 0 && i < 8) {
          h = mixStr(h, g_settings.shows[i]);
          h = mixStr(h, g_settings.showLabel[i]);
        }
        break;
      }
      default:
        break;
    }
    return h;
  }

  // Replace the in-range aircraft list (nearest first). A callsign not seen in
  // the last 10 minutes is queued to interrupt the rotation once; the very
  // first fetch after boot only seeds the list. Planes no longer reported drop
  // out of the cycle immediately (pageValid() fails for them).
  void notePlanes(const PlaneInfo *list, int n) {
    bufferValid_ = false;  // plane cards read this list
    unsigned long now = millis();
    bool seeding = !planesSeeded_ || now < 45000UL;
    for (int i = 0; i < n; i++) {
      const String &cs = list[i].cs;
      if (!cs.length()) continue;
      if (!seeding && !recentlySeen(cs, now)) enqueue(cs);
      markSeen(cs, now);
    }
    n = min(n, 6);
    for (int i = 0; i < n; i++) g_settings.planes[i] = list[i];
    g_settings.planeCount = n;
    planesSeeded_ = true;
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

  // Full-screen two-line status (used by the OTA updater: "UPDATE" / "v1.1.1").
  void message(const String &l1, const String &l2) {
    if (!dma_) return;
    dma_->setBrightness8(map(max(30, g_settings.brightness), 0, 100, 0, 255));
    dma_->clearScreen();
    centerText(l1, 18, amber(), 2);
    centerText(l2, 42, softWhite());
  }

 private:
  static const uint32_t kTeamLabelStaleSec = 3 * 3600;  // saved team label max age
  enum Module { M_MARKETS, M_MESSAGE, M_FLIGHT, M_PLANES, M_WEATHER, M_SPORTS, M_SCORES,
                M_TV, M_STOCKS, M_COUNTDOWN, M_REMINDERS, M_LKN, M_FOLLY };

  MatrixPanel_I2S_DMA *dma_ = nullptr;
  int width_ = 128, height_ = 64;
  static const int SHOWS_PER_PAGE = 2;   // Shows module paginates in the carousel
  static const int TEAMS_PER_PAGE = 2;   // Teams rows (24px logo + 2 lines each)
  // Current page. idx = page number for paged modules; plane = callsign.
  struct Page { Module m = M_WEATHER; int idx = 0; String plane; bool interrupt = false; };
  Page cur_;
  bool hasPage_ = false;
  unsigned long frameStart_ = 0;  // when the current page became visible (marquee)
  unsigned long lastSwitch_ = 0;
  bool fading_ = false, fadeOut_ = false;
  unsigned long fadeStart_ = 0;

  // Rotation: categories take turns (round-robin), one page per turn, each
  // with its own wrap-around cursor, so a long category (6 shows = 3 pages)
  // never runs as a block. Info pages get two turns per round because there
  // are more of them. Empty categories are skipped.
  enum Cat { C_INFO = 0, C_TEAMS, C_SHOWS, C_PLANES, C_COUNT };
  static constexpr int PATTERN_LEN = 5;
  const Cat PATTERN[PATTERN_LEN] = {C_INFO, C_TEAMS, C_INFO, C_SHOWS, C_PLANES};
  // While any followed team is LIVE: every third page is a live game (with
  // the 2x hold that's ~45% of screen time), and the Teams turn only cycles
  // the live teams (non-live team pages - tomorrow's games, offseason
  // records - sit out until no game is live).
  static constexpr int LIVE_PATTERN_LEN = 6;
  const Cat LIVE_PATTERN[LIVE_PATTERN_LEN] = {C_TEAMS, C_INFO, C_SHOWS,
                                              C_TEAMS, C_INFO, C_PLANES};
  int patPos_ = 0;
  bool liveMode_ = false;
  int cursor_[C_COUNT] = {0, 0, 0, 0};

  // New-plane interrupt queue (callsigns, nearest first) + "seen" memory.
  static const int QMAX = 3;
  String queue_[QMAX];
  int queueLen_ = 0;
  static const int SEEN_MAX = 24;
  String seenCs_[SEEN_MAX];
  unsigned long seenAt_[SEEN_MAX] = {0};
  bool planesSeeded_ = false;

  int infoModules(Module *out) {
    int n = 0;
    if (g_settings.showCustomMessage && msgHasText()) out[n++] = M_MESSAGE;
    if (g_settings.trackFlight && g_settings.flightIdent.length()) out[n++] = M_FLIGHT;
    if (g_settings.showWeather) out[n++] = M_WEATHER;
    if (anyStock()) out[n++] = M_STOCKS;
    if (g_settings.showMarkets && g_settings.marketCount > 0) out[n++] = M_MARKETS;
    if (g_settings.showCountdown && g_settings.countdownLabel.length()) out[n++] = M_COUNTDOWN;
    if (anyReminder()) out[n++] = M_REMINDERS;
    if (g_settings.showLKN)   out[n++] = M_LKN;
    if (g_settings.showFolly) out[n++] = M_FOLLY;
    return n;
  }
  int liveCount() {
    int n = 0;
    for (int i = 0; i < 8; i++)
      if (g_settings.teams[i].length() && g_settings.teamHL[i] == "live" && !teamStale(i)) n++;
    return n;
  }
  int teamPages() { return (teamCount() + TEAMS_PER_PAGE - 1) / TEAMS_PER_PAGE; }
  int showPages() { return (showCount() + SHOWS_PER_PAGE - 1) / SHOWS_PER_PAGE; }
  int catCount(Cat c) {
    Module tmp[14];
    switch (c) {
      case C_INFO:   return infoModules(tmp);
      case C_TEAMS:  { int l = liveCount(); return l ? l : teamCount(); }  // live only while any is live
      case C_SHOWS:  return showPages();
      case C_PLANES: return g_settings.planeCount;
      default:       return 0;
    }
  }
  Page pageFor(Cat c, int k) {
    Page p;
    if (c == C_INFO) { Module tmp[14]; infoModules(tmp); p.m = tmp[k]; }
    else if (c == C_TEAMS) {
      p.m = M_SPORTS; p.idx = k;   // k-th team in display order (teamSlotAt)
    }
    else if (c == C_SHOWS) { p.m = M_TV; p.idx = k; }
    else { p.m = M_PLANES; p.plane = g_settings.planes[k].cs; }
    return p;
  }
  int planeSlot(const String &cs) {
    for (int i = 0; i < g_settings.planeCount; i++)
      if (g_settings.planes[i].cs == cs) return i;
    return -1;
  }
  bool pageValid(const Page &p) {
    Module tmp[14];
    int n;
    switch (p.m) {
      case M_PLANES: return planeSlot(p.plane) >= 0;
      case M_SPORTS: return p.idx < teamCount();
      case M_SCORES: return anyScore();
      case M_TV:     return p.idx < showPages();
      default:
        n = infoModules(tmp);
        for (int i = 0; i < n; i++) if (tmp[i] == p.m) return true;
        return false;
    }
  }
  // Pick the next page: a queued new plane first, else the next category turn.
  bool advance() {
    while (queueLen_ > 0 && !g_settings.isPinned) {
      String cs = queue_[0];
      for (int i = 1; i < queueLen_; i++) queue_[i - 1] = queue_[i];
      queueLen_--;
      if (planeSlot(cs) < 0) continue;   // already gone
      cur_ = Page();
      cur_.m = M_PLANES; cur_.plane = cs; cur_.interrupt = true;
      return true;
    }
    bool live = liveCount() > 0;
    if (live != liveMode_) {            // a game started / ended: restart the
      liveMode_ = live;                 // pattern so a new live game shows next
      patPos_ = 0;
      cursor_[C_TEAMS] = 0;
    }
    const Cat *pat = live ? LIVE_PATTERN : PATTERN;
    const int len = live ? LIVE_PATTERN_LEN : PATTERN_LEN;
    for (int t = 0; t < len; t++) {
      Cat c = pat[patPos_ % len];
      patPos_ = (patPos_ + 1) % len;
      int n = catCount(c);
      if (n == 0) continue;
      int k = cursor_[c] % n;
      cursor_[c] = k + 1;
      cur_ = pageFor(c, k);
      return true;
    }
    return false;
  }
  bool recentlySeen(const String &cs, unsigned long now) {
    for (int i = 0; i < SEEN_MAX; i++)
      if (seenCs_[i] == cs && now - seenAt_[i] < 600000UL) return true;
    return false;
  }
  void markSeen(const String &cs, unsigned long now) {
    int oldest = 0;
    for (int i = 0; i < SEEN_MAX; i++) {
      if (seenCs_[i] == cs) { seenAt_[i] = now; return; }
      if (seenAt_[i] < seenAt_[oldest]) oldest = i;
    }
    seenCs_[oldest] = cs;
    seenAt_[oldest] = now;
  }
  void enqueue(const String &cs) {
    for (int i = 0; i < queueLen_; i++) if (queue_[i] == cs) return;
    if (queueLen_ < QMAX) queue_[queueLen_++] = cs;   // beyond 3: just joins rotation
  }

  uint16_t red()   { return dma_->color565(255, 40, 40); }
  uint16_t green() { return dma_->color565(60, 255, 100); }
  uint16_t blue()  { return dma_->color565(40, 160, 255); }
  uint16_t amber() { return dma_->color565(255, 176, 0); }
  uint16_t cyan()  { return dma_->color565(34, 211, 238); }
  uint16_t white() { return dma_->color565(240, 240, 240); }
  uint16_t dim()   { return dma_->color565(90, 90, 90); }
  // Calmer palette for the denser pages (shows / teams / flight card). On a
  // HUB75 panel full-scale 240+ channels read as harsh glare at close range.
  uint16_t softWhite() { return dma_->color565(185, 185, 180); }
  uint16_t muted()     { return dma_->color565(120, 120, 115); }
  uint16_t faint()     { return dma_->color565(38, 38, 38); }
  uint16_t titleBlue() { return dma_->color565(95, 150, 200); }
  uint16_t softAmber() { return dma_->color565(205, 140, 45); }
  uint16_t softGreen() { return dma_->color565(80, 190, 115); }
  uint16_t softRed()   { return dma_->color565(215, 70, 60); }
  uint16_t routeBlue() { return dma_->color565(120, 175, 215); }

  // ---- Redraw gating (single DMA buffer) ------------------------------------
  bool bufferValid_ = false;
  Module lastDrawnM_ = M_MESSAGE;
  int lastDrawnIdx_ = -1;
  uint32_t lastFp_ = 0;
  int lastWxMin_ = -2;
  uint8_t lastBright8_ = 0xFF;

  // ---- Dog walk-by state ----------------------------------------------------
  bool dogActive_ = false, dogForce_ = false;
  unsigned long dogStart_ = 0, dogNext_ = 0;
  static const int kDogPxPerSec = 25;   // ~7s to cross 46 + 128 px
  static const int kDogStepPx = 5;      // next walk frame every 5 px

  void scheduleDog(unsigned long now) {
    int lo = constrain(g_settings.dogMinMin, 1, 720);
    int hi = max(lo, constrain(g_settings.dogMaxMin, 1, 720));
    uint32_t mins = lo + esp_random() % (uint32_t)(hi - lo + 1);
    dogNext_ = now + mins * 60000UL;
    if (dogNext_ == 0) dogNext_ = 1;
  }
  // Draw the dog for this moment; false once it has walked off the right edge.
  bool drawDog(unsigned long now) {
    int x = -DOG_W + (int)((now - dogStart_) * kDogPxPerSec / 1000);
    if (x >= width_) return false;
    int f = ((x + DOG_W) / kDogStepPx) % DOG_FRAMES;
    int y0 = height_ - DOG_H;
    for (int r = 0; r < DOG_H; r++)
      for (int c = 0; c < DOG_W; c++) {
        int X = x + c;
        if (X < 0 || X >= width_) continue;
        uint8_t idx = pgm_read_byte(&DOG_PIX[f][r * DOG_W + c]);
        if (idx) dma_->drawPixel(X, y0 + r, pgm_read_word(&DOG_PAL[idx]));
      }
    return true;
  }

  // ---- One team per page ------------------------------------------------------
  // k-th team in display order: live games, then recent finals, then the rest
  // (each group in the order the teams were added).
  int teamSlotAt(int k) {
    for (int pass = 0; pass < 3; pass++)
      for (int i = 0; i < 8; i++) {
        if (!g_settings.teams[i].length()) continue;
        const String &hl = g_settings.teamHL[i];
        int grp = (hl == "live" && !teamStale(i)) ? 0 : (hl == "recent" ? 1 : 2);
        if (grp != pass) continue;
        if (k-- == 0) return i;
      }
    return -1;
  }
  // Same freshness rule as drawTeamRow: with a valid clock, data older than 3h
  // (or never timestamped) isn't shown as current.
  bool teamStale(int i) {
    time_t nowT = time(nullptr);
    if (nowT <= 1600000000) return false;
    uint32_t ts = g_settings.teamTs[i];
    return ts == 0 || (uint32_t)nowT - ts > kTeamLabelStaleSec;
  }
  // Center a string in FreeMono9pt7b (Aura's score font) at a baseline.
  void monoCenter(const String &t, int baseline, uint16_t c, int left = 0, int w = -1) {
    if (w < 0) w = width_;
    int16_t x1, y1; uint16_t tw, th;
    dma_->setFont(&FreeMono9pt7b);
    dma_->setTextSize(1);
    dma_->getTextBounds(t.c_str(), 0, baseline, &x1, &y1, &tw, &th);
    dma_->setCursor(left + (w - (int)tw) / 2 - x1, baseline);
    dma_->setTextColor(c);
    dma_->print(t);
    dma_->setFont(nullptr);
  }
  void centerIn(const String &t, int y, uint16_t c, int left, int w) {
    int x = left + (w - (int)t.length() * 6) / 2;
    textAt(t, x < left ? left : x, y, c);
  }
  void teamBadgeOrLogo(const String &league, const String &abbr, int x, int y, int slotColor) {
    const LogoAsset *lg = league.length() ? teamLogo(league, abbr) : nullptr;
    if (lg) { drawLogo(lg, x, y); return; }
    uint16_t col = dma_->color565(120, 120, 120);
    if (slotColor >= 0) {
      String hex = g_settings.teamColor[slotColor];
      if (hex.length() >= 7 && hex[0] == '#') {
        long v = strtol(hex.c_str() + 1, nullptr, 16);
        col = dma_->color565((v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF);
      }
    }
    drawBadge(abbr, x, y, col);
  }

  // Live / final game card (Aura layout): away team on top, home below, each
  // "ABBR score" in FreeMono with its record under it; status line at the
  // bottom (red dot when live; FINAL green on a win). Upcoming: both logos,
  // "@"/"vs", records, then day + time. Falls back to the old single row when
  // the backend hasn't sent the card fields (or the data is stale).
  void drawTeamPage(int i) {
    if (i < 0) return;
    String t = g_settings.teams[i];
    int colon = t.indexOf(':');
    String league = colon >= 0 ? t.substring(0, colon) : "";
    String me = colon >= 0 ? t.substring(colon + 1) : t;
    const String &hl = g_settings.teamHL[i];
    const String &opp = g_settings.teamOpp[i];
    bool stale = teamStale(i);
    bool game = (hl == "live" || hl == "recent") && opp.length() &&
                g_settings.teamScore[i] >= 0 && g_settings.teamOppScore[i] >= 0;
    bool next = opp.length() && g_settings.teamNextDay[i].length();
    if (stale || (!game && !next)) { drawTeamRow(i, 20); return; }

    if (game) {
      bool home = g_settings.teamHome[i] == 1;
      String aw = home ? opp : me, hm = home ? me : opp;
      int as = home ? g_settings.teamOppScore[i] : g_settings.teamScore[i];
      int hs = home ? g_settings.teamScore[i] : g_settings.teamOppScore[i];
      String ar = home ? g_settings.teamOppRec[i] : g_settings.teamRecord[i];
      String hr = home ? g_settings.teamRecord[i] : g_settings.teamOppRec[i];
      teamBadgeOrLogo(league, aw, 3, 1, home ? -1 : i);
      teamBadgeOrLogo(league, hm, 3, 27, home ? i : -1);
      const int L = 30, Wd = width_ - 32;
      monoCenter(aw + " " + String(as), 16, as >= hs ? softWhite() : muted(), L, Wd);
      if (ar.length()) centerIn(ar, 19, muted(), L, Wd);
      dma_->drawFastHLine(32, 30, width_ - 36, faint());
      monoCenter(hm + " " + String(hs), 42, hs >= as ? softWhite() : muted(), L, Wd);
      if (hr.length()) centerIn(hr, 45, muted(), L, Wd);
      String st = g_settings.teamStatus[i];
      if (hl == "live") {
        if (!st.length()) st = "LIVE";
        st = fitWords(st, (width_ - 8) / 6);
        int w = st.length() * 6 + 6, x = (width_ - w) / 2;
        dma_->fillRect(x, 58, 3, 3, softRed());
        textAt(st, x + 6, 56, softWhite());
      } else {
        if (!st.length()) st = "FINAL";
        int my = g_settings.teamScore[i], op = g_settings.teamOppScore[i];
        centerText(st, 56, my > op ? softGreen() : muted());
      }
      return;
    }

    // Upcoming
    bool home = g_settings.teamHome[i] == 1;
    teamBadgeOrLogo(league, me, 3, 3, i);
    teamBadgeOrLogo(league, opp, width_ - 27, 3, -1);
    monoCenter(home ? "vs" : "@", 20, softWhite(), 27, width_ - 54);
    if (g_settings.teamRecord[i].length()) centerIn(g_settings.teamRecord[i], 30, muted(), 0, 30);
    if (g_settings.teamOppRec[i].length()) centerIn(g_settings.teamOppRec[i], 30, muted(), width_ - 30, 30);
    dma_->drawFastHLine(4, 40, width_ - 8, faint());
    centerText(g_settings.teamNextDay[i], 44, hl == "today" ? softAmber() : muted());
    if (g_settings.teamNextTime[i].length()) monoCenter(g_settings.teamNextTime[i], 62, softAmber());
  }

  bool msgHasText() {
    return g_settings.msgLine1.length() || g_settings.msgLine2.length() ||
           g_settings.msgLine3.length();
  }
  bool anyTeam()  { for (int i=0;i<8;i++) if (g_settings.teams[i].length())  return true; return false; }
  bool anyShow()  { for (int i=0;i<8;i++) if (g_settings.shows[i].length())  return true; return false; }
  int  teamCount(){ int n=0; for (int i=0;i<8;i++) if (g_settings.teams[i].length()) n++; return n; }
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
      case M_SPORTS:    drawTeamPage(teamSlotAt(cur_.idx)); break;
      case M_SCORES:    drawScores();    break;
      case M_TV:        drawShows();     break;
      case M_STOCKS:    drawStocks();    break;
      case M_COUNTDOWN: drawCountdown(); break;
      case M_REMINDERS: drawReminders(); break;
      case M_LKN:       drawLake();  break;
      case M_FOLLY:     drawFolly(); break;
      case M_MARKETS:   drawMarkets(); break;
    }
  }

  void drawLabel(const String &s, uint16_t c) { centerText(s, height_/2 - 4, c, 1); }

  void drawFolly() {
    centerText("FOLLY TIDES", 4, amber());
    if (g_settings.follyL1.length()) {
      // Tide direction. Prefer the backend's value, but if it's missing infer
      // it from the next tide: next High => water coming IN (rising); next Low
      // => going OUT (falling). This keeps the indicator working even if an
      // older phone app pushed tides without a direction field.
      String dir = g_settings.follyDir;
      if (dir.length() == 0) {
        char c = g_settings.follyL1.charAt(0);
        if (c == 'H') dir = "in";
        else if (c == 'L') dir = "out";
      }
      if (dir == "in")
        centerText("\x18 INCOMING", 16, green());
      else if (dir == "out")
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
    if (g_settings.lakeLvl.length() && g_settings.lakeTgt.length()) {
      // 5-line layout with Duke's guide-curve target ("TGT 98.5 -1.0ft"):
      // green when within 0.5 ft of target, amber otherwise.
      centerText("LAKE NORMAN", 3, cyan());
      centerText(String("LEVEL ") + g_settings.lakeLvl + "ft", 16, white());
      float d = g_settings.lakeTgtDiff.toFloat();
      String t = String("TGT ") + g_settings.lakeTgt;
      if (g_settings.lakeTgtDiff.length()) t += " " + g_settings.lakeTgtDiff + "ft";
      centerText(t, 28, fabsf(d) <= 0.5f ? green() : amber());
      if (g_settings.lakeFull.length())
        centerText(String("FULL ") + g_settings.lakeFull + "ft", 40, dma_->color565(120, 175, 215));
      if (g_settings.lakeWater > 0) {
        char w[16];
        snprintf(w, sizeof(w), "WATER %d\xF7", g_settings.lakeWater);
        centerText(w, 53, green());
      }
      return;
    }
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

  // ---- text helpers --------------------------------------------------------
  // Default GFX font: 6px advance, 7px glyphs (+1px spacing).
  static int textW(const String &t, uint8_t size = 1) { return t.length() * 6 * size; }

  void textAt(const String &t, int x, int y, uint16_t c, uint8_t size = 1) {
    dma_->setTextSize(size);
    dma_->setTextColor(c);
    dma_->setCursor(x, y);
    dma_->print(t);
  }

  // Shorten to <= maxChars: drop trailing words first ("American Airlines" ->
  // "American"), then hard-cut. Never leaves a dangling partial word if a
  // word boundary is reasonably close.
  static String fitWords(String t, int maxChars) {
    t.trim();
    if ((int)t.length() <= maxChars) return t;
    String cut = t.substring(0, maxChars + 1);
    int sp = cut.lastIndexOf(' ');
    if (sp >= maxChars / 2) return t.substring(0, sp);
    return t.substring(0, maxChars);
  }

  // A full-width line that is centered if it fits, otherwise scrolls slowly
  // (1.5s pause, ~25px/s, 1.5s pause at the end, repeat). Screen edges clip.
  void marquee(const String &t, int y, uint16_t c) {
    int w = textW(t);
    if (w <= width_) { centerText(t, y, c); return; }
    const int pauseMs = 1500, msPerPx = 40;
    int travel = w - width_ + 2;
    unsigned long cycle = pauseMs * 2 + travel * msPerPx;
    unsigned long el = (millis() - frameStart_) % cycle;
    int off = 0;
    if (el > (unsigned long)pauseMs) off = min(travel, (int)((el - pauseMs) / msPerPx));
    textAt(t, 1 - off, y, c);
  }

  // Small page indicator: one 2x2 dot per page, current page brighter.
  void pageDots(int page, int pages, int cx, int y) {
    if (pages <= 1) return;
    int x = cx - (pages * 5 - 3) / 2;
    for (int k = 0; k < pages; k++, x += 5)
      dma_->fillRect(x, y, 2, 2, k == page ? muted() : faint());
  }

  void drawLogo(const LogoAsset *lg, int x, int y) {
    for (int r = 0; r < lg->h; r++)
      for (int c = 0; c < lg->w; c++) {
        uint16_t px = lg->data[r * lg->w + c];
        if (px) dma_->drawPixel(x + c, y + r, px);  // black = transparent
      }
  }

  // 24x24 fallback badge when there is no bitmap: dim rounded tile + code.
  void drawBadge(const String &code, int x, int y, uint16_t edge) {
    dma_->drawRoundRect(x, y, 24, 24, 4, edge);
    String c = code.substring(0, 3);
    textAt(c, x + (24 - textW(c)) / 2 + 1, y + 8, softWhite());
  }

  // ---- overhead flight card -----------------------------------------------
  //  [logo]  AA2854          <- flight number, 2x
  //  [24px]  American        <- airline (fitted)
  //  ---------------------------------------------
  //            DSM -> CLT     <- route (adsbdb), or aircraft type
  //   4,775'    225mph   4.8mi
  void drawPlanes() {
    int slot = planeSlot(cur_.plane);
    if (slot < 0) return;
    const PlaneInfo &P = g_settings.planes[slot];
    String ident = P.ident.length() ? P.ident : P.cs;
    if (!P.airline.length() && !P.type.length() && P.alt < 0) { drawPlanesSimple(P); return; }

    const LogoAsset *lg = P.logo.length()
                              ? airlineLogo(P.logo) : nullptr;
    if (lg) drawLogo(lg, 3, 4);
    else if (P.code.length()) drawBadge(P.code, 3, 4, muted());
    else {
      // Private / GA aircraft: a small top-down plane glyph (nose right).
      uint16_t c = muted();
      dma_->fillRect(5, 15, 18, 3, c);                       // fuselage
      dma_->fillTriangle(22, 15, 22, 17, 25, 16, c);         // nose
      dma_->fillTriangle(17, 15, 13, 15, 9, 5, c);           // upper wing
      dma_->fillTriangle(17, 15, 9, 5, 11, 5, c);
      dma_->fillTriangle(17, 17, 13, 17, 9, 27, c);          // lower wing
      dma_->fillTriangle(17, 17, 9, 27, 11, 27, c);
      dma_->fillTriangle(8, 15, 5, 15, 3, 10, c);            // tail
      dma_->fillTriangle(8, 17, 5, 17, 3, 22, c);
    }

    const int tx = 32, tw = width_ - tx - 2;           // 94px text column
    uint8_t sz = textW(ident, 2) <= tw ? 2 : 1;
    textAt(ident, tx, sz == 2 ? 4 : 8, softWhite(), sz);
    String sub = P.airline.length() ? P.airline
                                                  : P.type;
    textAt(fitWords(sub, tw / 6), tx, 21, muted());

    dma_->drawFastHLine(3, 32, width_ - 6, faint());

    String mid;
    if (P.from.length() && P.to.length())
      mid = P.from + " \x1A " + P.to;   // CP437 arrow
    else if (P.type.length() && P.airline.length())
      mid = P.type;
    if (mid.length()) centerText(mid, 37, routeBlue());

    // Stats row: three 42px columns, each centered.
    String cols[3];
    if (P.alt >= 0) {
      char b[12];
      int a = P.alt;
      if (a >= 1000) snprintf(b, sizeof(b), "%d,%03d'", a / 1000, a % 1000);
      else snprintf(b, sizeof(b), "%d'", a);
      cols[0] = b;
    }
    if (P.spd >= 0) cols[1] = String(P.spd) + "mph";
    if (P.dist >= 0) cols[2] = String(P.dist, 1) + "mi";
    for (int k = 0; k < 3; k++) {
      if (!cols[k].length()) continue;
      int cx = k * 43 + 21;
      textAt(cols[k], cx - textW(cols[k]) / 2, 51, k == 2 ? softAmber() : muted());
    }
  }

  // Older backend/app (only line + code): calmer version of the original card.
  void drawPlanesSimple(const PlaneInfo &P) {
    centerText("OVERHEAD", 6, muted());
    String code = P.code;
    const LogoAsset *lg = code.length() ? airlineLogo(code) : nullptr;
    if (lg) drawLogo(lg, (width_ - 24) / 2, 17);
    else if (code.length()) drawBadge(code, (width_ - 24) / 2, 17, muted());
    String line = P.line;
    // "American Airlines 5.8mi" is 23 chars (138px): drop words from the
    // airline name until it fits, keeping the distance.
    int sp = line.lastIndexOf(' ');
    String dist = sp > 0 ? line.substring(sp + 1) : "";
    String name = sp > 0 ? line.substring(0, sp) : line;
    if (textW(line) > width_ && dist.endsWith("mi"))
      line = fitWords(name, (width_ / 6) - dist.length() - 1) + " " + dist;
    centerText(fitWords(line, width_ / 6), 48, softWhite());
  }

  void drawWeather() {
    if (g_settings.wxText.length()) {
      // Current local time above the temp. Always draw the clock row: the real
      // time once the RTC is set (NTP, or the HTTP time fallback for networks
      // that block NTP), or a dim "--:--" placeholder while it's still syncing
      // so the layout is stable and it's obvious the clock code is running.
      struct tm now;
      bool haveClock = getLocalTime(&now, 5);
      char clk[12];
      if (haveClock) {
        int h12 = now.tm_hour % 12;
        if (h12 == 0) h12 = 12;
        snprintf(clk, sizeof(clk), "%d:%02d%s", h12, now.tm_min,
                 now.tm_hour < 12 ? "a" : "p");
      } else {
        snprintf(clk, sizeof(clk), "--:--");
      }
      centerText(clk, 5, haveClock ? cyan() : dim());
      // Rest of the layout sits below the (always-present) clock row.
      int base = 17;
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

  // One team row: 24px logo (or colored badge) + two short lines.
  //  [logo]  NYY  93-68
  //  [24px]  Sat 6:30p @ TB      <- colored by status
  void drawTeamRow(int i, int y) {
    String t = g_settings.teams[i];
    int colon = t.indexOf(':');
    String league = colon >= 0 ? t.substring(0, colon) : "";
    String abbr = colon >= 0 ? t.substring(colon + 1) : t;
    const LogoAsset *lg = league.length() ? teamLogo(league, abbr) : nullptr;
    if (lg) drawLogo(lg, 3, y);
    else {
      uint8_t r = 120, g = 120, b = 120;
      String hex = g_settings.teamColor[i];
      if (hex.length() >= 7 && hex[0] == '#') {
        long v = strtol(hex.c_str() + 1, nullptr, 16);
        r = (v >> 16) & 0xFF; g = (v >> 8) & 0xFF; b = v & 0xFF;
      }
      drawBadge(abbr, 3, y, dma_->color565(r, g, b));
    }

    const int tx = 32, maxC = (width_ - tx - 1) / 6;   // 15 chars
    textAt(abbr, tx, y + 3, softWhite());
    if (g_settings.teamRecord[i].length())
      textAt(g_settings.teamRecord[i], tx + textW(abbr) + 6, y + 3, muted());

    String hl = g_settings.teamHL[i];
    String k = g_settings.teamShort[i];
    if (!k.length()) k = g_settings.teamLabel[i];   // older backend
    // The font is ASCII-only: drop any multi-byte (emoji/UTF-8) bytes rather
    // than drawing them as garbage glyphs.
    {
      String a;
      for (unsigned j = 0; j < k.length(); j++)
        if ((uint8_t)k[j] >= 0x20 && (uint8_t)k[j] < 0x7F) a += k[j];
      a.trim();
      k = a;
    }
    // A saved label is only trustworthy for a few hours ("Top 4th" from last
    // night must not look live). With a valid clock, an untimestamped or
    // >3h-old label is replaced by a faint "--" until fresh data arrives.
    bool stale = false;
    time_t nowT = time(nullptr);
    if (nowT > 1600000000 && k.length()) {
      uint32_t ts = g_settings.teamTs[i];
      if (ts == 0 || (uint32_t)nowT - ts > kTeamLabelStaleSec) stale = true;
    }
    // Never leave the second line empty. A stale upcoming-game label is still
    // the right game, so show it dimmed; a stale live/final score is replaced
    // by "Updating..." (it must not look current).
    if (!k.length()) {
      String nd = g_settings.teamNextDay[i];
      k = nd.length() ? nd : String("No game sched");
    }
    if (stale) {
      bool score = (hl == "live" || hl == "recent");
      textAt(fitWords(score ? String("Updating...") : k, maxC), tx, y + 14, faint());
      return;
    }
    uint16_t c = muted();
    int x = tx;
    if (hl == "live") {
      dma_->fillRect(tx, y + 15, 3, 3, softRed());   // small "on air" dot
      x += 6;
      c = softWhite();
    } else if (hl == "today") c = softAmber();
    else if (hl == "recent") c = k.startsWith("W") ? softGreen() : muted();
    textAt(fitWords(k, maxC - (x - tx) / 6), x, y + 14, c);
  }

  void drawTeams() {
    int total = teamCount();
    if (total == 0) return;
    int pages = (total + TEAMS_PER_PAGE - 1) / TEAMS_PER_PAGE;
    int page = cur_.idx;
    if (page < 0 || page >= pages) page = 0;
    int idxs[TEAMS_PER_PAGE], cnt = 0, seen = 0;
    for (int i = 0; i < 8 && cnt < TEAMS_PER_PAGE; i++) {
      if (!g_settings.teams[i].length()) continue;
      if (seen++ < page * TEAMS_PER_PAGE) continue;
      idxs[cnt++] = i;
    }
    if (cnt == 1) { drawTeamRow(idxs[0], 20); }
    else {
      drawTeamRow(idxs[0], 4);
      dma_->drawFastHLine(32, 32, width_ - 36, faint());
      drawTeamRow(idxs[1], 36);
    }
    // Vertical page dots at the right edge.
    if (pages > 1)
      for (int k = 0; k < pages; k++)
        dma_->fillRect(width_ - 3, 32 - pages * 2 + k * 4, 2, 2, k == page ? muted() : faint());
  }

  // Two shows per page, calm palette, long titles scroll instead of clipping:
  //        Ted Lasso              <- muted blue
  //    New episode Oct 7          <- gray (amber when it's new/today)
  //      ------------
  //     Emily in Paris
  //    Returns Dec 24
  //          . .                  <- page dots
  void drawShows() {
    int total = showCount();
    if (total == 0) return;
    int pages = (total + SHOWS_PER_PAGE - 1) / SHOWS_PER_PAGE;
    int page = cur_.idx;
    if (page < 0 || page >= pages) page = 0;
    int idxs[SHOWS_PER_PAGE], cnt = 0, seen = 0;
    for (int i = 0; i < 8 && cnt < SHOWS_PER_PAGE; i++) {
      if (!g_settings.shows[i].length()) continue;
      if (seen++ < page * SHOWS_PER_PAGE) continue;
      idxs[cnt++] = i;
    }
    if (cnt == 0) return;
    const int ys[2] = {6, 36};
    for (int k = 0; k < cnt; k++) {
      int i = idxs[k];
      int y = cnt == 1 ? 21 : ys[k];
      marquee(g_settings.shows[i], y, titleBlue());
      String lbl = g_settings.showLabel[i];
      if (!lbl.length()) lbl = "--";
      bool fresh = lbl.startsWith("New") || lbl.startsWith("Today") ||
                   lbl.indexOf("tonight") >= 0;
      centerText(fitWords(lbl, width_ / 6), y + 11, fresh ? softAmber() : muted());
    }
    if (cnt == 2) dma_->drawFastHLine(40, 30, width_ - 80, faint());
    pageDots(page, pages, width_ / 2, 60);
  }

  // Optional Markets page:
  //  MARKETS                    o OPEN
  //  S&P 500  +0.68%      /\_/\_ <- intraday sparkline (fills through the day)
  //  7,718.37                       dotted line = previous close
  //  Dow ...  / Nasdaq ...
  static String commas(float v) {
    char b[24];
    snprintf(b, sizeof(b), "%.2f", v);
    String s = b;
    int dot = s.indexOf('.');
    for (int i = dot - 3; i > 0; i -= 3) s = s.substring(0, i) + "," + s.substring(i);
    return s;
  }

  void drawMarkets() {
    const String &st = g_settings.marketStatus;
    bool open = st == "Open";
    textAt("MARKETS", 2, 1, muted());
    String stU = st;
    stU.toUpperCase();
    int sx = width_ - 2 - textW(stU);
    textAt(stU, sx, 1, open ? softGreen() : muted());
    dma_->fillRect(sx - 5, 3, 3, 3, open ? softGreen() : faint());
    for (int k = 0; k < g_settings.marketCount && k < 3; k++) {
      const MarketInfo &m = g_settings.markets[k];
      int y = 11 + k * 18;
      bool up = m.pct >= 0;
      uint16_t c = !m.hasPct ? muted() : (up ? softGreen() : softRed());
      textAt(m.name, 2, y, softWhite());
      if (m.hasPct) {
        char p[12];
        snprintf(p, sizeof(p), "%+.2f%%", m.pct);
        textAt(p, 52, y, c);
      }
      textAt(commas(m.value), 2, y + 9, muted());
      // Sparkline box: x 93..126 (34 cols), y+1 .. y+14
      int bx = 93, by = y + 1, bh = 14;
      if (m.base >= 0)
        for (int x = 0; x < 34; x += 2) dma_->drawPixel(bx + x, by + bh - 1 - m.base, faint());
      int px = -1, py = -1;
      for (int i = 0; i < m.sparkLen; i++) {
        if (m.spark[i] < 0) continue;
        int x = bx + i, yy = by + bh - 1 - m.spark[i];
        if (px >= 0) dma_->drawLine(px, py, x, yy, c);
        else dma_->drawPixel(x, yy, c);
        px = x; py = yy;
      }
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

  // Live / just-final games, same row style as the Teams page (max 2).
  void drawScores() {
    int idxs[2], cnt = 0;
    for (int i = 0; i < 8 && cnt < 2; i++)
      if (g_settings.teams[i].length() &&
          (g_settings.teamHL[i] == "live" || g_settings.teamHL[i] == "recent"))
        idxs[cnt++] = i;
    if (cnt == 0) return;
    if (cnt == 1) { drawTeamRow(idxs[0], 20); return; }
    drawTeamRow(idxs[0], 4);
    dma_->drawFastHLine(32, 32, width_ - 36, faint());
    drawTeamRow(idxs[1], 36);
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
