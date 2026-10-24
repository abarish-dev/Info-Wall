// ===========================================================================
// Info Wall — SkyDraw.h  (firmware 1.1.17)
// Moon/sun, ISS, VIP-aircraft alert and day/night world map pages.
// Pure drawing code with no Arduino types so the same functions render the
// host previews (tools/sky_preview.cpp). G must provide:
//   void px(int x, int y, uint8_t r, uint8_t g, uint8_t b);
//   void text(const char *s, int x, int y, uint8_t r, uint8_t g, uint8_t b); // 5x7 GFX font, 6px/char
// ===========================================================================
#pragma once
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "WorldMask.h"

struct SkyRGB { uint8_t r, g, b; };
static const SkyRGB SK_SOFT  = {185, 185, 180};
static const SkyRGB SK_MUTED = {120, 120, 115};
static const SkyRGB SK_FAINT = {38, 38, 38};
static const SkyRGB SK_AMBER = {245, 158, 11};
static const SkyRGB SK_SKY   = {56, 189, 248};
static const SkyRGB SK_GREEN = {16, 185, 129};
static const SkyRGB SK_PHASE = {0, 230, 0};   // 1.2.11: moon phase name green
static const SkyRGB SK_RED   = {230, 40, 40};

struct SkyMoon { int il; bool wax; const char *ph, *sr, *ss, *mr; };
struct SkyIss {
  bool over; int mi;                        // overhead now + height (mi)
  const char *day, *tm, *fr, *to; int el, mins;   // next visible pass (day "" = none)
  const char *ofr, *oto; int oel;           // the pass in progress
};
struct SkyVip { const char *label, *line2, *dir; float dist; long alt; int vr, hdg, spd; bool red; };

template <class G> inline void skPx(G &g, int x, int y, SkyRGB c) {
  if (x >= 0 && x < 128 && y >= 0 && y < 64) g.px(x, y, c.r, c.g, c.b);
}
template <class G> inline void skText(G &g, const char *s, int x, int y, SkyRGB c) { g.text(s, x, y, c.r, c.g, c.b); }
template <class G> inline void skHLine(G &g, int x, int y, int w, SkyRGB c) { for (int i = 0; i < w; i++) skPx(g, x + i, y, c); }

// ---- Moon + sun -------------------------------------------------------------
template <class G> void skyDrawMoon(G &g, const SkyMoon &m) {
  const int R = 13, cx = 17, cy = 22;
  float k = m.il / 100.0f * 2 - 1;
  const SkyRGB lit = {235, 225, 190}, dark = {30, 30, 36}, crater = {200, 190, 160};
  for (int y = -R; y <= R; y++)
    for (int x = -R; x <= R; x++) {
      if (x * x + y * y > R * R + R * 0.6f) continue;
      float hw = sqrtf(fmaxf((float)(R * R - y * y), 0));
      int xx = m.wax ? x : -x;              // northern sky: waxing = lit on the right
      bool on = xx >= -k * hw;
      SkyRGB c = on ? lit : dark;
      if (on && (((x * 7 + y * 3) % 11) + 11) % 11 == 0 && abs(x) < R - 3) c = crater;
      skPx(g, cx + x, cy + y, c);
    }
  char b[24];
  snprintf(b, sizeof(b), "%d%%", m.il);
  skText(g, b, cx + 3 - (int)strlen(b) * 3 - 3, cy + R + 4, SK_SOFT);
  // Phase name on two lines ("Waxing" / "Gibbous").
  const char *sp = strchr(m.ph, ' ');
  if (sp) {
    char w1[16]; int n = (int)(sp - m.ph); if (n > 15) n = 15;
    memcpy(w1, m.ph, n); w1[n] = 0;
    skText(g, w1, 38, 4, SK_PHASE); skText(g, sp + 1, 38, 13, SK_PHASE);
  } else skText(g, m.ph, 38, 8, SK_PHASE);
  skHLine(g, 38, 24, 86, SK_FAINT);
  auto sun = [&](int x, int y, SkyRGB c) {
    for (int dx = -2; dx <= 2; dx++) for (int dy = -2; dy <= 2; dy++) if (dx * dx + dy * dy <= 5) skPx(g, x + dx, y + dy, c);
    const int8_t rays[8][2] = {{0,-4},{0,4},{-4,0},{4,0},{-3,-3},{3,3},{-3,3},{3,-3}};
    for (auto &r : rays) skPx(g, x + r[0], y + r[1], c);
  };
  sun(43, 32, {250, 200, 40});
  snprintf(b, sizeof(b), "Rise %s", m.sr); skText(g, b, 51, 29, SK_SOFT);
  sun(43, 44, {240, 110, 40});
  snprintf(b, sizeof(b), "Set  %s", m.ss); skText(g, b, 51, 41, SK_SOFT);
  if (m.mr && *m.mr) { snprintf(b, sizeof(b), "Moonrise %s", m.mr); skText(g, b, 38, 54, SK_MUTED); }
}

