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

#include <math.h>
#include <Arduino.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <time.h>
#include "BLEController.h"
#include "MarketHours.h"
#include "Logos.h"
#include "DogSprite.h"
#include "SkyDraw.h"
#include "DailyDraw.h"
#include "BigClockFont.h"
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
    // Panel timing comes from build flags so Mom's env can differ from main
    // builds (see platformio.ini). Defaults = library defaults (8 MHz req,
    // latch_blanking 4, 60 Hz min) as used by the main walls through 1.1.21.
#ifndef PANEL_CLKPHASE
#define PANEL_CLKPHASE 0
#endif
#ifndef PANEL_I2S_HZ
#define PANEL_I2S_HZ 8000000
#endif
#ifndef PANEL_LATCH_BLANK
#define PANEL_LATCH_BLANK 4
#endif
#ifndef PANEL_MIN_REFRESH
#define PANEL_MIN_REFRESH 60
#endif
    mxconfig.clkphase = PANEL_CLKPHASE ? true : false;
    // Library defaults we leave explicit so scanline tearing is easier to reason
    // about: single DMA buffer (writing while the panel is scanning tears),
    // 8 MHz I2S, min_refresh_rate 60 Hz, 8-bit color. Double-buffering would
    // hide tears but costs a second internal-SRAM framebuffer (~Aura left it
    // off for Wi-Fi/BLE heap). We avoid tearing by not clear+redrawing every
    // loop tick — see tick().
    mxconfig.double_buff = false;
    // 1.2.9: slower, cleaner HUB75 clock. On the S3 the library's "8 MHz"
    // really outputs 10 MHz (160/16); Mom's panel showed a 1-px green fringe
    // beside red strokes (data/clock skew). S3_LCD_DIV_NUM=32 (platformio.ini)
    // gives 5 MHz; i2sspeed is set to match so the refresh maths is right.
    mxconfig.i2sspeed = (HUB75_I2S_CFG::clk_speed)PANEL_I2S_HZ;  // 1.2.14 mom: 8 MHz (div 20)
    // Longer OE blank around each latch (max 8) against row ghosting /
    // top-row blink. clkphase stays false: it shows the image unshifted on
    // this panel; flip only if a whole-column shift ever appears.
    mxconfig.latch_blanking = PANEL_LATCH_BLANK;  // 1.2.14 mom: 4 (8 starved green rows?)
    // 1.2.8: 120 Hz (was 60 -> ~82 Hz actual at 8-bit/8 MHz). Mixed-level
    // colours (amber/orange) blink on some panels at the lower rate.
    mxconfig.min_refresh_rate = PANEL_MIN_REFRESH;   // mom 100: ~130 Hz at 8 MHz (transition bit 4)

    dma_ = new MatrixPanel_I2S_DMA(mxconfig);
    dma_->begin();
    dma_->setBrightness8(map(g_settings.brightness, 0, 100, 0, 255));
    dma_->clearScreen();
    // Never wrap text onto the next row: an over-long line used to spill its
    // tail onto the line below (the stray "mi" under the flight card). Long
    // strings are now fitted/truncated or scrolled explicitly instead.
    dma_->setTextWrap(false);
    gfx_ = dma_;
    ensureCanvas();
    // 1.2.5: boot card so the running version can be read off the wall.
    // "C" = vertical centering active (simple mode + offscreen canvas OK).
    if (g_settings.simpleMode) {
      message("MOM'S WALL", String("v" INFOWALL_FW_VERSION INFOWALL_FW_TAG) + (canvas_ ? " C" : " -"));
      delay(2500);
      dma_->clearScreen();
    }
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
    // Daily slides with a long body show it in 2-3 parts, one hold each.
    if (cur_.m == M_WORD && dailyPages(M_WORD) > 1) hold = wordDefMs() + WORD_ORIGIN_MS;
    else if (isDaily(cur_.m)) hold *= dailyPages(cur_.m);

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

    checkIssPass();
    // 1.2.6: a multi-page daily slide (word: definition then origin) is not
    // cut short by a plane; the plane waits until the slide has finished.
    bool protect = isDaily(cur_.m) && dailyPages(cur_.m) > 1;
    bool cutIn = !dogActive_ && (queueLen_ > 0 || vipPending_ || issPending_) && !g_settings.isPinned &&
                 ((!cur_.interrupt && !protect) || now - lastSwitch_ >= (unsigned long)hold);
    bool switchDue = !fading_ && !dogActive_ && (cutIn || (!g_settings.isPinned &&
                               now - lastSwitch_ >= (unsigned long)hold));
    if (switchDue && g_settings.simpleMode) {
      // 1.2.3 Mom Wall: switch pages instantly. The fade-out/fade-in ramp
      // (~0.5 s dark each way at the default speed, up to ~1.8 s) read as a
      // black screen between every slide.
      if (!advance()) { hasPage_ = false; dma_->clearScreen(); return; }
      lastSwitch_ = frameStart_ = now;
      bufferValid_ = false;              // draw the new page this frame
      switchDue = false;
    }
    if (switchDue) {
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
      renderPage();
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
        renderPage();
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
      for (int i = 0; i < MAX_SHOWS && onPage < SHOWS_PER_PAGE; i++) {
        if (!showVisible(i)) continue;
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
      case M_FORECAST:
        for (int i = 0; i < g_settings.fcN; i++) {
          h = mixStr(h, g_settings.fcDay[i]);
          h = mix(h, g_settings.fcIcon[i]);
          h = mix(h, (uint32_t)(uint16_t)g_settings.fcHi[i]);
          h = mix(h, (uint32_t)(uint16_t)g_settings.fcLo[i]);
        }
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
        if (i >= 0 && i < MAX_SHOWS) {
          h = mixStr(h, g_settings.shows[i]);
          h = mixStr(h, g_settings.showLabel[i]);
        }
        break;
      }
      case M_MOON:
        h = mix(h, (uint32_t)g_settings.moonIl);
        h = mixStr(h, g_settings.sunRise);
        h = mixStr(h, g_settings.sunSet);
        h = mixStr(h, g_settings.moonRise);
        break;
      case M_ISS:
        h = mix(h, issOverhead() ? 1u : 0u);
        h = mix(h, g_settings.issNvR);
        h = mix(h, (uint32_t)g_settings.issMi);
        break;
      case M_MAP:
        h = mix(h, (uint32_t)(time(nullptr) / 60));   // terminator + clock move each minute
        break;
      case M_CLOCK:
        h = mix(h, (uint32_t)(time(nullptr) / 60));   // digits change each minute
        h = mix(h, (uint32_t)g_settings.clockColor);
        h = mix(h, g_settings.clock24 ? 1u : 0u);
        break;
      case M_BORN: case M_WORD: case M_ORIGIN: case M_CFACT:
      case M_CTODAY: case M_MATH: case M_FAMILY:
        h = mixStr(h, g_settings.dyDate);
        h = mixStr(h, g_settings.dyFam);
        h = mixStr(h, g_settings.dyFamFrom);
        h = mixStr(h, g_settings.dyBorn);
        h = mix(h, (uint32_t)dailySub(cur_.m));
        break;
      case M_VIP:
        if (g_settings.vipN > 0) {
          h = mixStr(h, g_settings.vip[0].hex);
          h = mix(h, (uint32_t)(g_settings.vip[0].dist * 10));
          h = mix(h, (uint32_t)g_settings.vip[0].alt);
        }
        break;
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

  // New /api/device/vip result: alert for an aircraft not alerted in the
  // last 5 minutes (so one still in range re-alerts every 5 min).
  void noteVip() {
    if (cur_.m == M_VIP) bufferValid_ = false;
    if (!g_settings.vipAlert) return;
    unsigned long now = millis();
    for (int i = 0; i < g_settings.vipN; i++) {
      const String &hx = g_settings.vip[i].hex;
      int slot = -1, oldest = 0;
      for (int j = 0; j < 4; j++) {
        if (vipHex_[j] == hx) slot = j;
        if (vipAt_[j] < vipAt_[oldest]) oldest = j;
      }
      if (slot >= 0 && now - vipAt_[slot] < 300000UL) continue;
      if (slot < 0) slot = oldest;
      vipHex_[slot] = hx; vipAt_[slot] = now | 1;
      vipPending_ = true;
    }
  }

  // New /api/device/daily content: redraw the current page.
  void invalidate() { bufferValid_ = false; }

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
  void scoreFlash(const String &abbr, uint8_t r, uint8_t g, uint8_t b,
                  const char *msg = "SCORE!") {
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
      centerText(msg, height_ / 2 + 4, fg, 2);
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
                M_TV, M_STOCKS, M_COUNTDOWN, M_REMINDERS, M_LKN, M_FOLLY, M_FORECAST,
                M_MOON, M_ISS, M_MAP, M_VIP, M_CLOCK,
                // 1.2.0 simple mode (Mom Wall) daily slides
                M_BORN, M_WORD, M_ORIGIN, M_CFACT, M_CTODAY, M_MATH, M_FAMILY };

  MatrixPanel_I2S_DMA *dma_ = nullptr;
  // 1.2.4: every page draws through gfx_. Normally gfx_ == dma_; in simple
  // mode (Mom Wall) pages draw into canvas_ first, then renderPage() blits
  // them vertically centered on the panel.
  Adafruit_GFX *gfx_ = nullptr;
  GFXcanvas16 *canvas_ = nullptr;

  // Draw the current page. Simple mode: offscreen, find the rows that have
  // anything lit, shift so that block sits in the middle of the 64 rows, and
  // write every pixel (black included) so no clearScreen flash is needed.
  bool ensureCanvas() {
    if (canvas_) return true;
    canvas_ = new GFXcanvas16(PANEL_RES_X * PANEL_CHAIN, PANEL_RES_Y);
    if (canvas_ && !canvas_->getBuffer()) { delete canvas_; canvas_ = nullptr; }
    if (canvas_) canvas_->setTextWrap(false);
    return canvas_ != nullptr;
  }
 public:
  bool centering() { return g_settings.simpleMode && canvas_; }
 private:
  void renderPage() {
    if (!g_settings.simpleMode || !ensureCanvas()) {
      dma_->clearScreen();
      drawModule(cur_.m);
      return;
    }
    canvas_->fillScreen(0);
    gfx_ = canvas_;
    drawModule(cur_.m);
    gfx_ = dma_;
    const uint16_t *b = canvas_->getBuffer();
    int top = -1, bot = -1;
    for (int y = 0; y < height_; y++) {
      const uint16_t *r = b + y * width_;
      int xe = (y == 62 && isDaily(cur_.m)) ? 112 : width_;   // sub-page dots stay put
      for (int x = 0; x < xe; x++) if (r[x]) { if (top < 0) top = y; bot = y; break; }
    }
    // 1.2.13: a block as tall as the panel (or taller) is top-aligned, never centered.
    int dy = top < 0 ? 0 : (bot - top + 1 >= height_ - 1) ? 0 : (height_ - (bot - top + 1)) / 2 - top;
    for (int y = 0; y < height_; y++) {
      int sy = y - dy;
      const uint16_t *r = (sy >= 0 && sy < height_) ? b + sy * width_ : nullptr;
      for (int x = 0; x < width_; x++) dma_->drawPixel(x, y, r ? steady565(r[x]) : 0);
    }
    if (isDaily(cur_.m) && dy)
      for (int x = 112; x < width_; x++) dma_->drawPixel(x, 62, b[62 * width_ + x]);
  }
  // 1.2.8 Mom Wall "steady colours": amber/orange/yellow and red text are
  // snapped to fully-on channels (yellow 255,255,0 / red 255,0,0). A channel
  // at 0 or 255 is never pulse-width modulated, so it cannot blink.
  // 1.2.10 default "soft red" (200,0,0): one LED channel only (no R+G/R+B
  // mix, so no coloured fringes) and less harsh than full 255 red.
  static constexpr uint16_t kWarm565 = ((200 >> 3) << 11);
  static uint16_t steady565(uint16_t c) {
    if (!c) return c;
    int r = ((c >> 11) & 31) * 255 / 31, g = ((c >> 5) & 63) * 255 / 63, b = (c & 31) * 255 / 31;
    // 1.2.10: yellow (R+G) still showed red strokes with green only on the
    // right edge (big temp, lake TGT): this panel can't hold R and G together
    // cleanly. Single-channel red renders clean, so warm colours -> pure red.
    if (c == 0xFFE0) return c;   // 1.2.12: deliberate full yellow (temp, suns) passes through
    if (c == 0xFDE0) return c;   // 1.2.17: deliberate amber 255,190,0 (world-map clock) passes through
    if (r >= 195 && b < 100 && g >= 90) return kWarm565;   // amber/gold/orange -> soft red
    if (r >= 195 && b < 100 && g < 90)  return kWarm565;  // warm red -> soft red
    return c;
  }
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

  int simpleModules(Module *out) {
    // Mom Wall order: alternate a "glance" page with a reading page.
    int n = 0;
    bool clk = time(nullptr) > 1600000000;
    if (g_settings.showWeather) out[n++] = M_WEATHER;
    if (g_settings.smWord && g_settings.dyWord.length()) out[n++] = M_WORD;   // origin is its 2nd page (1.2.3)
    if (g_settings.showWeather && g_settings.showForecast && g_settings.fcN > 0) out[n++] = M_FORECAST;
    if (g_settings.smBorn && g_settings.dyBorn.length()) out[n++] = M_BORN;
    if (g_settings.showMoon && g_settings.moonIl >= 0) out[n++] = M_MOON;
    if (g_settings.smCFact && g_settings.dyCFact.length()) out[n++] = M_CFACT;
    if (g_settings.showMap && clk) out[n++] = M_MAP;
    if (g_settings.smCToday && g_settings.dyCToday.length()) out[n++] = M_CTODAY;
    if (g_settings.showBigClock && clk) out[n++] = M_CLOCK;
    if (g_settings.smMath && g_settings.dyMathText.length()) out[n++] = M_MATH;
    if (g_settings.smFamily && g_settings.dyFam.length()) out[n++] = M_FAMILY;
    if (g_settings.smLake && g_settings.lakeLvl.length()) out[n++] = M_LKN;   // 1.2.4
    return n;
  }
  int infoModules(Module *out) {
    if (g_settings.simpleMode) return simpleModules(out);
    int n = 0;
    if (g_settings.showCustomMessage && msgHasText()) out[n++] = M_MESSAGE;
    if (g_settings.trackFlight && g_settings.flightIdent.length()) out[n++] = M_FLIGHT;
    if (g_settings.showWeather) out[n++] = M_WEATHER;
    if (g_settings.showWeather && g_settings.showForecast && g_settings.fcN > 0) out[n++] = M_FORECAST;
    if (anyStock()) out[n++] = M_STOCKS;
    if (g_settings.showMarkets && g_settings.marketCount > 0 && !marketsClosedNow()) out[n++] = M_MARKETS;
    if (g_settings.showCountdown && g_settings.countdownLabel.length()) out[n++] = M_COUNTDOWN;
    if (anyReminder()) out[n++] = M_REMINDERS;
    if (g_settings.showLKN)   out[n++] = M_LKN;
    if (g_settings.showFolly) out[n++] = M_FOLLY;
    if (g_settings.showWeather && g_settings.showMoon && g_settings.moonIl >= 0) out[n++] = M_MOON;
    if (g_settings.showIss && g_settings.issOk) out[n++] = M_ISS;
    if (g_settings.showMap && time(nullptr) > 1600000000) out[n++] = M_MAP;
    if (g_settings.showBigClock && time(nullptr) > 1600000000) out[n++] = M_CLOCK;
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
    Module tmp[20];
    switch (c) {
      case C_INFO:   return infoModules(tmp);
      case C_TEAMS:  { if (g_settings.simpleMode) return 0;
                       int l = liveCount(); return l ? l : teamCount(); }  // live only while any is live
      case C_SHOWS:  return g_settings.simpleMode ? 0 : showPages();  // 1.2.1: no TV on Mom Wall
      case C_PLANES: return (g_settings.simpleMode && !g_settings.smPlanes) ? 0 : g_settings.planeCount;
      default:       return 0;
    }
  }
  Page pageFor(Cat c, int k) {
    Page p;
    if (c == C_INFO) { Module tmp[20]; infoModules(tmp); p.m = tmp[k]; }
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
    Module tmp[20];
    int n;
    switch (p.m) {
      case M_PLANES: return planeSlot(p.plane) >= 0;
      case M_SPORTS: return p.idx < teamCount();
      case M_SCORES: return anyScore();
      case M_TV:     return p.idx < showPages();
      case M_VIP:    return g_settings.vipAlert && g_settings.vipN > 0;
      default:
        n = infoModules(tmp);
        for (int i = 0; i < n; i++) if (tmp[i] == p.m) return true;
        return false;
    }
  }
  // Pick the next page: a queued new plane first, else the next category turn.
  bool advance() {
    // VIP aircraft (Air Force One etc.) and a visible ISS pass starting cut in
    // ahead of everything; they never join the normal rotation.
    if (!g_settings.isPinned && vipPending_) {
      vipPending_ = false;
      if (g_settings.vipAlert && g_settings.vipN > 0 && !g_settings.simpleMode) {
        cur_ = Page(); cur_.m = M_VIP; cur_.interrupt = true; return true;
      }
    }
    if (!g_settings.isPinned && issPending_) {
      issPending_ = false;
      if (g_settings.showIss && issOverhead() && !g_settings.simpleMode) {
        cur_ = Page(); cur_.m = M_ISS; cur_.interrupt = true; return true;
      }
    }
    while (queueLen_ > 0 && !g_settings.isPinned) {
      String cs = queue_[0];
      for (int i = 1; i < queueLen_; i++) queue_[i - 1] = queue_[i];
      queueLen_--;
      if (planeSlot(cs) < 0) continue;   // already gone
      if (g_settings.simpleMode && !g_settings.smPlanes) continue;
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

  // ---- Sky pages (1.1.17) ------------------------------------------------------
  bool vipPending_ = false, issPending_ = false;
  String vipHex_[4];
  unsigned long vipAt_[4] = {0, 0, 0, 0};
  uint32_t issAlerted_ = 0;   // rise epoch of the last pass that cut in
  bool issOverhead() {
    uint32_t t = (uint32_t)time(nullptr);
    return t > 1600000000 && g_settings.issPR && t >= g_settings.issPR && t <= g_settings.issPE;
  }
  // A VISIBLE pass (dark sky, sunlit station) just started: cut in once.
  void checkIssPass() {
    if (!g_settings.showIss || !issOverhead()) return;
    if (g_settings.issPR != g_settings.issNvR || issAlerted_ == g_settings.issPR) return;
    issAlerted_ = g_settings.issPR;
    issPending_ = true;
  }
  struct GfxAdapter {
    Adafruit_GFX *d;
    void px(int x, int y, uint8_t r, uint8_t g, uint8_t b) { d->drawPixel(x, y, MatrixPanel_I2S_DMA::color565(r, g, b)); }
    void text(const char *s, int x, int y, uint8_t r, uint8_t g, uint8_t b) {
      d->setFont(nullptr); d->setTextSize(1); d->setTextColor(MatrixPanel_I2S_DMA::color565(r, g, b));
      d->setCursor(x, y); d->print(s);
    }
  };
  // ---- Daily slides (1.2.0 simple mode) ------------------------------------
  static bool isDaily(Module m) { return m >= M_BORN && m <= M_FAMILY; }
  static int dyWhich(Module m) {
    switch (m) {
      case M_BORN: return DY_BORN;     case M_WORD: return DY_WORD;   case M_ORIGIN: return DY_ORIGIN;
      case M_CFACT: return DY_CFACT;   case M_CTODAY: return DY_CTODAY;
      case M_MATH: return DY_MATH;     default: return DY_FAMILY;
    }
  }
  DyData dyData() {
    int age = 0;
    struct tm t;
    if (getLocalTime(&t, 0) && g_settings.dyBornYear > 0) age = t.tm_year + 1900 - g_settings.dyBornYear;
    return DyData{g_settings.dyWord.c_str(), g_settings.dyPron.c_str(), g_settings.dyPos.c_str(),
                  g_settings.dyDef.c_str(), g_settings.dyOrigin.c_str(), g_settings.dyEx.c_str(),
                  g_settings.dyBorn.c_str(), g_settings.dyBornDesc.c_str(), g_settings.dyBornYear, age,
                  g_settings.dyCFact.c_str(), g_settings.dyCToday.c_str(), g_settings.dyCDesc.c_str(),
                  g_settings.dyCKind.c_str(), g_settings.dyCTYear,
                  g_settings.dyMathBig.c_str(), g_settings.dyMathText.c_str(),
                  g_settings.dyFam.c_str(), g_settings.dyFamFrom.c_str()};
  }
  int dailyPages(Module m) { DyData d = dyData(); int n = dyPages(dyWhich(m), d); return n > 3 ? 3 : n; }
  // Word slide (1.2.3): the definition page dwells longest (>= 10 s), then the
  // origin page follows briefly. Always definition first.
  static const unsigned long WORD_ORIGIN_MS = 6000;
  unsigned long wordDefMs() { return 10000UL; }   // 1.2.6: fixed 10 s, then origin 6 s
  int dailySub(Module m) {
    int n = dailyPages(m);
    if (n <= 1) return 0;
    if (m == M_WORD) return (millis() - frameStart_) < wordDefMs() ? 0 : 1;
    unsigned long per = (unsigned long)max(2000, g_settings.holdDurationMs);
    int k = (int)((millis() - frameStart_) / per);
    return k >= n ? n - 1 : k;
  }
  struct PxAdapter {
    Adafruit_GFX *d;
    void px(int x, int y, uint8_t r, uint8_t g, uint8_t b) { d->drawPixel(x, y, MatrixPanel_I2S_DMA::color565(r, g, b)); }
  };
  void drawDaily(Module m) {
    PxAdapter a{gfx_};
    DyData d = dyData();
    dyDraw(a, dyWhich(m), d, dailySub(m));
  }

  void drawMoon() {
    GfxAdapter a{gfx_};
    String mr = g_settings.moonRise;
    if (mr.length() && g_settings.moonRiseTmw) mr = "";   // only tonight's moonrise
    SkyMoon m{g_settings.moonIl, g_settings.moonWax, g_settings.moonPh.c_str(),
              g_settings.sunRise.c_str(), g_settings.sunSet.c_str(), mr.c_str()};
    skyDrawMoon(a, m);
  }
  void drawIss() {
    GfxAdapter a{gfx_};
    SkyIss s{issOverhead(), g_settings.issMi, g_settings.issNvDay.c_str(), g_settings.issNvTime.c_str(),
             g_settings.issNvFr.c_str(), g_settings.issNvTo.c_str(), g_settings.issNvEl, g_settings.issNvMin,
             g_settings.issPFr.c_str(), g_settings.issPTo.c_str(), g_settings.issPEl};
    skyDrawIss(a, s);
  }
  void drawVip() {
    if (g_settings.vipN <= 0) return;
    GfxAdapter a{gfx_};
    const VipInfo &v = g_settings.vip[0];
    String l2 = (v.key == "SAM" || v.key == "EXEC" || v.key == "VENUS") ? v.cs + " " + v.type
                                                                       : v.type + " " + v.reg;
    l2.trim();
    bool red = v.key == "AF1" || v.key == "AF2" || v.key == "VC25";
    SkyVip s{v.label.c_str(), l2.c_str(), v.dir.c_str(), v.dist, v.alt, v.vr, v.hdg, v.spd, red};
    skyDrawVip(a, s);
  }
  // Big clock (1.1.20): 20x34 digits from BigClockFont.h, small AM/PM top-right,
  // date ("FRI OCT 23") underneath in a dimmer shade. Layout mirrors
  // /workspace/bigclock/font.py so the preview PNG is pixel-exact.
  void drawBigClock() {
    struct tm t;
    if (!getLocalTime(&t, 0)) return;
    const uint8_t *c = BIGCLK_COLORS[g_settings.clockColor % BIGCLK_NCOLORS];
    uint16_t fg = dma_->color565(c[0], c[1], c[2]);
    uint16_t dim = dma_->color565(c[0] * 42 / 100, c[1] * 42 / 100, c[2] * 42 / 100);
    char txt[8], ap[3] = "";
    if (g_settings.clock24) snprintf(txt, sizeof(txt), "%02d:%02d", t.tm_hour, t.tm_min);
    else {
      int h = t.tm_hour % 12; if (!h) h = 12;
      snprintf(txt, sizeof(txt), "%d:%02d", h, t.tm_min);
      strcpy(ap, t.tm_hour < 12 ? "AM" : "PM");
    }
    const int GAP = 3, COLW = 4, TOP = 5, DATE_Y = 47;
    int n = strlen(txt), w = GAP * (n - 1);
    for (int i = 0; i < n; i++) w += txt[i] == ':' ? COLW : BIGCLK_W;
    int total = w + (ap[0] ? GAP + 11 : 0);
    int x = (width_ - total) / 2;
    for (int i = 0; i < n; i++) {
      if (txt[i] == ':') {
        gfx_->fillRect(x, TOP + 9, COLW, 4, fg);
        gfx_->fillRect(x, TOP + 21, COLW, 4, fg);
        x += COLW + GAP;
        continue;
      }
      const uint32_t *g = BIGCLK_FONT[txt[i] - '0'];
      for (int y = 0; y < BIGCLK_H; y++) {
        uint32_t row = pgm_read_dword(&g[y]);
        for (int b = 0; b < BIGCLK_W; b++)
          if (row & (1UL << (BIGCLK_W - 1 - b))) gfx_->drawPixel(x + b, TOP + y, fg);
      }
      x += BIGCLK_W + GAP;
    }
    if (ap[0]) {
      gfx_->setTextSize(1);
      gfx_->setTextColor(fg);
      gfx_->setCursor(x, TOP);
      gfx_->print(ap);
    }
    static const char *WD[] = {"SUN","MON","TUE","WED","THU","FRI","SAT"};
    static const char *MO[] = {"JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"};
    char date[16];
    snprintf(date, sizeof(date), "%s %s %d", WD[t.tm_wday], MO[t.tm_mon], t.tm_mday);
    centerText(date, DATE_Y, dim);
  }

  void drawMap() {
    GfxAdapter a{gfx_};
    char clk[10] = "";
    struct tm t;
    if (getLocalTime(&t, 0)) {
      int h = t.tm_hour % 12; if (!h) h = 12;
      snprintf(clk, sizeof(clk), "%d:%02d%s", h, t.tm_min, t.tm_hour < 12 ? "AM" : "PM");
    }
    float la = g_settings.lat, lo = g_settings.lon;
    if (la == 0 && lo == 0) { la = 35.58f; lo = -80.81f; }   // Mooresville until set
    skyDrawMap(a, time(nullptr), la, lo, clk, g_settings.simpleMode);
  }

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
        if (idx) gfx_->drawPixel(X, y0 + r, pgm_read_word(&DOG_PAL[idx]));
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
    gfx_->setFont(&FreeMono9pt7b);
    gfx_->setTextSize(1);
    gfx_->getTextBounds(t.c_str(), 0, baseline, &x1, &y1, &tw, &th);
    gfx_->setCursor(left + (w - (int)tw) / 2 - x1, baseline);
    gfx_->setTextColor(c);
    gfx_->print(t);
    gfx_->setFont(nullptr);
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
      gfx_->drawFastHLine(32, 30, width_ - 36, faint());
      monoCenter(hm + " " + String(hs), 42, hs >= as ? softWhite() : muted(), L, Wd);
      if (hr.length()) centerIn(hr, 45, muted(), L, Wd);
      String st = g_settings.teamStatus[i];
      if (hl == "live") {
        if (!st.length()) st = "LIVE";
        st = fitWords(st, (width_ - 8) / 6);
        int w = st.length() * 6 + 6, x = (width_ - w) / 2;
        gfx_->fillRect(x, 58, 3, 3, softRed());
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
    gfx_->drawFastHLine(4, 40, width_ - 8, faint());
    centerText(g_settings.teamNextDay[i], 44, hl == "today" ? softAmber() : muted());
    if (g_settings.teamNextTime[i].length()) monoCenter(g_settings.teamNextTime[i], 62, softAmber());
  }

  bool msgHasText() {
    return g_settings.msgLine1.length() || g_settings.msgLine2.length() ||
           g_settings.msgLine3.length();
  }
  bool anyTeam()  { for (int i=0;i<8;i++) if (g_settings.teams[i].length())  return true; return false; }
  // A show appears on the wall only when it has a real return/air date.
  // "Between seasons", ended shows and not-yet-known labels stay hidden (the
  // app keeps the full list).
  bool showVisible(int i) {
    if (!g_settings.shows[i].length()) return false;
    const String &l = g_settings.showLabel[i];
    if (!l.length() || l == "--") return false;
    if (l.startsWith("Between") || l.startsWith("Series ended") || l.startsWith("Ended") ||
        l.startsWith("Cancel") || l.startsWith("No ") || l.startsWith("Unknown"))
      return false;
    return true;
  }
  bool anyShow()  { for (int i=0;i<MAX_SHOWS;i++) if (showVisible(i)) return true; return false; }
  int  teamCount(){ int n=0; for (int i=0;i<8;i++) if (g_settings.teams[i].length()) n++; return n; }
  int  showCount(){ int n=0; for (int i=0;i<MAX_SHOWS;i++) if (showVisible(i)) n++; return n; }
  // Weekend rule (US Eastern; the RTC is set via NTP/HTTP/phone with the
  // Eastern TZ). Unknown clock => false, so nothing is hidden by mistake.
  bool marketsClosedNow() {
    struct tm t;
    if (!getLocalTime(&t, 0)) return false;
    return marketsClosedDay(t.tm_wday);
  }
  // A followed ticker gets a row/slide unless markets are closed and it is not
  // a 24/7 (crypto) symbol.
  bool stockShown(int i) {
    if (!g_settings.stocks[i].length()) return false;
    return !marketsClosedNow() || tradesOnWeekends(g_settings.stocks[i].c_str());
  }
  bool anyStock() { for (int i=0;i<8;i++) if (stockShown(i)) return true; return false; }
  bool anyScore() { for (int i=0;i<8;i++) if (g_settings.teams[i].length() && (g_settings.teamHL[i]=="live"||g_settings.teamHL[i]=="recent")) return true; return false; }
  bool anyReminder() { for (int i=0;i<4;i++) if (g_settings.reminders[i].length()) return true; return false; }

  // Center a size-1 GFX string (6px per char) horizontally at row y.
  void centerText(const String &s, int y, uint16_t color, uint8_t size = 1) {
    gfx_->setTextSize(size);
    gfx_->setTextColor(color);
    int w = s.length() * 6 * size;
    int x = (width_ - w) / 2;
    if (x < 0) x = 0;
    gfx_->setCursor(x, y);
    gfx_->print(s);
  }

  void drawModule(Module m) {
    switch (m) {
      case M_MESSAGE:   drawMessage();   break;
      case M_FLIGHT:    drawFlight();    break;
      case M_PLANES:    drawPlanes();    break;
      case M_WEATHER:   drawWeather();   break;
      case M_FORECAST:  drawForecast();  break;
      case M_SPORTS:    drawTeamPage(teamSlotAt(cur_.idx)); break;
      case M_SCORES:    drawScores();    break;
      case M_TV:        drawShows();     break;
      case M_STOCKS:    drawStocks();    break;
      case M_COUNTDOWN: drawCountdown(); break;
      case M_REMINDERS: drawReminders(); break;
      case M_LKN:       drawLake();  break;
      case M_FOLLY:     drawFolly(); break;
      case M_MARKETS:   drawMarkets(); break;
      case M_MOON:      drawMoon();    break;
      case M_ISS:       drawIss();     break;
      case M_MAP:       drawMap();     break;
      case M_VIP:       drawVip();     break;
      case M_CLOCK:     drawBigClock(); break;
      case M_BORN: case M_WORD: case M_ORIGIN: case M_CFACT:
      case M_CTODAY: case M_MATH: case M_FAMILY:
                        drawDaily(m); break;
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
      // 1.2.10: one solid colour for the whole line: pure green near target,
      // pure red otherwise (single LED channel = no mixed-colour fringes).
      centerText(t, 28, fabsf(d) <= 0.5f ? dma_->color565(0, 255, 0) : kWarm565);
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

  // Pinned flight: line1 ident + green check + airline, line2 route,
  // line3 live status. Verified via /api/device/flight.
  void drawFlight() {
    String fn = g_settings.flightOk == 1 && g_settings.flightNo.length() ? g_settings.flightNo : g_settings.flightIdent;
    fn.toUpperCase();
    bool eta = g_settings.flightOk == 1 && g_settings.flightAir && g_settings.flightDmi >= 0;
    char altb[24];
    {
      long a = g_settings.flightAlt;
      if (a >= 1000) snprintf(altb, sizeof(altb), "%ld,%03ld ft", a / 1000, a % 1000);
      else snprintf(altb, sizeof(altb), "%ld ft", a);
    }
    // With an ETA, altitude moves up to the header line.
    centerText(eta ? String(altb) : String("FLIGHT"), 2, dim());
    if (g_settings.flightOk == 1) {
      String al = g_settings.flightAl;
      if (al.length() > 10) al = al.substring(0, 10);
      int w = textW(fn) + 3 + 7 + 3 + textW(al);
      int x = (128 - w) / 2;
      textAt(fn, x, 16, white());
      int cx = x + textW(fn) + 3;
      uint16_t g = green();
      gfx_->drawLine(cx, 19, cx + 2, 21, g);  gfx_->drawLine(cx, 20, cx + 2, 22, g);
      gfx_->drawLine(cx + 2, 21, cx + 6, 17, g); gfx_->drawLine(cx + 2, 22, cx + 6, 18, g);
      textAt(al, cx + 10, 16, cyan());
      if (g_settings.flightRoute.length()) centerText(g_settings.flightRoute, 30, amber(), 1);
      if (eta) {
        String l = String(g_settings.flightDmi) + "mi to " + g_settings.flightTo;
        if (g_settings.flightEta.length()) l += " " + g_settings.flightEta;  // <= 18 chars
        centerText(l, 46, green());
      } else if (g_settings.flightAir) {
        centerText(String("In flight ") + altb, 46, green());
      } else {
        centerText("Not airborne yet", 46, white());
      }
    } else if (g_settings.flightOk == 0) {
      centerText(fn, 16, white());
      centerText("Flight not found", 46, red());
    } else {
      centerText(fn, 16, white());
      centerText("Checking...", 46, dim());
    }
  }

  // ---- text helpers --------------------------------------------------------
  // Default GFX font: 6px advance, 7px glyphs (+1px spacing).
  static int textW(const String &t, uint8_t size = 1) { return t.length() * 6 * size; }

  void textAt(const String &t, int x, int y, uint16_t c, uint8_t size = 1) {
    gfx_->setTextSize(size);
    gfx_->setTextColor(c);
    gfx_->setCursor(x, y);
    gfx_->print(t);
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
      gfx_->fillRect(x, y, 2, 2, k == page ? muted() : faint());
  }

  void drawLogo(const LogoAsset *lg, int x, int y) {
    for (int r = 0; r < lg->h; r++)
      for (int c = 0; c < lg->w; c++) {
        uint16_t px = lg->data[r * lg->w + c];
        if (px) gfx_->drawPixel(x + c, y + r, px);  // black = transparent
      }
  }

  // 24x24 fallback badge when there is no bitmap: dim rounded tile + code.
  void drawBadge(const String &code, int x, int y, uint16_t edge) {
    gfx_->drawRoundRect(x, y, 24, 24, 4, edge);
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
      gfx_->fillRect(5, 15, 18, 3, c);                       // fuselage
      gfx_->fillTriangle(22, 15, 22, 17, 25, 16, c);         // nose
      gfx_->fillTriangle(17, 15, 13, 15, 9, 5, c);           // upper wing
      gfx_->fillTriangle(17, 15, 9, 5, 11, 5, c);
      gfx_->fillTriangle(17, 17, 13, 17, 9, 27, c);          // lower wing
      gfx_->fillTriangle(17, 17, 9, 27, 11, 27, c);
      gfx_->fillTriangle(8, 15, 5, 15, 3, 10, c);            // tail
      gfx_->fillTriangle(8, 17, 5, 17, 3, 22, c);
    }

    const int tx = 32, tw = width_ - tx - 2;           // 94px text column
    uint8_t sz = textW(ident, 2) <= tw ? 2 : 1;
    textAt(ident, tx, sz == 2 ? 4 : 8, softWhite(), sz);
    String sub = P.airline.length() ? P.airline
                                                  : P.type;
    textAt(fitWords(sub, tw / 6), tx, 21, muted());

    gfx_->drawFastHLine(3, 32, width_ - 6, faint());

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

  // 3-day forecast: three columns of day / 16x12 icon / hi (2x) / lo.
  //    Mon      Tue      Wed
  //    [sun]    [pc]     [rain]
  //    81deg    83deg    66deg  <- amber, 2x (degree mark 1x)
  //    57deg    56deg    58deg  <- cyan
  void drawForecast() {
    const int n = min((int)g_settings.fcN, 3);
    for (int k = 0; k < n; k++) {
      int cx = (width_ * (2 * k + 1)) / 6;
      const String &day = g_settings.fcDay[k];
      textAt(day, cx - (int)day.length() * 3, 3, titleBlue());
      const uint8_t *ic = WX_ICONS[g_settings.fcIcon[k] % WX_ICON_N];
      for (int r = 0; r < WX_ICON_H; r++)
        for (int c = 0; c < WX_ICON_W; c++) {
          uint8_t p = pgm_read_byte(&ic[r * WX_ICON_W + c]);
          if (p) gfx_->drawPixel(cx - 8 + c, 15 + r,
                                 dma_->color565(WX_ICON_PAL[p][0], WX_ICON_PAL[p][1], WX_ICON_PAL[p][2]));
        }
      char hi[8], lo[8];
      snprintf(hi, sizeof(hi), "%d", g_settings.fcHi[k]);
      int hw = strlen(hi) * 12;
      gfx_->setFont(nullptr);
      gfx_->setTextSize(2);
      gfx_->setTextColor(g_settings.simpleMode ? dma_->color565(255, 255, 0) : amber());   // 1.2.12 highs match temp (yellow)
      int x0 = cx - (hw + 7) / 2;          // number + gap + 1x degree mark, centered
      gfx_->setCursor(x0, 31);
      gfx_->print(hi);
      gfx_->setTextSize(1);
      gfx_->setCursor(x0 + hw + 1, 31);
      gfx_->print('\xF7');
      snprintf(lo, sizeof(lo), "%d\xF7", g_settings.fcLo[k]);
      textAt(lo, cx - (int)strlen(lo) * 3, 51, cyan());
    }
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
      // 1.2.10: Mom Wall hides the clock row until the time is known.
      if (haveClock || !g_settings.simpleMode) centerText(clk, 5, haveClock ? cyan() : dim());
      // Rest of the layout sits below the (always-present) clock row.
      int base = 17;
      char t[16];
      snprintf(t, sizeof(t), "%d\xF7", g_settings.wxTemp);  // temp
      centerText(t, base, g_settings.simpleMode ? dma_->color565(255, 255, 0) : amber(), 2);   // 1.2.16 full yellow again (1.2.15 white was interim)
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
      gfx_->fillRect(tx, y + 15, 3, 3, softRed());   // small "on air" dot
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
      gfx_->drawFastHLine(32, 32, width_ - 36, faint());
      drawTeamRow(idxs[1], 36);
    }
    // Vertical page dots at the right edge.
    if (pages > 1)
      for (int k = 0; k < pages; k++)
        gfx_->fillRect(width_ - 3, 32 - pages * 2 + k * 4, 2, 2, k == page ? muted() : faint());
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
    for (int i = 0; i < MAX_SHOWS && cnt < SHOWS_PER_PAGE; i++) {
      if (!showVisible(i)) continue;
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
    if (cnt == 2) gfx_->drawFastHLine(40, 30, width_ - 80, faint());
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
    gfx_->fillRect(sx - 5, 3, 3, 3, open ? softGreen() : faint());
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
        for (int x = 0; x < 34; x += 2) gfx_->drawPixel(bx + x, by + bh - 1 - m.base, faint());
      int px = -1, py = -1;
      for (int i = 0; i < m.sparkLen; i++) {
        if (m.spark[i] < 0) continue;
        int x = bx + i, yy = by + bh - 1 - m.spark[i];
        if (px >= 0) gfx_->drawLine(px, py, x, yy, c);
        else gfx_->drawPixel(x, yy, c);
        px = x; py = yy;
      }
    }
  }

  void drawStocks() {
    int n = 0;
    for (int i = 0; i < 8; i++) if (stockShown(i)) n++;
    int top = (height_ - (12 + n * 12)) / 2;  // center header + rows
    if (top < 1) top = 1;
    centerText("MARKETS", top, green());
    int y = top + 14;
    for (int i = 0; i < 8 && y < height_ - 6; i++) {
      if (!stockShown(i)) continue;
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
    gfx_->drawFastHLine(32, 32, width_ - 36, faint());
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
    tt.tm_isdst = -1;
    time_t now = time(nullptr);
    if (now < 100000) return -1; // clock not set yet (needs NTP)
    time_t target = mktime(&tt);
    // Count calendar days from local midnight today (matches the app).
    struct tm today;
    localtime_r(&now, &today);
    today.tm_hour = 0; today.tm_min = 0; today.tm_sec = 0;
    today.tm_isdst = -1;
    time_t todayMid = mktime(&today);
    return (int)lround(difftime(target, todayMid) / 86400.0);
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
