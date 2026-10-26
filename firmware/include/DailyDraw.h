// ===========================================================================
// Info Wall — DailyDraw.h  (firmware 1.2.0, Mom Wall "simple mode")
// Born today / word of the day (+ origin) / classical fact / classical on
// this day / math of the day / family message pages, from /api/device/daily.
// Pure drawing code (no Arduino types) so tools/daily_preview.cpp renders the
// same pixels on the host. G must provide:
//   void px(int x, int y, uint8_t r, uint8_t g, uint8_t b);
// Text uses the Adafruit GFX classic 5x7 font directly (scaled for size 2),
// so "^2" can be drawn as the CP437 superscript-two glyph.
// Long bodies split into sub-pages; the caller passes `sub` (0..dyPages-1).
// ===========================================================================
#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#ifndef DAILY_FONT_INCLUDED
#define DAILY_FONT_INCLUDED
#ifndef PROGMEM
#define PROGMEM
#endif
namespace dyfont {
#include "glcdfont.c"
}
#endif

struct DyRGB { uint8_t r, g, b; };
static const DyRGB DY_SOFT  = {185, 185, 180};
static const DyRGB DY_MUTED = {120, 120, 115};
static const DyRGB DY_FAINT = {38, 38, 38};
#include "Palette.h"
// 1.3.0: accent is runtime - Mom Wall green (1.2.16), main walls amber (1.2.0 original).
static inline DyRGB dyAccent() { return g_momPal ? DyRGB{0, 230, 0} : DyRGB{245, 158, 11}; }
#define DY_AMBER dyAccent()
static const DyRGB DY_SKY   = {56, 189, 248};
static const DyRGB DY_GREEN = {16, 185, 129};
static const DyRGB DY_ROSE  = {244, 114, 182};
static const DyRGB DY_VIOLET= {167, 139, 250};

struct DyData {
  const char *word, *pron, *pos, *def, *origin, *example;
  const char *born, *bornDesc; int bornYear, age;
  const char *cfact, *ctoday, *ctDesc, *ckind; int ctYear;
  const char *mathBig, *mathText;
  const char *fam, *famFrom;
  const char *earthT, *earthTopic, *earthText;   // 1.2.21
};

// "^2" -> DY_SUP2 (a small raised "2"); everything else 1:1.
static const uint16_t DY_SUP2 = 0x100 | '2';
inline int dyGlyphs(const char *s, uint16_t *out, int max) {
  int n = 0;
  for (; *s && n < max; s++) {
    if (s[0] == '^' && s[1] == '2') { out[n++] = DY_SUP2; s++; }
    else out[n++] = (unsigned char)*s;
  }
  return n;
}
template <class G> void dyText(G &g, const char *s, int x, int y, DyRGB c, int size = 1, int adv = 0) {
  uint16_t gl[64];
  int n = dyGlyphs(s, gl, 64);
  if (!adv) adv = 6 * size;
  for (int i = 0; i < n; i++) {
    bool sup = gl[i] & 0x100;
    int sz = sup ? (size > 1 ? size / 2 : 1) : size;   // superscript: half size, raised
    unsigned ch = gl[i] & 0xFF;
    for (int col = 0; col < 5; col++) {
      uint8_t bits = dyfont::font[ch * 5 + col];
      for (int row = 0; row < 8; row++)
        if (bits >> row & 1)
          for (int a = 0; a < sz; a++)
            for (int b = 0; b < sz; b++) {
              int px = x + col * sz + a, py = y + row * sz + b - (sup && size == 1 ? 2 : 0);
              if (px >= 0 && px < 128 && py >= 0 && py < 64) g.px(px, py, c.r, c.g, c.b);
            }
    }
    x += sup ? 6 * sz : adv;
  }
}
// Rendered width in pixels.
inline int dyWidth(const char *s, int size, int adv = 0) {
  uint16_t gl[64]; int n = dyGlyphs(s, gl, 64), w = 0;
  if (!adv) adv = 6 * size;
  for (int i = 0; i < n; i++) w += (gl[i] & 0x100) ? 6 * (size > 1 ? size / 2 : 1) : adv;
  return w ? w - 1 : 0;
}
inline int dyLen(const char *s) { uint16_t gl[64]; return dyGlyphs(s, gl, 64); }
template <class G> void dyCenter(G &g, const char *s, int y, DyRGB c, int size = 1) {
  int adv = 6 * size;
  if (size == 2 && dyWidth(s, 2) > 128) adv = 11;   // tighten big text a little
  int w = dyWidth(s, size, adv);
  dyText(g, s, (128 - w) / 2, y, c, size, adv);
}
template <class G> void dyRule(G &g, int y, DyRGB c) { for (int x = 8; x < 120; x++) g.px(x, y, c.r, c.g, c.b); }