// ---- ISS --------------------------------------------------------------------
template <class G> void skyStation(G &g, int x, int y) {
  const SkyRGB pan = {40, 90, 200}, body = {210, 210, 210};
  for (int i = -11; i <= 11; i++) skPx(g, x + i, y, body);
  const int cols[4] = {-11, -8, 8, 11};
  for (int i : cols) for (int j = -5; j <= 5; j++) { skPx(g, x + i, y + j, pan); skPx(g, x + i + (i < 0 ? 1 : -1), y + j, pan); }
  for (int i = -3; i <= 3; i++) for (int j = -2; j <= 2; j++) skPx(g, x + i, y + j, body);
  skPx(g, x, y - 3, SK_AMBER); skPx(g, x, y + 3, SK_AMBER);
}
template <class G> void skyDrawIss(G &g, const SkyIss &s) {
  skyStation(g, 16, 16);
  skText(g, "ISS", 34, 4, SK_AMBER);
  skText(g, "SPACE STATION", 34, 13, SK_MUTED);
  skHLine(g, 4, 28, 120, SK_FAINT);
  char b[28];
  if (s.over) {
    skText(g, "OVERHEAD NOW", 28, 32, {250, 80, 80});
    snprintf(b, sizeof(b), "%d mi up", s.mi); skText(g, b, 4, 43, SK_SOFT);
    snprintf(b, sizeof(b), "look %s->%s %d\xF7", s.ofr, s.oto, s.oel); skText(g, b, 4, 53, SK_GREEN);
  } else if (s.day && *s.day) {
    snprintf(b, sizeof(b), "Next: %s", s.day); skText(g, b, 4, 32, SK_SOFT);
    snprintf(b, sizeof(b), "%s  %d min", s.tm, s.mins); skText(g, b, 4, 42, SK_SKY);
    snprintf(b, sizeof(b), "%s->%s  max %d\xF7", s.fr, s.to, s.el); skText(g, b, 4, 52, SK_GREEN);
  } else {
    snprintf(b, sizeof(b), "%d mi up", s.mi); skText(g, b, 4, 34, SK_SOFT);
    skText(g, "No visible pass", 4, 46, SK_MUTED);
    skText(g, "in next 10 days", 4, 55, SK_MUTED);
  }
}

// ---- VIP aircraft alert -----------------------------------------------------
template <class G> void skyDrawVip(G &g, const SkyVip &v) {
  for (int x = 0; x < 128; x++) { skPx(g, x, 0, SK_RED); skPx(g, x, 63, SK_RED); }
  // Top-down 747: fuselage, swept wings, stabilizers, blue cheat line.
  const SkyRGB w = {235, 235, 235}, bl = {70, 130, 230};
  auto P = [&](int x, int y) { skPx(g, x - 2, y + 4, w); };
  P(16, 4); P(16, 5);
  for (int y = 3; y < 24; y++) { P(15, y); P(16, y); }
  for (int y = 5; y < 24; y++) P(17, y);
  for (int i = 1; i < 13; i++) { int y1 = 11 + i / 2; P(16 - i, y1); P(16 + i, y1); P(16 - i, y1 + 1); P(16 + i, y1 + 1); }
  for (int i = 1; i < 6; i++) { P(16 - i, 22); P(16 + i, 22); P(16 - i, 21); P(16 + i, 21); }
  for (int y = 7; y < 24; y++) skPx(g, 14, y + 4, bl);
  skText(g, v.label, 34, 6, v.red ? SK_RED : SK_AMBER);
  char b[24];
  snprintf(b, sizeof(b), "%.15s", v.line2); skText(g, b, 34, 16, SK_SOFT);
  skHLine(g, 34, 27, 90, SK_FAINT);
  snprintf(b, sizeof(b), "%d mi %s", (int)(v.dist + 0.5f), v.dir); skText(g, b, 34, 31, SK_AMBER);
  const char *arrow = v.vr > 0 ? "  ^" : (v.vr < 0 ? "  v" : "");
  if (v.alt <= 0) snprintf(b, sizeof(b), "on ground");
  else if (v.alt >= 18000) snprintf(b, sizeof(b), "FL%03ld%s", (v.alt + 50) / 100, arrow);
  else snprintf(b, sizeof(b), "%ld,%03ldft%s", v.alt / 1000, v.alt % 1000, arrow);
  skText(g, b, 34, 41, SK_SKY);
  snprintf(b, sizeof(b), "hdg %03d %dkt", v.hdg, v.spd); skText(g, b, 34, 51, SK_GREEN);
}