// Word-wrap into lines of <= cols chars. Returns line count (<= maxLines).
inline int dyWrap(const char *s, int cols, char lines[][24], int maxLines) {
  int n = 0; const char *p = s;
  while (*p && n < maxLines) {
    while (*p == ' ') p++;
    if (!*p) break;
    int len = (int)strlen(p), take = len <= cols ? len : cols;
    if (len > cols) {
      int sp = -1;
      for (int i = take; i > 0; i--) if (p[i] == ' ') { sp = i; break; }
      if (sp > 0) take = sp;
    }
    memcpy(lines[n], p, take); lines[n][take] = 0;
    n++; p += take;
  }
  return n;
}
// Lines a body needs (used for sub-page count).
inline int dyLineCount(const char *s, int cols = 21) { char l[40][24]; return dyWrap(s, cols, l, 40); }

// Title row + body lines from `firstY`, `per` lines per sub-page.
template <class G> void dyBody(G &g, const char *s, int firstY, int per, int sub, DyRGB c, bool center = true) {
  char l[40][24];
  int n = dyWrap(s, 21, l, 40);
  for (int i = 0; i < per; i++) {
    int k = sub * per + i;
    if (k >= n) break;
    if (center) dyCenter(g, l[k], firstY + i * 8, c);
    else dyText(g, l[k], 1, firstY + i * 8, c);
  }
}
template <class G> void dyTitle(G &g, const char *t, DyRGB c) { dyCenter(g, t, 1, c); dyRule(g, 10, DY_FAINT); }

// Sub-pages per module (index matches dyDraw's `which`).
enum DyPage { DY_BORN, DY_WORD, DY_ORIGIN, DY_CFACT, DY_CTODAY, DY_MATH, DY_FAMILY, DY_EARTH };
inline int dyPages(int which, const DyData &d) {
  int n = 1;
  switch (which) {
    case DY_CFACT:  n = (dyLineCount(d.cfact) + 5) / 6; break;
    case DY_CTODAY: n = strcmp(d.ckind, "composer_born") == 0 ? 1 : (dyLineCount(d.ctoday) + 4) / 5; break;
    case DY_MATH:   n = (dyLineCount(d.mathText) + (d.mathBig[0] ? 3 : 5)) / (d.mathBig[0] ? 4 : 6); break;
    case DY_FAMILY: n = (dyLineCount(d.fam) + 3) / 4; break;
    case DY_BORN:   n = 1; break;
    case DY_WORD:   n = d.origin[0] ? 2 : 1; break;
    case DY_EARTH:  n = (dyLineCount(d.earthText) + 4) / 5; break;
  }
  return n < 1 ? 1 : n;
}