// ---- Day / night world map ----------------------------------------------------
// Sub-solar point from a UTC epoch (low-precision almanac, ~0.1 deg).
inline void skySubsolar(time_t utc, float &lat, float &lon) {
  double d = utc / 86400.0 - 10957.5;  // days since J2000.0
  double g = fmod(357.529 + 0.98560028 * d, 360) * M_PI / 180;
  double q = fmod(280.459 + 0.98564736 * d, 360);
  double L = (q + 1.915 * sin(g) + 0.020 * sin(2 * g)) * M_PI / 180;
  double e = (23.439 - 0.00000036 * d) * M_PI / 180;
  double ra = atan2(cos(e) * sin(L), cos(L)) * 180 / M_PI;
  double dec = asin(sin(e) * sin(L));
  double gmst = fmod(18.697374558 + 24.06570982441908 * d, 24) * 15;
  double sl = fmod(ra - gmst + 540.0, 360.0) - 180.0;
  lat = (float)(dec * 180 / M_PI); lon = (float)sl;
}
template <class G> void skyDrawMap(G &g, time_t utc, float homeLat, float homeLon, const char *clock, bool mom = false) {
  float slat, slon;
  skySubsolar(utc, slat, slon);
  float sd = sinf(slat * (float)M_PI / 180), cd = cosf(slat * (float)M_PI / 180);
  for (int y = 0; y < 64; y++) {
    float lat = (90 - (y + 0.5f) * 180 / 64) * (float)M_PI / 180;
    float sl = sinf(lat), cl = cosf(lat);
    for (int x = 0; x < 128; x++) {
      float lon = (x + 0.5f) * 360 / 128 - 180;
      float cz = sl * sd + cl * cd * cosf((lon - slon) * (float)M_PI / 180);
      float day = fminf(1, fmaxf(0, (cz + 0.1f) / 0.2f));
      bool land = worldLand(x, y);
      SkyRGB dc = land ? SkyRGB{60, 150, 60} : SkyRGB{20, 70, 170};
      SkyRGB nc = land ? SkyRGB{25, 35, 30} : SkyRGB{4, 8, 30};
      SkyRGB c = {(uint8_t)(nc.r + (dc.r - nc.r) * day), (uint8_t)(nc.g + (dc.g - nc.g) * day),
                  (uint8_t)(nc.b + (dc.b - nc.b) * day)};
      if (land && day < 0.5f && (x * 13 + y * 7) % 29 == 0) c = {200, 170, 80};  // city lights
      skPx(g, x, y, c);
    }
  }
  int sx = (int)((slon + 180) / 360 * 128), sy = (int)((90 - slat) / 180 * 64);
  const int8_t cross[5][2] = {{0,0},{1,0},{-1,0},{0,1},{0,-1}};
  for (auto &p : cross) skPx(g, sx + p[0], sy + p[1], {255, 220, 0});
  int mx = (int)((homeLon + 180) / 360 * 128), my = (int)((90 - homeLat) / 180 * 64);
  for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) skPx(g, mx + dx, my + dy, {255, 40, 40});
  if (clock && *clock) {
    if (mom) {
      // 1.2.5 Mom Wall: white-on-map read as washed out. Dark backing plate +
      // warm amber text, no bleed from the bright day-side behind it.
      int w = (int)strlen(clock) * 6 + 3;
      for (int y = 54; y < 64; y++) for (int x = 0; x < w; x++) skPx(g, x, y, SkyRGB{0, 0, 0});
      skText(g, clock, 2, 56, SkyRGB{230, 150, 40});
    } else skText(g, clock, 2, 56, SK_SOFT);
  }
}