template <class G> void dyDraw(G &g, int which, const DyData &d, int sub) {
  char b[48];
  switch (which) {
    case DY_WORD: {
      // 1.2.3: page 1 is always word + pronunciation/part of speech + the
      // DEFINITION. The origin + example is an optional 2nd page of the same
      // slide (only when there is an origin).
      dyTitle(g, "WORD OF THE DAY", DY_AMBER);
      if (sub == 0 || !d.origin[0]) {
        // 1.2.13: page always fits 64 rows with margin. Big word only when
        // the definition is a single line; otherwise everything is size 1.
        char dl[40][24]; int dn = dyWrap(d.def, 21, dl, 40);
        if (dn > 3) dn = 3;
        bool big = dn <= 1 && dyWidth(d.word, 2) <= 126;
        if (big) dyCenter(g, d.word, 13, DY_SKY, 2);
        else dyCenter(g, d.word, 13, DY_SKY);
        if (d.pos[0]) snprintf(b, sizeof(b), "%s - %s", d.pron, d.pos);
        else snprintf(b, sizeof(b), "%s", d.pron);
        if (dyWidth(b, 1) > 126) snprintf(b, sizeof(b), "%s", d.pron);
        int y = big ? 30 : 22;
        if (b[0] && dyWidth(b, 1) <= 126) { dyCenter(g, b, y, DY_MUTED); y += 10; }
        for (int i = 0; i < dn; i++) dyCenter(g, dl[i], y + i * 8, DY_SOFT);
      } else {
        // 1.2.13: always fits 64 rows. Word, "Origin:" label, the origin
        // wrapped (up to 4 lines), then the example only if ALL of it fits.
        dyCenter(g, d.word, 13, DY_SKY);
        dyCenter(g, "Origin:", 22, DY_MUTED);
        char l[40][24];
        int n = dyWrap(d.origin, 21, l, 40), y = 31;
        if (n > 4) n = 4;
        for (int i = 0; i < n; i++, y += 8) dyCenter(g, l[i], y, DY_SOFT);
        char ex[160]; snprintf(ex, sizeof(ex), "\"%s\"", d.example);
        int m = d.example[0] ? dyWrap(ex, 21, l, 40) : 0;
        y += 2;
        if (m > 0 && y + m * 8 - 1 <= 64)
          for (int i = 0; i < m; i++) dyCenter(g, l[i], y + i * 8, DY_MUTED);
      }
      break;
    }
    case DY_ORIGIN: {   // legacy page (no longer in the rotation)
      dyTitle(g, "WORD ORIGIN", DY_AMBER);
      snprintf(b, sizeof(b), "%s (%s)", d.word, d.pos);
      dyCenter(g, b, 12, DY_SKY);
      dyBody(g, d.origin, 21, 2, 0, DY_SOFT);
      char ex[160]; snprintf(ex, sizeof(ex), "\"%s\"", d.example);
      dyBody(g, ex, 39, 3, 0, DY_MUTED);
      break;
    }
    case DY_BORN: {
      dyTitle(g, "BORN TODAY", DY_ROSE);
      char l[4][24]; int n = dyWrap(d.born, 21, l, 2);
      for (int i = 0; i < n; i++) dyCenter(g, l[i], 14 + i * 9, DY_SOFT);
      int y = 14 + n * 9 + 2;   // 1.2.13: +1 row so lines never touch
      if (d.age > 0 && d.age < 110) snprintf(b, sizeof(b), "%d - turns %d", d.bornYear, d.age);
      else snprintf(b, sizeof(b), "Born %d", d.bornYear);
      dyCenter(g, b, y, DY_AMBER);
      dyBody(g, d.bornDesc, y + 12, n > 1 ? 2 : 3, 0, DY_MUTED);
      break;
    }
    case DY_CFACT:
      dyTitle(g, "CLASSICAL MUSIC", DY_VIOLET);
      dyBody(g, d.cfact, 14, 6, sub, DY_SOFT);
      break;
    case DY_CTODAY: {
      bool comp = strcmp(d.ckind, "composer_born") == 0;
      if (comp) {   // ctoday = composer name, ctDesc = description
        dyTitle(g, "COMPOSER BIRTHDAY", DY_VIOLET);   // 1.2.13: 19 chars hit the panel edges
        char l[3][24]; int n = dyWrap(d.ctoday, 21, l, 2);
        for (int i = 0; i < n; i++) dyCenter(g, l[i], 14 + i * 9, DY_SOFT);
        int y = 14 + n * 9 + 2;   // 1.2.13: +1 row so lines never touch
        snprintf(b, sizeof(b), "Born %d", d.ctYear);
        dyCenter(g, b, y, DY_AMBER);
        dyBody(g, d.ctDesc, y + 12, n > 1 ? 2 : 3, 0, DY_MUTED);
        break;
      }
      dyTitle(g, "MUSIC ON THIS DAY", DY_VIOLET);
      if (d.ctYear) { snprintf(b, sizeof(b), "%d", d.ctYear); dyCenter(g, b, 13, DY_AMBER); }
      dyBody(g, d.ctoday, 23, 5, sub, DY_SOFT);
      break;
    }
    case DY_MATH:
      dyTitle(g, "MATH OF THE DAY", DY_GREEN);
      if (d.mathBig[0]) {
        bool big = dyWidth(d.mathBig, 2, 11) <= 128;
        dyCenter(g, d.mathBig, big ? 14 : 17, DY_SKY, big ? 2 : 1);
        dyBody(g, d.mathText, 33, 4, sub, DY_SOFT);
      } else {
        dyBody(g, d.mathText, 14, 6, sub, DY_SOFT);
      }
      break;
    case DY_EARTH: {   // 1.2.21: GEOGRAPHY / GEOLOGY - topic (amber) + fact
      // 1.2.23 Mom Wall, 1.3.3 main walls: centre title + topic + this page's lines
      // vertically in the 64 px panel (every fact page).
      bool tp = d.earthTopic[0];
      int first = tp ? 23 : 14, per = tp ? 5 : 6, oy = 0;
      {   // 1.3.3: main walls centre too (sports / Yiddish / history)
        int n = dyLineCount(d.earthText) - sub * per;
        n = n < 0 ? 0 : (n > per ? per : n);
        int bottom = n ? first + (n - 1) * 8 + 7 : (tp ? 13 + 7 : 10);
        oy = (64 - bottom) / 2 - 1;   // block spans y=1..bottom -> equal top/bottom margins
        if (oy < 0) oy = 0;
      }
      dyCenter(g, d.earthT[0] ? d.earthT : "EARTH FACT", 1 + oy, DY_AMBER); dyRule(g, 10 + oy, DY_FAINT);
      DyRGB amb = g_momPal ? DyRGB{255, 176, 0} : DY_SKY;
      if (tp) dyCenter(g, d.earthTopic, 13 + oy, amb);
      dyBody(g, d.earthText, first + oy, per, sub, DY_SOFT);
      break;
    }
    case DY_FAMILY: {
      dyTitle(g, "FROM YOUR FAMILY", DY_ROSE);
      dyBody(g, d.fam, 15, 4, sub, DY_SOFT);
      if (d.famFrom[0]) { snprintf(b, sizeof(b), "- %s", d.famFrom); dyCenter(g, b, 55, DY_AMBER); }
      break;
    }
  }
  // Sub-page dots bottom-right when a slide has more than one page.
  int np = dyPages(which, d);
  if (np > 1)
    for (int i = 0; i < np; i++) {
      DyRGB c = i == sub ? DY_SOFT : DY_FAINT;
      g.px(124 - (np - 1 - i) * 3, 62, c.r, c.g, c.b);
    }
}
